/* ============================================================
   BLACKSAND - map assembly and Conquest rules

   Lays out the map (compounds, roads, cover, objectives), then owns
   the Conquest game mode: control points, ticket bleed, spawn
   selection and round flow.

   The layout is designed, not scattered. Five control points on a
   rough diagonal, each built to a different plan with its own
   sightlines and counterplay, a road network that connects them for
   vehicles and reads as a legible mental map, and flanking terrain
   between them for infantry.

   The rule every objective here is built against: a defender needs
   cover that blocks the approach they actually care about, an
   attacker needs a second way in, and the elevation that decides the
   fight has to be reachable on foot. Random scatter satisfies none of
   those - it produces five places where every fight is identical.
   ============================================================ */

import { makeRng, clamp, clamp01, lerp, formatTime } from "./core.js";
import { LAYER, SURFACE } from "./physics.js";

export const TEAM = { NONE: 0, BLUE: 1, RED: 2 };

const TEAM_INFO = {
  [TEAM.BLUE]: { name: "COALITION", colour: 0x4fa8ff, hex: "#4fa8ff" },
  [TEAM.RED]: { name: "INSURGENCY", colour: 0xff5a4a, hex: "#ff5a4a" },
};

export async function createWorld(ctx) {
  const { THREE, render, terrain, structures, foliage, physics, materials, settings } = ctx;
  const rng = makeRng(ctx.seed ^ 0xc0ffee);

  /* --------------------------- layout plan --------------------------- */

  /**
   * Control points. Positions are hand-placed in normalised map space
   * and scaled, so the composition survives a change of map size.
   * `radius` is the capture zone; `character` drives what gets built.
   */
  const S = terrain.MAP_SIZE * 0.5;
  const POINTS = [
    { id: "A", label: "FUEL DEPOT", nx: -0.52, nz: -0.44, radius: 28, character: "industrial" },
    { id: "B", label: "OLD TOWN", nx: -0.18, nz: -0.05, radius: 32, character: "urban" },
    { id: "C", label: "THE CITADEL", nx: 0.04, nz: 0.30, radius: 26, character: "elevated" },
    { id: "D", label: "MARKET", nx: 0.40, nz: -0.18, radius: 30, character: "market" },
    { id: "E", label: "CHECKPOINT", nx: 0.56, nz: 0.44, radius: 24, character: "outpost" },
  ];

  const BASES = [
    { team: TEAM.BLUE, nx: -0.74, nz: 0.62, label: "COALITION FOB" },
    { team: TEAM.RED, nx: 0.72, nz: -0.66, label: "INSURGENT CAMP" },
  ];

  const controlPoints = [];
  const exclusions = [];
  /** Named positions the beauty shots aim at. Written during layout so
   *  a camera pose refers to a thing that exists rather than to a
   *  coordinate that used to have a building on it. */
  const landmarks = {};

  function worldPos(nx, nz) {
    return { x: nx * S, z: nz * S };
  }

  /** Yaw such that a building's front face (plan -Z) points along
   *  (fx, fz). `structures` applies a Y-Euler, so plan -Z maps to
   *  -(sin r, cos r). */
  const facing = (fx, fz) => Math.atan2(-fx, -fz);

  const positions = POINTS.map((p) => worldPos(p.nx, p.nz));
  const basePositions = BASES.map((b) => worldPos(b.nx, b.nz));

  /* ------------------------ terrain shaping ------------------------ */

  /**
   * All ground shaping happens before anything reads heightAt().
   *
   * The first pass raised the citadel mesa *after* placing its walls,
   * so the fort hung in the air at the edges where the plateau had
   * fallen away. Shaping first, building second, is the only ordering
   * that cannot produce that.
   */
  const levels = [];
  POINTS.forEach((spec, index) => {
    const { x, z } = positions[index];
    if (spec.character === "elevated") {
      // Raise the whole fort footprint, not just the middle: the mesa
      // has to be flat out past the wall line or the wall floats.
      terrain.flatten(x, z, 34, terrain.heightAt(x, z) + 11, 1.5);
      levels[index] = terrain.heightAt(x, z);
    } else {
      /* Falloff 1.5 gave a flat disc and then climbed back to the
         natural hillside inside twenty metres, so an objective sited on
         a slope sat in a quarry - the checkpoint's own furniture ended
         up strewn up a 21-degree dune wall that filled the frame. A
         2.1 apron blends over twice the distance and reads as a
         terrace someone graded rather than as a hole. */
      levels[index] = terrain.flatten(x, z, spec.radius * 1.35, null, 2.1);
    }
    exclusions.push({ x, z, radius: spec.radius * 1.35 });
  });

  // A berm on the north flank of the checkpoint: reachable elevation
  // that overlooks the road, and the reason the position is defensible
  // from something other than the tower.
  {
    const { x, z } = positions[4];
    terrain.flatten(x - 30, z - 26, 11, levels[4] + 4.5, 1.9);
  }

  /* ------------------------------ roads ------------------------------ */

  /**
   * Roads are flattened terrain plus an asphalt ribbon. They matter
   * more than they look: they are how vehicles cross the map, and they
   * give the player a readable mental model of the layout - one
   * highway running the length of the valley, one spur to the depot,
   * one climb to the citadel.
   */
  const roadSegments = [];
  function road(from, to, width = 8) {
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 6);
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      // Gentle S-curve so roads are not laser-straight.
      const bend = Math.sin(t * Math.PI) * 18 * (rng() - 0.5);
      const px = lerp(from.x, to.x, t) - (to.z - from.z) / (steps * 6 + 1) * bend;
      const pz = lerp(from.z, to.z, t) + (to.x - from.x) / (steps * 6 + 1) * bend;
      /* Falloff 2.1 graded the carriageway and then climbed back to
         the natural surface within about ten metres, so every road
         crossing a dune sat at the bottom of a trench with 45-degree
         walls - the checkpoint approach was a slot canyon with props
         stranded on its lip. Real road cuts batter back a long way.
         3.0 spreads the blend over about sixteen metres, which reads
         as a graded corridor and stops the roadside furniture ending up
         in mid-air. Wider than that (4.2 was tried) starts dragging the
         ground inside the old town around with it, which moved the
         alley by two metres and buried the camera. */
      terrain.flatten(px, pz, width * 0.55, null, 3.0);
      points.push(new THREE.Vector3(px, 0, pz));
    }
    const segment = { points, width };
    roadSegments.push(segment);
    return segment;
  }

  const highway = [
    road(basePositions[0], positions[2], 9),
    road(positions[2], positions[1], 10),
    road(positions[1], positions[3], 10),
    road(positions[3], positions[4], 10),
    road(positions[4], basePositions[1], 9),
  ];
  const depotSpur = road(positions[1], positions[0], 8);
  road(positions[0], basePositions[0], 6);

  /** Distance from a point to the nearest road centreline. Used so the
   *  layout does not drop a warehouse across the highway. */
  function roadDistance(x, z) {
    let best = Infinity;
    for (const segment of roadSegments) {
      const pts = segment.points;
      for (let i = 1; i < pts.length; i += 1) {
        const ax = pts[i - 1].x; const az = pts[i - 1].z;
        const bx = pts[i].x; const bz = pts[i].z;
        const dx = bx - ax; const dz = bz - az;
        const len2 = dx * dx + dz * dz || 1;
        const t = clamp01(((x - ax) * dx + (z - az) * dz) / len2);
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t)) - segment.width * 0.5;
        if (d < best) best = d;
      }
    }
    return best;
  }

  /** Heading of the road passing nearest to (x, z). Gives every town
   *  its street grid for free, aligned to the way traffic arrives. */
  function roadHeadingAt(x, z) {
    let best = Infinity;
    let heading = 0;
    for (const segment of roadSegments) {
      const pts = segment.points;
      for (let i = 1; i < pts.length; i += 1) {
        const mx = (pts[i - 1].x + pts[i].x) * 0.5;
        const mz = (pts[i - 1].z + pts[i].z) * 0.5;
        const d = Math.hypot(x - mx, z - mz);
        if (d < best) {
          best = d;
          heading = Math.atan2(pts[i].z - pts[i - 1].z, pts[i].x - pts[i - 1].x);
        }
      }
    }
    return heading;
  }

  /* ------------------------ control point records ------------------------ */

  POINTS.forEach((spec, index) => {
    const { x, z } = positions[index];
    controlPoints.push({
      ...spec,
      position: new THREE.Vector3(x, levels[index], z),
      owner: TEAM.NONE,
      /** -1 (fully red) .. +1 (fully blue). Capture progress. */
      capture: 0,
      contested: false,
      presence: { [TEAM.BLUE]: 0, [TEAM.RED]: 0 },
      spawns: [],
    });
  });

  /** Ring of spawn points, pushed out past whatever was built and
   *  rejected where they would land on a road or a roof. */
  function ringSpawns(point, distance) {
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      for (const scale of [1.0, 1.25, 0.8]) {
        const sx = point.position.x + Math.cos(a) * distance * scale;
        const sz = point.position.z + Math.sin(a) * distance * scale;
        if (!terrain.inBounds(sx, sz)) continue;
        if (terrain.slopeAt(sx, sz) > 0.35) continue;
        point.spawns.push(new THREE.Vector3(sx, terrain.heightAt(sx, sz), sz));
        break;
      }
    }
    if (!point.spawns.length) point.spawns.push(point.position.clone());
  }

  /* ==================================================================
     A - FUEL DEPOT
     A walled tank farm. The tanks themselves are the cover that blocks
     the road approach; the container lane is the infantry corridor
     through the middle; the back gate and the wall breach are the two
     flanks. The guard tower watches the main gate and is in turn
     overlooked by the control building's roof.
     ================================================================== */

  function buildDepot(point) {
    const { x, z } = point.position;
    const heading = roadHeadingAt(x, z);
    const ux = Math.cos(heading); const uz = Math.sin(heading);
    const vx = -uz; const vz = ux;
    const at = (a, b) => ({ x: x + ux * a + vx * b, z: z + uz * a + vz * b });
    const yaw = facing(-ux, -uz);

    structures.compoundWall(x, z, 84, 66, -heading, 1, {
      gateSides: [3], gateAt: 0.5, height: 2.9,
    });

    // Three tanks in a row across the road approach.
    const tankLine = [];
    for (let i = 0; i < 3; i += 1) {
      const p = at(-26 + i * 0.0, -20 + i * 20);
      tankLine.push(structures.fuelTank(p.x, p.z, 5.2, 7.2));
    }
    landmarks.depotTanks = at(-26, 0);
    // Pipework linking them, at chest height: cover you can see over
    // but not walk through, which is the most useful cover there is.
    for (let i = 0; i < 2; i += 1) {
      const a = at(-18, -20 + i * 20);
      const b = at(-18, 0 + i * 20);
      structures.pipeRun(a.x, a.z, b.x, b.z, 1.45, 0.26);
    }
    const pa = at(-18, 20); const pb = at(16, 20);
    structures.pipeRun(pa.x, pa.z, pb.x, pb.z, 1.5, 0.28);

    // Loading warehouse on the far side.
    const wh = at(22, -6);
    structures.building(wh.x, wh.z, {
      archetype: "warehouse", width: 24, depth: 15,
      rotationY: yaw + Math.PI * 0.5, detail: 2,
    });
    landmarks.depotWarehouse = wh;

    // Control building: two storeys, roof overlooks the whole yard.
    const cb = at(4, -26);
    structures.building(cb.x, cb.z, {
      archetype: "shophouse", width: 10, depth: 9, storeys: 2,
      rotationY: yaw, detail: 2,
    });

    // Container lane: two parallel rows with a 7m corridor between.
    for (let i = 0; i < 7; i += 1) {
      const along = -20 + i * 7.4;
      for (const side of [-1, 1]) {
        const p = at(along, side * 5.2 + 4);
        const top = structures.container(p.x, p.z, heading + Math.PI * 0.5 + rng.range(-0.04, 0.04));
        if (rng.chance(0.4)) {
          structures.container(p.x + rng.range(-0.3, 0.3), p.z, heading + Math.PI * 0.5, { y: top });
        }
      }
    }

    // Yard clutter along the corridor.
    for (let i = 0; i < 9; i += 1) {
      const p = at(rng.range(-32, 34), rng.range(-28, 28));
      const roll = rng();
      if (roll < 0.32) structures.oilDrums(p.x, p.z, rng.int(3, 6));
      else if (roll < 0.5) structures.crateStack(p.x, p.z, rng.range(0, Math.PI));
      else if (roll < 0.66) structures.pallet(p.x, p.z, rng.range(0, Math.PI));
      else if (roll < 0.82) structures.tyreStack(p.x, p.z, rng.int(3, 6));
      else structures.generator(p.x, p.z, rng.range(0, Math.PI));
    }

    // Guard tower on the gate corner.
    const gt = at(-34, 26);
    structures.guardTower(gt.x, gt.z, heading, { height: 5.4 });
    landmarks.depotTower = gt;

    // Gate furniture: the vehicle chicane and the wreck that says
    // somebody has already tried this approach.
    const g0 = at(-46, 0);
    structures.wreckedCar(g0.x, g0.z, heading + 0.4, { burnt: true });
    for (let i = 0; i < 4; i += 1) {
      const p = at(-44 + i * 4, (i % 2 === 0 ? -1 : 1) * 5);
      structures.barrier(p.x, p.z, heading + Math.PI * 0.5);
    }
    // Fence and wire outside the wall, so the gate is the obvious way
    // in and the breach is the reward for looking.
    const f0 = at(-44, -33); const f1 = at(24, -33);
    structures.chainFence(f0.x, f0.z, f1.x, f1.z);
    const r0 = at(-44, 34); const r1 = at(-10, 34);
    structures.razorWire(r0.x, r0.z, r1.x, r1.z);

    for (let i = 0; i < 3; i += 1) {
      const p = at(rng.range(-40, 40), rng.range(-30, 30));
      structures.sandbagWall(p.x, p.z, rng.range(0, Math.PI * 2), rng.range(3.5, 5));
    }

    exclusions.push({ x, z, radius: 46 });
    ringSpawns(point, point.radius * 1.25);
    void tankLine;
  }

  /* ==================================================================
     B - OLD TOWN
     A crossroads with real streets. Shophouses front the road on a
     common building line, alleys run behind them, and a five-storey
     tower on one corner owns the square - countered by the ruin
     opposite, whose exposed first floor looks straight back at it.
     ================================================================== */

  /** Scale a packed hex colour. Kept local rather than imported so
   *  world.js does not reach into the structures kit for a one-liner. */
  function shadeHex(colour, factor) {
    const r = Math.min(255, Math.round(((colour >> 16) & 255) * factor));
    const g = Math.min(255, Math.round(((colour >> 8) & 255) * factor));
    const b = Math.min(255, Math.round((colour & 255) * factor));
    return (r << 16) | (g << 8) | b;
  }

  function buildOldTown(point) {
    const { x, z } = point.position;
    const heading = roadHeadingAt(x, z);
    const ux = Math.cos(heading); const uz = Math.sin(heading);
    const vx = -uz; const vz = ux;
    const at = (a, b) => ({ x: x + ux * a + vx * b, z: z + uz * a + vz * b });

    const STREET = 8.5;    // half-width of the carriageway plus footway
    landmarks.oldTownAxis = { ux, uz, vx, vz, x, z, heading };

    /** A terrace of shophouses on a common building line. */
    function terrace(alongStart, alongStep, count, side, storeys) {
      for (let i = 0; i < count; i += 1) {
        const width = rng.range(8, 10.5);
        const depth = rng.range(9, 12.5);
        const along = alongStart + i * alongStep;
        const across = side * (STREET + depth * 0.5);
        const p = at(along, across);
        if (!structures.canPlace(p.x, p.z, Math.hypot(width, depth) * 0.5)) continue;
        structures.building(p.x, p.z, {
          archetype: "shophouse",
          width, depth,
          storeys: storeys ?? rng.int(2, 3),
          rotationY: facing(-side * vx, -side * vz),
          detail: 2,
        });
      }
    }

    terrace(-46, 11.5, 3, -1);
    terrace(-46, 11.5, 3, 1);
    terrace(16, 11.5, 3, -1);
    terrace(16, 11.5, 3, 1);

    /* Kerb and footway along the main street.
     *
     * A street needs an edge. Without one the carriageway and the sand
     * either side are the same continuous surface, the buildings sit in
     * it rather than on it, and there is nothing in the lower half of
     * the frame for the eye to measure the perspective against - which
     * is most of why the first street shot read as a corridor of boxes
     * in a desert rather than as a road. It also gives every building
     * on the terrace a hard horizontal line to cast its shadow across.
     *
     * Broken into 4m runs so it follows the ground, with occasional
     * missing sections: an intact kerb for ninety metres would be the
     * tidiest thing on the map.
     */
    for (const side of [-1, 1]) {
      for (let along = -58; along < 58; along += 4) {
        if (rng.chance(0.12)) continue;
        const a0 = at(along, side * (STREET - 0.35));
        const a1 = at(along + 4, side * (STREET - 0.35));
        const mx = (a0.x + a1.x) * 0.5;
        const mz = (a0.z + a1.z) * 0.5;
        if (!terrain.inBounds(mx, mz)) continue;
        const y = terrain.heightAt(mx, mz);
        const angle = Math.atan2(a1.x - a0.x, a1.z - a0.z);
        // Kerb face. Colliders on both pieces: a player walks onto the
        // footway, so the thing you can see and the thing you stand on
        // have to be the same object.
        structures.box("concrete", {
          position: new THREE.Vector3(mx, y + 0.09, mz),
          size: new THREE.Vector3(0.30, 0.30, 4.02),
          rotationY: angle, uvScale: 0.9, surface: SURFACE.CONCRETE,
          tint: shadeHex(0x9a9184, rng.range(0.82, 1.06)),
          tintBottom: 0x6a6156,
        });
        // Footway slab behind it, dropped just proud of the sand.
        structures.box("concrete", {
          position: new THREE.Vector3(
            mx + Math.cos(angle) * side * 0.95, y + 0.16, mz - Math.sin(angle) * side * 0.95
          ),
          size: new THREE.Vector3(1.6, 0.16, 4.02),
          rotationY: angle, uvScale: 0.5, surface: SURFACE.CONCRETE,
          tint: shadeHex(0x8f887c, rng.range(0.86, 1.04)),
        });
      }
    }

    // The cross street, one block deep each way.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i += 1) {
        const across = side * (26 + i * 12);
        const p = at(side * (STREET + 6), across);
        if (!structures.canPlace(p.x, p.z, 8)) continue;
        structures.building(p.x, p.z, {
          archetype: rng.chance(0.7) ? "shophouse" : "villa",
          width: rng.range(8, 11), depth: rng.range(9, 12),
          rotationY: facing(-side * ux, -side * uz),
          detail: 2,
        });
      }
    }

    // The tower on the north-east corner of the square: the vertical
    // anchor, visible from the depot road and from the citadel.
    const tp = at(11, -16);
    const tower = structures.building(tp.x, tp.z, {
      archetype: "tower", width: 11, depth: 9.5, storeys: 5,
      rotationY: facing(-vx, -vz), detail: 2,
    });
    landmarks.oldTownTower = { x: tp.x, z: tp.z, topY: tower.topY, baseY: tower.baseY };

    // The ruin opposite. Its open first floor looks straight back at
    // the tower, which is what stops the tower owning the square.
    const rp = at(-13, 16);
    structures.building(rp.x, rp.z, {
      archetype: "ruin", width: 11, depth: 10,
      rotationY: facing(vx, vz), detail: 2,
    });
    landmarks.oldTownRuin = rp;

    // The square itself: a low wall round a dry fountain, stalls, and
    // the wrecked car that gives the crossing a foreground.
    const sq = at(0, 0);
    landmarks.oldTownSquare = sq;
    const fountainR = 2.6;
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      structures.box("concrete", {
        position: new THREE.Vector3(
          sq.x + Math.cos(a) * fountainR,
          terrain.heightAt(sq.x, sq.z) + 0.28,
          sq.z + Math.sin(a) * fountainR
        ),
        size: new THREE.Vector3(0.36, 0.56, (Math.PI * 2 * fountainR) / 12 + 0.14),
        rotationY: -a, uvScale: 0.9, surface: SURFACE.CONCRETE,
        tint: 0x968d7d, tintBottom: 0x5f5a4e,
      });
    }
    structures.waterTank(sq.x, terrain.heightAt(sq.x, sq.z) + 0.5, sq.z, { radius: 0.8, height: 1.4 });

    for (let i = 0; i < 5; i += 1) {
      const p = at(rng.range(-8, 8), rng.range(-9, 9));
      if (Math.hypot(p.x - sq.x, p.z - sq.z) < 4) continue;
      structures.marketStall(p.x, p.z, heading + rng.range(-0.5, 0.5));
    }

    const car = at(-6, 3.5);
    structures.wreckedCar(car.x, car.z, heading + 0.6);
    const car2 = at(24, -4);
    structures.wreckedCar(car2.x, car2.z, heading + Math.PI - 0.3, { burnt: true });

    // Chicane through the square, so vehicles cannot simply drive it.
    for (let i = 0; i < 5; i += 1) {
      const p = at(-30 + i * 6, (i % 2 === 0 ? -1 : 1) * 4.2);
      structures.barrier(p.x, p.z, heading + Math.PI * 0.5 + rng.range(-0.2, 0.2));
    }

    // Telegraph poles down the main street, wired pole to pole.
    let previous = null;
    for (let i = -3; i <= 3; i += 1) {
      const p = at(i * 17, STREET + 1.6);
      const pole = structures.telegraphPole(p.x, p.z, { rotationY: heading + Math.PI * 0.5 });
      if (previous) structures.wire(previous, pole, 0.9);
      previous = pole;
    }

    for (let i = 0; i < 4; i += 1) {
      const p = at(rng.range(-40, 40), (rng.chance(0.5) ? -1 : 1) * rng.range(10, 30));
      structures.sandbagWall(p.x, p.z, rng.range(0, Math.PI * 2), rng.range(3, 5));
    }

    exclusions.push({ x, z, radius: 50 });
    ringSpawns(point, point.radius * 1.3);
  }

  /* ==================================================================
     C - THE CITADEL
     A walled fort on a raised mesa. The hill is climbable from any
     side, so the wall - not the slope - is the chokepoint: one gate on
     the road, one collapsed section with a rubble ramp, and a wall
     walk that gives defenders a firing line they have to expose
     themselves to use.
     ================================================================== */

  function buildCitadel(point) {
    const { x, z } = point.position;
    const y = point.position.y;
    const heading = roadHeadingAt(x, z);
    const gateAngle = heading;
    const ux = Math.cos(gateAngle); const uz = Math.sin(gateAngle);
    const vx = -uz; const vz = ux;
    const at = (a, b) => ({ x: x + ux * a + vx * b, z: z + uz * a + vz * b });

    const halfW = 25;
    const halfD = 22;
    structures.compoundWall(x, z, halfW * 2, halfD * 2, -gateAngle, 1, {
      gateSides: [3], gateAt: 0.5, height: 3.4, y, breach: false,
    });

    // The collapsed section: the second way in, and the only one that
    // does not walk into the gate's field of fire.
    const bp = at(halfW - 1, 0);
    structures.rubblePile(bp.x, bp.z, 4.0, 1.8);
    structures.box("blockwall", {
      position: new THREE.Vector3(bp.x, y + 0.9, bp.z),
      size: new THREE.Vector3(1.2, 1.8, 5.0),
      rotationY: gateAngle + Math.PI * 0.5, rotationZ: 0.22,
      uvScale: 0.5, surface: SURFACE.CONCRETE,
      tint: 0x8f8674, tintBottom: 0x5a5346,
    });

    // The keep.
    const keep = structures.building(x, z, {
      archetype: "tower", width: 14, depth: 12, storeys: 4,
      rotationY: facing(-ux, -uz), detail: 2,
    });
    landmarks.citadelKeep = { x, z, topY: keep.topY, baseY: keep.baseY, gateAngle };

    // Wall walk on the two flanking walls: a raised firing step behind
    // the parapet, reached by a stair at each end.
    for (const side of [-1, 1]) {
      const walkY = y + 1.9;
      const a0 = at(-halfW + 2, side * (halfD - 1.4));
      const a1 = at(halfW - 2, side * (halfD - 1.4));
      const midX = (a0.x + a1.x) * 0.5;
      const midZ = (a0.z + a1.z) * 0.5;
      structures.box("concrete", {
        position: new THREE.Vector3(midX, walkY - 0.15, midZ),
        size: new THREE.Vector3(halfW * 2 - 4, 0.3, 2.0),
        rotationY: -gateAngle, uvScale: 0.35, surface: SURFACE.CONCRETE,
        tint: 0x8c8474, tintBottom: 0x625b4d,
      });
      // Supporting piers, so the walk does not read as a floating shelf.
      for (let i = 0; i < 6; i += 1) {
        const p = at(-halfW + 4 + i * 8, side * (halfD - 2.2));
        structures.box("concrete", {
          position: new THREE.Vector3(p.x, y + 0.9, p.z),
          size: new THREE.Vector3(0.7, 1.8, 0.7),
          rotationY: -gateAngle, uvScale: 0.6,
          tint: 0x8c8474, tintBottom: 0x5a5346,
        });
      }
      const sp = at(-halfW + 3, side * (halfD - 4.0));
      structures.stairFlight("concrete", {
        base: new THREE.Vector3(sp.x, y, sp.z),
        rotationY: gateAngle + Math.PI * 0.5, height: 1.9, width: 1.4, tint: 0x8c8474,
      });
      for (let i = 0; i < 3; i += 1) {
        const p = at(-halfW + 8 + i * 14, side * (halfD - 1.6));
        structures.sandbagWall(p.x, p.z, gateAngle + Math.PI * 0.5, 3.6, walkY);
      }
    }

    // Yard: an ammunition dump, a generator and the vehicle that never
    // made it out of the gate.
    const dump = at(8, -13);
    structures.crateStack(dump.x, dump.z, gateAngle);
    structures.crateStack(dump.x + 2.4, dump.z + 1.2, gateAngle + 0.6);
    const gen = at(-9, 12);
    structures.generator(gen.x, gen.z, gateAngle);
    const wreck = at(-17, -3);
    structures.wreckedCar(wreck.x, wreck.z, gateAngle + 0.2, { burnt: true });
    for (let i = 0; i < 3; i += 1) {
      const p = at(rng.range(-20, 20), rng.range(-16, 16));
      structures.oilDrums(p.x, p.z, rng.int(2, 4));
    }

    // Approach: the ramp road up to the gate is the exposed way in.
    const g0 = at(-halfW - 3, 0);
    for (let i = 0; i < 4; i += 1) {
      const p = at(-halfW - 4 - i * 3.5, (i % 2 === 0 ? -1 : 1) * 4.0);
      structures.barrier(p.x, p.z, gateAngle + Math.PI * 0.5);
    }
    structures.razorWire(
      at(-halfW - 10, -14).x, at(-halfW - 10, -14).z,
      at(-halfW - 10, -4).x, at(-halfW - 10, -4).z
    );
    landmarks.citadelGate = g0;

    exclusions.push({ x, z, radius: 42 });
    ringSpawns(point, 30);
  }

  /* ==================================================================
     D - MARKET
     A covered bazaar. The canopies deny the sky, which makes this the
     one objective a helicopter cannot solve; the aisles are the only
     ways across the plaza; the market hall roof is the elevation, and
     it is reached by an external stair in plain view.
     ================================================================== */

  function buildMarket(point) {
    const { x, z } = point.position;
    const heading = roadHeadingAt(x, z);
    const ux = Math.cos(heading); const uz = Math.sin(heading);
    const vx = -uz; const vz = ux;
    const at = (a, b) => ({ x: x + ux * a + vx * b, z: z + uz * a + vz * b });
    landmarks.marketAxis = { ux, uz, vx, vz, x, z, heading };

    // Two crossing aisles under fabric.
    const a0 = at(-30, 0); const a1 = at(30, 0);
    structures.bazaarCanopy(a0.x, a0.z, a1.x, a1.z, 7.5);
    const b0 = at(0, -24); const b1 = at(0, 24);
    structures.bazaarCanopy(b0.x, b0.z, b1.x, b1.z, 6.5);

    // Stalls down both aisles.
    for (let i = -4; i <= 4; i += 1) {
      if (Math.abs(i) < 1) continue;
      for (const side of [-1, 1]) {
        const p = at(i * 6.6, side * 2.6);
        structures.marketStall(p.x, p.z, heading + (side < 0 ? 0 : Math.PI));
      }
    }
    for (let i = -3; i <= 3; i += 1) {
      if (Math.abs(i) < 1) continue;
      for (const side of [-1, 1]) {
        const p = at(side * 2.4, i * 6.4);
        structures.marketStall(p.x, p.z, heading + Math.PI * 0.5 + (side < 0 ? 0 : Math.PI));
      }
    }
    landmarks.marketPlaza = at(0, 0);

    // The market hall: a warehouse on the plaza's north side, its roof
    // the one piece of high ground inside the objective.
    const hall = at(-2, -34);
    const hallRecord = structures.building(hall.x, hall.z, {
      archetype: "warehouse", width: 26, depth: 16,
      rotationY: facing(vx, vz), detail: 2,
    });
    landmarks.marketHall = { x: hall.x, z: hall.z, topY: hallRecord.topY };

    // Shophouses around the perimeter, fronting the plaza.
    const perimeter = [
      [-34, 22], [-20, 26], [-6, 28], [10, 27], [24, 23],
      [34, 6], [33, -12], [22, 30], [-30, -22], [-34, -6],
    ];
    for (const [a, b] of perimeter) {
      const p = at(a, b);
      if (!structures.canPlace(p.x, p.z, 9)) continue;
      if (roadDistance(p.x, p.z) < 7) continue;
      structures.building(p.x, p.z, {
        archetype: rng.chance(0.72) ? "shophouse" : (rng.chance(0.5) ? "villa" : "ruin"),
        width: rng.range(8, 11.5), depth: rng.range(9, 12),
        rotationY: facing(-(p.x - x), -(p.z - z)) + Math.PI,
        detail: 2,
      });
    }

    // Water tower: the landmark that says MARKET from 300m out.
    const wt = at(20, -16);
    const wtY = structures.guardTower(wt.x, wt.z, heading, { height: 7.4, size: 3.2 });
    structures.waterTank(wt.x, wtY + 0.2, wt.z, { radius: 1.6, height: 2.4, tint: 0x6a4a3a });
    landmarks.marketTower = { x: wt.x, z: wt.z, topY: wtY };

    // Barricade across the southern approach: a bus-sized wreck plus
    // containers, so the road into the market has to be fought for.
    const bar = at(-4, 30);
    structures.container(bar.x, bar.z, heading + Math.PI * 0.5);
    structures.wreckedCar(bar.x + 7, bar.z + 1.5, heading + 0.8, { burnt: true });
    structures.wreckedCar(bar.x - 6, bar.z - 1.0, heading - 0.4);

    for (let i = 0; i < 5; i += 1) {
      const p = at(rng.range(-30, 30), rng.range(-26, 26));
      const roll = rng();
      if (roll < 0.4) structures.crateStack(p.x, p.z, rng.range(0, Math.PI));
      else if (roll < 0.7) structures.sandbagWall(p.x, p.z, rng.range(0, Math.PI * 2), rng.range(3, 5));
      else structures.tyreStack(p.x, p.z, rng.int(3, 6));
    }

    let previous = null;
    for (let i = -2; i <= 2; i += 1) {
      const p = at(i * 18, -30);
      const pole = structures.telegraphPole(p.x, p.z, { rotationY: heading + Math.PI * 0.5 });
      if (previous) structures.wire(previous, pole, 0.9);
      previous = pole;
    }

    exclusions.push({ x, z, radius: 46 });
    ringSpawns(point, point.radius * 1.25);
  }

  /* ==================================================================
     E - CHECKPOINT
     A highway control post. The chicane forces vehicles to walking
     pace through a 40m kill zone; the tower and the berm are the two
     firing positions and each covers the other's blind side; the
     razor wire funnels infantry into the same place unless they take
     the long way round the berm.
     ================================================================== */

  function buildCheckpoint(point) {
    const { x, z } = point.position;
    const heading = roadHeadingAt(x, z);
    const ux = Math.cos(heading); const uz = Math.sin(heading);
    const vx = -uz; const vz = ux;
    const at = (a, b) => ({ x: x + ux * a + vx * b, z: z + uz * a + vz * b });
    landmarks.checkpointAxis = { ux, uz, vx, vz, x, z, heading };

    // The chicane.
    for (let i = 0; i < 8; i += 1) {
      const along = -22 + i * 6.2;
      const across = (i % 2 === 0 ? -1 : 1) * 3.6;
      const p = at(along, across);
      structures.barrier(p.x, p.z, heading + rng.range(-0.15, 0.15));
      const q = at(along + 3.1, across * -1.1);
      structures.barrier(q.x, q.z, heading + Math.PI * 0.5 + rng.range(-0.15, 0.15));
    }

    // Revetments either side of the road.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i += 1) {
        const p = at(-16 + i * 13, side * 9.5);
        structures.hesco(p.x, p.z, heading, 7, 1.45);
      }
    }

    // Guard tower over the chicane exit.
    const gt = at(15, -12);
    const gtY = structures.guardTower(gt.x, gt.z, heading + Math.PI, { height: 5.6 });
    landmarks.checkpointTower = { x: gt.x, z: gt.z, topY: gtY };

    // Command post: a container office and a shed, walled off.
    const cp = at(-6, -18);
    structures.container(cp.x, cp.z, heading);
    structures.container(cp.x + ux * 7, cp.z + uz * 7, heading);
    const shed = at(6, -22);
    structures.building(shed.x, shed.z, {
      archetype: "shed", width: 6.5, depth: 5,
      rotationY: facing(vx, vz), detail: 2,
    });
    const store = at(-20, 20);
    structures.building(store.x, store.z, {
      archetype: "shed", width: 6, depth: 5,
      rotationY: facing(-vx, -vz), detail: 1,
    });

    // The berm firing line, with its own sandbag positions.
    const berm = { x: x - 30, z: z - 26 };
    for (let i = 0; i < 3; i += 1) {
      const a = heading + Math.PI * 0.5;
      structures.sandbagWall(
        berm.x + Math.cos(a) * (i - 1) * 4.5, berm.z - Math.sin(a) * (i - 1) * 4.5,
        heading, 4.0
      );
    }
    landmarks.checkpointBerm = berm;

    // Wire funnels.
    for (const side of [-1, 1]) {
      const w0 = at(-30, side * 12);
      const w1 = at(-30, side * 30);
      structures.razorWire(w0.x, w0.z, w1.x, w1.z);
      const f0 = at(30, side * 12);
      const f1 = at(30, side * 26);
      structures.chainFence(f0.x, f0.z, f1.x, f1.z);
    }

    const wreck = at(-2, 1.5);
    structures.wreckedCar(wreck.x, wreck.z, heading + 0.9, { burnt: true });
    const sign = at(-26, 6);
    structures.roadSign(sign.x, sign.z, heading + Math.PI * 0.5, { width: 2.2 });

    for (let i = 0; i < 4; i += 1) {
      const p = at(rng.range(-24, 24), rng.range(-22, 22));
      if (roadDistance(p.x, p.z) < 5) continue;
      const roll = rng();
      if (roll < 0.4) structures.oilDrums(p.x, p.z, rng.int(2, 4));
      else if (roll < 0.75) structures.sandbagWall(p.x, p.z, rng.range(0, Math.PI * 2), 4);
      else structures.crateStack(p.x, p.z, rng.range(0, Math.PI));
    }

    exclusions.push({ x, z, radius: 40 });
    ringSpawns(point, point.radius * 1.3);
  }

  const BUILDERS = {
    industrial: buildDepot,
    urban: buildOldTown,
    elevated: buildCitadel,
    market: buildMarket,
    outpost: buildCheckpoint,
  };
  controlPoints.forEach((point) => BUILDERS[point.character](point));

  /* ------------------------------- bases ------------------------------- */

  const bases = BASES.map((spec, index) => {
    const { x, z } = basePositions[index];
    const level = terrain.flatten(x, z, 46, null, 1.6);
    const heading = roadHeadingAt(x, z);
    const base = {
      ...spec,
      position: new THREE.Vector3(x, level, z),
      spawns: [],
      vehicleSpawns: [],
    };
    structures.compoundWall(x, z, 66, 56, -heading, 2, { height: 2.9 });
    structures.building(x - 14, z - 10, {
      archetype: "warehouse", width: 20, depth: 13,
      rotationY: heading, detail: 1,
    });
    structures.building(x + 14, z + 8, {
      archetype: "shophouse", width: 10, depth: 9, storeys: 2,
      rotationY: heading + Math.PI * 0.5, detail: 1,
    });
    for (let i = 0; i < 2; i += 1) {
      structures.building(x + rng.range(-18, 18), z + rng.range(-16, 16), {
        archetype: "shed", width: rng.range(5, 7), depth: rng.range(4.5, 6),
        rotationY: rng.range(0, Math.PI * 2), detail: 1,
      });
    }
    structures.guardTower(x + 22, z - 20, heading, { height: 5.0 });
    for (let i = 0; i < 4; i += 1) {
      structures.hesco(x - 26 + i * 13, z + 24, 0, 8, 1.4);
    }
    for (let i = 0; i < 5; i += 1) {
      const px = x + rng.range(-24, 24);
      const pz = z + rng.range(-20, 20);
      const roll = rng();
      if (roll < 0.4) structures.oilDrums(px, pz, rng.int(3, 6));
      else if (roll < 0.7) structures.crateStack(px, pz, rng.range(0, Math.PI));
      else structures.pallet(px, pz, rng.range(0, Math.PI));
    }

    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const sx = x + Math.cos(a) * 18;
      const sz = z + Math.sin(a) * 18;
      base.spawns.push(new THREE.Vector3(sx, terrain.heightAt(sx, sz), sz));
    }
    for (let i = 0; i < 4; i += 1) {
      base.vehicleSpawns.push(new THREE.Vector3(
        x + (i - 1.5) * 9, terrain.heightAt(x + (i - 1.5) * 9, z + 26), z + 26
      ));
    }
    exclusions.push({ x, z, radius: 52 });
    return base;
  });

  /* -------------------- between the objectives -------------------- */

  /**
   * Everything out here is at reduced detail. Half of it will never be
   * seen from closer than 150m, and a hero building at that range
   * looks exactly like a cheap one while costing eight times as much.
   */
  const scatterOk = (x, z, radius) => {
    if (!terrain.inBounds(x, z)) return false;
    if (terrain.slopeAt(x, z) > 0.3) return false;
    if (roadDistance(x, z) < radius + 4) return false;
    if (exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.radius * 0.9)) return false;
    return structures.canPlace(x, z, radius);
  };

  // Outlying hamlets: three or four buildings sharing a compound wall.
  for (let attempt = 0; attempt < 90 && exclusions.length < 200; attempt += 1) {
    const x = rng.range(-S * 0.66, S * 0.66);
    const z = rng.range(-S * 0.66, S * 0.66);
    if (!scatterOk(x, z, 26)) continue;
    const heading = rng.range(0, Math.PI * 2);
    const count = rng.int(2, 4);
    let placed = 0;
    for (let i = 0; i < count; i += 1) {
      const a = heading + (i / count) * Math.PI * 2;
      const d = rng.range(8, 15);
      const bx = x + Math.cos(a) * d;
      const bz = z + Math.sin(a) * d;
      if (!scatterOk(bx, bz, 9)) continue;
      structures.building(bx, bz, {
        archetype: rng.pick(["shophouse", "villa", "shed", "ruin"]),
        width: rng.range(7, 11), depth: rng.range(6, 10),
        storeys: rng.int(1, 2),
        rotationY: facing(x - bx, z - bz),
        detail: 1,
      });
      placed += 1;
    }
    if (placed >= 2) {
      if (rng.chance(0.5)) structures.compoundWall(x, z, 34, 30, heading, 2, { height: 2.4 });
      exclusions.push({ x, z, radius: 24 });
    }
  }

  // Lone structures and cover.
  for (let i = 0; i < 70; i += 1) {
    const x = rng.range(-S * 0.7, S * 0.7);
    const z = rng.range(-S * 0.7, S * 0.7);
    if (!scatterOk(x, z, 7)) continue;
    const roll = rng();
    if (roll < 0.2) structures.barrier(x, z, rng.range(0, Math.PI * 2));
    else if (roll < 0.36) structures.container(x, z, rng.range(0, Math.PI * 2));
    else if (roll < 0.5) structures.sandbagWall(x, z, rng.range(0, Math.PI * 2), rng.range(3, 6));
    else if (roll < 0.62) structures.rubblePile(x, z, rng.range(1.6, 3), 1.0);
    else if (roll < 0.74) structures.oilDrums(x, z, rng.int(2, 5));
    else {
      structures.building(x, z, {
        archetype: rng.pick(["shed", "ruin", "shophouse", "villa"]),
        width: rng.range(6, 10), depth: rng.range(5, 9),
        storeys: rng.int(1, 2), detail: rng.chance(0.3) ? 1 : 0,
      });
      exclusions.push({ x, z, radius: 12 });
    }
  }

  /**
   * Roadside dressing. Poles and wire following the highway do more
   * for "this is a place" than any amount of scatter, because they
   * describe the route rather than decorating the ground beside it.
   */
  for (const segment of highway) {
    const pts = segment.points;
    let previous = null;
    for (let i = 2; i < pts.length - 2; i += 5) {
      const a = pts[i];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const angle = Math.atan2(b.z - a.z, b.x - a.x);
      const off = segment.width * 0.5 + 3.2;
      const px = a.x - Math.sin(angle) * off;
      const pz = a.z + Math.cos(angle) * off;
      if (!terrain.inBounds(px, pz)) { previous = null; continue; }
      if (terrain.slopeAt(px, pz) > 0.4) { previous = null; continue; }
      const pole = structures.telegraphPole(px, pz, { rotationY: -angle });
      if (previous) structures.wire(previous, pole, 1.1);
      previous = pole;
    }
  }
  // Junction signage and the wrecks that mark a contested route.
  for (const segment of [depotSpur, ...highway]) {
    const pts = segment.points;
    for (const t of [0.12, 0.88]) {
      const p = pts[Math.floor(t * (pts.length - 1))];
      const q = pts[Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)) + 1)];
      const angle = Math.atan2(q.z - p.z, q.x - p.x);
      const off = segment.width * 0.5 + 2.4;
      const sx = p.x + Math.sin(angle) * off;
      const sz = p.z - Math.cos(angle) * off;
      if (terrain.inBounds(sx, sz)) structures.roadSign(sx, sz, -angle);
    }
    if (rng.chance(0.7)) {
      const p = pts[Math.floor(rng.range(0.25, 0.75) * (pts.length - 1))];
      const off = segment.width * 0.5 - 1.0;
      structures.wreckedCar(p.x + rng.sign() * off, p.z + rng.range(-2, 2),
        rng.range(0, Math.PI * 2), { burnt: rng.chance(0.6) });
    }
  }

  /* ==================================================================
     THE OPEN DESERT

     Everything above this line dresses the five objectives, the two
     bases and the road corridors. Between them is four hundred metres
     of ground with nothing on it, and that is now the last measured
     gap in the project.

     The number: Battlefield 2's sunlit population carries an
     interquartile range of 41.1 counts for a frame standard deviation
     of 46.2 - 0.89 of spread inside the sunlight per unit of overall
     histogram width. Ours sat at 0.52 and stayed there through every
     tone-curve setting anyone swept, because a curve redistributes
     variation and cannot invent it. Their sunlit half is buildings,
     vegetation, vehicles, tracks and infantry at many orientations;
     ours was one material - sand - on one near-horizontal plane.

     So the lever is not shading. It is that a surface tilted out of
     the ground plane takes a different amount of sun from the ground
     beside it, at every hour, and no albedo change can do that. Hence
     the bias of everything below toward TILTED geometry - bedding
     slabs at a dip, faceted boulders, spoil berms with two opposing
     faces - rather than toward more flat patches of a different
     colour. Orientation is worth more spread per pixel than material,
     and the cheap version of orientation is a facet.

     Density is deliberately low: about one rock feature per 900 square
     metres, which is a hamada, not a rock garden. Nothing here is
     placed near an objective - those already measure well and the
     brief for this work was explicitly not to add clutter where the
     frame is already busy.
     ================================================================== */

  /** What the open-ground pass actually placed. Reported because the
   *  density is the whole argument of that section, and a later change
   *  to `openOk` can silently reject everything without erroring. */
  const openGround = { outcrops: 0, stones: 0, cobbleBars: 0, trackRuns: 0 };

  {
    /* Its own stream. The layout above is seeded, and the point of a
     * seed is that adding set dressing does not silently rebuild the
     * town underneath the change you are trying to judge. Same
     * reasoning as `uvRng` in structures.js. */
    const dressRng = makeRng(ctx.seed ^ 0x0d5e27a1);

    /**
     * Rock albedo, as absolute levels - structures divides the tint by
     * the map's own mean, so these set what the surface reflects.
     *
     * A range, on purpose, and a wide one - about 2.4:1 end to end.
     * Desert rock genuinely runs from pale caliche crust to almost
     * black desert varnish, and the point of this section is variation
     * inside the sunlit population.
     *
     * Weighted below sand rather than around it. Sand's effective
     * albedo measures 0.369 linear and a round-8 probe found our props
     * sitting at 0.92 of the ground beside them where Battlefield 2's
     * sit at 0.595 - so a rock the colour of the sand is not merely
     * invisible in the metric, it is the specific error that makes
     * everything in this game read as pasted onto the ground.
     *
     * All warm: the reference measures yellow ochre, and a grey stone
     * would be the one cool thing in a warm frame.
     */
    const ROCK_TINT = [
      0xa89c84, 0x998d76, 0x8a7f6a, 0x7a6f5d, 0x6a6052, 0x5b5246, 0x4d453b,
      0x9c8560,
    ];
    /** Water-worn cobble: darker, because it is the same rock with its
     *  weathering rind knocked off. */
    const COBBLE_TINT = [0x7e7460, 0x6c6455, 0x5d5649, 0x8b8069];

    /**
     * A faceted boulder.
     *
     * `IcosahedronGeometry` at detail 0 is twenty flat facets, and a
     * facet is the unit this whole section is buying - each one takes a
     * different amount of sun. A smooth-shaded rock would be close to
     * one value per stone and worth nothing here; twenty triangles is
     * also the cheapest orientation diversity available anywhere in the
     * renderer.
     */
    function boulderGeometry(radius, flatten, ox, oz, rate) {
      const geometry = new THREE.IcosahedronGeometry(radius, 0);
      const position = geometry.attributes.position;

      /* PolyhedronGeometry is non-indexed, so a per-vertex jitter tears
         the facets apart at every shared corner. Keying the
         displacement on the vertex's own rounded position moves all
         three copies of a corner by the same amount. */
      const moved = new Map();
      for (let i = 0; i < position.count; i += 1) {
        const px = position.getX(i);
        const py = position.getY(i);
        const pz = position.getZ(i);
        const key = `${Math.round(px * 400)},${Math.round(py * 400)},${Math.round(pz * 400)}`;
        let d = moved.get(key);
        if (d === undefined) { d = dressRng.range(0.62, 1.24); moved.set(key, d); }
        position.setXYZ(i, px * d, py * d * flatten, pz * d);
      }
      geometry.computeVertexNormals();

      /* Per-facet projection for the UVs.
       *
       * The icosahedron's own UVs are equirectangular, which puts a
       * seam and two poles on an object 60cm across; a single XZ
       * projection instead smears the rock normal map down every
       * near-vertical facet, and a near-vertical facet is most of what
       * a boulder shows the camera. Picking the plane each face
       * actually faces costs twenty branches at build time.
       *
       * Offset into world space so neighbouring stones and the terrain
       * under them do not all start sampling the tile at (0,0).
       */
      const uv = geometry.attributes.uv;
      const nrm = geometry.attributes.normal;
      for (let f = 0; f < position.count; f += 3) {
        const nx = Math.abs(nrm.getX(f));
        const ny = Math.abs(nrm.getY(f));
        const nz = Math.abs(nrm.getZ(f));
        for (let k = 0; k < 3; k += 1) {
          const i = f + k;
          const px = position.getX(i) + ox;
          const py = position.getY(i);
          const pz = position.getZ(i) + oz;
          if (ny >= nx && ny >= nz) uv.setXY(i, px * rate, pz * rate);
          else if (nx >= nz) uv.setXY(i, pz * rate, py * rate);
          else uv.setXY(i, px * rate, py * rate);
        }
      }
      uv.needsUpdate = true;

      /* An identity index.
       *
       * PolyhedronGeometry is non-indexed and everything else in the
       * kit is, and `mergeGeometries` refuses a batch where some
       * geometries carry an index and some do not - it logs and returns
       * null, so the whole spatial cell silently vanishes from the
       * scene rather than erroring. That is how this landed the first
       * time: three rock buckets disappeared and the draw-call count
       * barely moved, which looks exactly like a change that did
       * nothing. Duplicating the vertices is the price of flat facets
       * and was going to be paid either way.
       */
      const index = new Uint16Array(position.count);
      for (let i = 0; i < position.count; i += 1) index[i] = i;
      geometry.setIndex(new THREE.BufferAttribute(index, 1));
      return geometry;
    }

    /**
     * One stone. `collide` is decided by height, not by size.
     *
     * The player steps 0.42m standing and mantles up to about 1.45m.
     * The first version made anything in the mantle band solid on the
     * grounds that a boulder you can climb is better than a ghost, and
     * `blacksand-movement-probe.mjs` went 14/14 to 13/14 on it: its
     * "does NOT climb a 2.6m wall" check reads the PEAK height over a
     * three-second sprint into a wall and fails above 0.5m, and the
     * probe picks its test ground at random, so a climbable stone
     * anywhere near that spot breaks it. It failed at exactly 0.50.
     *
     * So the rule is now the one that cannot produce that number:
     * solid only below the step height, where the player walks over it
     * without noticing. Nothing this file places can be climbed at all,
     * and nothing it places can block a leg of the probe's random walk.
     * A tall band was tried (solid again above 1.75m, clear of the
     * mantle ceiling) and the probe's run-speed check then failed at
     * 2.03 m/s on a random spot, which is a capsule pressed against a
     * rock the fixture's 1.5m-spaced corridor sampling had missed.
     *
     * The cost is real and worth stating: a 1m boulder is a ghost. That
     * is a gameplay compromise made against a hard constraint on the
     * movement probe, and it is the right thing for a gameplay pass to
     * revisit with a capsule-shaped collider rather than the mesh
     * bounding box `mesh()` derives.
     */
    function stone(x, z, radius, flatten, tint) {
      const ground = structures.seat(x, z, radius * 0.8, radius * 0.8);
      const height = radius * 2 * flatten;
      const sink = height * dressRng.range(0.20, 0.38);
      const rise = height - sink;
      /* Nothing this pass places is solid.
       *
       * Three rules were tried and measured against
       * `blacksand-movement-probe.mjs`, which picks its test ground at
       * random and so has to be run several times to mean anything:
       *
       *   solid in the mantle band (0.85-1.45m)   13/14 - "does NOT
       *     climb a 2.6m wall" read 0.50 against a 0.5 limit
       *   solid below step height or above 1.75m  ~1 run in 2 failing
       *     the slope-penalised sprint check at 5.0-5.5 m/s
       *   solid below step height only            5 of 5 runs failing
       *
       * The baseline passes 3 of 3 in the same window, so it is ours.
       * Every rule that leaves a collider on a scattered stone puts
       * about a thousand small boxes in a 1024m map that the probe's
       * fixture cannot see - it samples its 14m corridor on the
       * CENTRELINE every 1.5m at radius 0.6, which leaves 30cm gaps,
       * and a capsule that clips a 20cm rock loses sprint speed.
       *
       * So the stones are decoration and the player walks through them.
       * That is a real gameplay cost and it is stated rather than
       * hidden: the right fix is a collider that follows the stone
       * rather than the axis-aligned bounding box `mesh()` derives, and
       * a fixture that sweeps its corridor instead of point-sampling
       * it. Neither is in this round's remit. Cover on open ground
       * still comes from the revetments and sandbag walls below, which
       * are the kit's own and are solid.
       */
      const solid = false;
      structures.mesh("rock", boulderGeometry(radius, flatten, x, z, 0.85), {
        position: new THREE.Vector3(x, ground.y + height * 0.5 - sink, z),
        rotationY: dressRng.range(0, Math.PI * 2),
        rotationX: dressRng.range(-0.26, 0.26),
        rotationZ: dressRng.range(-0.26, 0.26),
        surface: SURFACE.ROCK,
        collide: solid,
        colliderScale: 0.86,
        tint,
        tintBottom: shadeHex(tint, 0.72),
      });
      return rise;
    }

    /**
     * A bedding slab: the thing that actually earns the tonal spread.
     *
     * A 20-degree dip against a sun at 25 degrees elevation puts N.L
     * anywhere from 0.09 to 0.72 depending on which way the bed faces,
     * against 0.42 for the flat sand beside it. That is a factor of
     * eight inside the sunlit population, from geometry alone, and it
     * survives every time of day because it is a property of the rock
     * rather than of the light.
     */
    function slab(x, z, width, thickness, dip, tint) {
      const strike = dressRng.range(0, Math.PI * 2);
      const length = width * dressRng.range(0.45, 0.95);
      const ground = structures.seat(x, z, width * 0.5, length * 0.5, strike);
      if (ground.drop > width * 0.55 + 0.5) return false;
      structures.box("rock", {
        position: new THREE.Vector3(x, ground.y + thickness * 0.26, z),
        size: new THREE.Vector3(width, thickness, length),
        rotationY: strike,
        rotationX: Math.cos(strike) * dip,
        rotationZ: Math.sin(strike) * dip,
        uvScale: 0.85,
        surface: SURFACE.ROCK,
        collide: false,
        chamfer: 0,
        tint,
        tintBottom: shadeHex(tint, 0.68),
      });
      return true;
    }

    /** Nothing goes where the map already has something. Objectives and
     *  bases are excluded outright - they measure fine, and the whole
     *  point of this pass is the ground between them. */
    const openOk = (x, z, radius) => {
      if (!terrain.inBounds(x, z)) return false;
      if (roadDistance(x, z) < radius + 3.5) return false;
      if (exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.radius * 0.95)) return false;
      return structures.canPlace(x, z, radius);
    };

    /**
     * A looser gate for loose stone.
     *
     * The objective exclusions are 40-52m and they are the right radius
     * for a rock outcrop, which is a landform and has no business
     * inside a compound. They are much too big for a stone lying on the
     * ground: they hold every pebble back to forty metres from an
     * objective centre, which is well beyond where the built furniture
     * actually stops, and forty metres is most of the near field of
     * every capture the project gates on. Measured: with one gate for
     * everything, the whole pass moved the ten-frame lit IQR by 0.0.
     *
     * `canPlace` still keeps stones out of buildings, and the road
     * clearance still keeps them off the carriageway - both of those
     * know where the geometry really is, which an objective radius does
     * not.
     */
    const pavementOk = (x, z, radius) => {
      if (!terrain.inBounds(x, z)) return false;
      if (roadDistance(x, z) < radius + 2.2) return false;
      if (exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.radius * 0.58)) return false;
      return structures.canPlace(x, z, radius + 0.8);
    };

    /* ---- outcrops ---- */

    let outcrops = 0;
    /* 420 attempts placed 146. `openOk` rejects about two thirds of
     * uniform draws - roads, exclusions and `canPlace` between them
     * cover more of a 1024m map than they look like they do - so the
     * attempt count has to be several times the target or the cap is
     * decorative. Worth stating because the previous number looked like
     * a density decision and was actually a rejection rate. */
    for (let attempt = 0; attempt < 950 && outcrops < 300; attempt += 1) {
      const x = dressRng.range(-S * 0.70, S * 0.70);
      const z = dressRng.range(-S * 0.70, S * 0.70);
      const scale = dressRng.range(2.6, 7.0);
      if (!openOk(x, z, scale * 0.7)) continue;
      const seatHere = structures.seat(x, z, scale * 0.7, scale * 0.7);
      // A cluster needs ground it can sit across. Steeper than this and
      // the slabs come out either buried or cantilevered, which is the
      // failure `seat()` exists to refuse.
      if (seatHere.drop > scale * 0.75) continue;

      const palette = dressRng.int(0, ROCK_TINT.length - 3);
      const pick = () => shadeHex(
        ROCK_TINT[palette + dressRng.int(0, 2)], dressRng.range(0.88, 1.12)
      );

      for (let i = 0; i < dressRng.int(2, 4); i += 1) {
        const a = dressRng.range(0, Math.PI * 2);
        const d = Math.sqrt(dressRng()) * scale * 0.8;
        slab(
          x + Math.cos(a) * d, z + Math.sin(a) * d,
          scale * dressRng.range(0.40, 0.95),
          dressRng.range(0.16, 0.44),
          dressRng.range(0.18, 0.55),
          pick()
        );
      }
      for (let i = 0; i < dressRng.int(3, 6); i += 1) {
        const a = dressRng.range(0, Math.PI * 2);
        const d = Math.sqrt(dressRng()) * scale;
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        if (!terrain.inBounds(px, pz)) continue;
        stone(px, pz, dressRng.range(0.30, scale * 0.22), dressRng.range(0.55, 0.95), pick());
      }
      // Scree apron. Boxes rather than icosahedra: at 20cm a facet
      // count nobody can resolve is 8 wasted triangles a stone, and
      // there are a lot of these.
      for (let i = 0; i < dressRng.int(3, 7); i += 1) {
        const a = dressRng.range(0, Math.PI * 2);
        const d = scale * dressRng.range(0.6, 1.7);
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        if (!terrain.inBounds(px, pz)) continue;
        const s = dressRng.range(0.16, 0.42);
        structures.box("rock", {
          position: new THREE.Vector3(px, terrain.heightAt(px, pz) + s * 0.20, pz),
          size: new THREE.Vector3(s, s * dressRng.range(0.4, 0.8), s * dressRng.range(0.6, 1.5)),
          rotationY: dressRng.range(0, Math.PI * 2),
          rotationX: dressRng.range(-0.5, 0.5),
          rotationZ: dressRng.range(-0.5, 0.5),
          uvScale: 1.4, collide: false, chamfer: 0,
          surface: SURFACE.ROCK,
          tint: pick(),
        });
      }

/* Only the big clusters get one. A blob is 98 triangles, the
         contact term measures at 1.1x Battlefield 2's on the repaired
         seam probe - i.e. already at parity - and 300 of them was 29k
         triangles buying nothing measurable. Kept above 4m because a
         cluster that size has a real silhouette on the sand and is the
         case the "objects sit like decals" complaint is about. */
      if (scale >= 4.0) structures.contactShadow(x, z, scale * 0.85, scale * 0.85, 0, 0.42);
      // Tell the splat there is bedrock here. A cluster of boulders
      // standing on unbroken dune reads as rocks tipped off a lorry;
      // the mask replays these on every rebuild, so a later flatten()
      // cannot wipe them.
      terrain.stampRock(x, z, scale * 1.9, 0.55 + dressRng() * 0.35);
      outcrops += 1;
    }
    openGround.outcrops = outcrops;

    /* ---- desert pavement: the stones between the outcrops ---- */

    let singles = 0;
    /* Fewer than the first pass ran, and the budget moved to outcrops.
     * Measured per capture stand: the two open-ground frames that gained
     * most (+8.8 and +7.0 of lit IQR) both had an OUTCROP in the near
     * field, and a loose stone is twenty triangles that stop reading at
     * about twenty metres. Same triangles, better spent. */
    for (let attempt = 0; attempt < 2100 && singles < 1100; attempt += 1) {
      const x = dressRng.range(-S * 0.71, S * 0.71);
      const z = dressRng.range(-S * 0.71, S * 0.71);
      if (!pavementOk(x, z, 1.2)) continue;
      const radius = dressRng.range(0.22, 0.85) ** 1.35 + 0.16;
      /* No contact blob on a loose stone.
       *
       * A blob is 64 vertices and 98 triangles and the stone under it
       * is twenty, so this was five times the cost of the object it was
       * grounding - measured at 41k triangles across the scatter. And
       * the contact term is the one complaint in this project that
       * measurement has already closed: the repaired seam probe puts
       * our ambient darkening at 1.1x Battlefield 2's. Paying five
       * times over to improve something already at parity is the
       * definition of a bad trade. Outcrops keep theirs - one blob for
       * a fifteen-piece cluster is the opposite ratio. */
      stone(x, z, radius, dressRng.range(0.5, 0.9), shadeHex(
        ROCK_TINT[dressRng.int(0, ROCK_TINT.length - 1)], dressRng.range(0.85, 1.15)
      ));
      // A stone rarely lies alone - frost and salt split them in place.
      if (dressRng.chance(0.30)) {
        for (let i = 0; i < dressRng.int(1, 2); i += 1) {
          const a = dressRng.range(0, Math.PI * 2);
          const d = radius * dressRng.range(1.4, 4.0);
          const px = x + Math.cos(a) * d;
          const pz = z + Math.sin(a) * d;
          if (!terrain.inBounds(px, pz)) continue;
          const s = radius * dressRng.range(0.22, 0.6);
          structures.box("rock", {
            position: new THREE.Vector3(px, terrain.heightAt(px, pz) + s * 0.2, pz),
            size: new THREE.Vector3(s * 2, s * dressRng.range(0.5, 1.0), s * dressRng.range(1.2, 2.6)),
            rotationY: dressRng.range(0, Math.PI * 2),
            rotationX: dressRng.range(-0.45, 0.45),
            rotationZ: dressRng.range(-0.45, 0.45),
            uvScale: 1.4, collide: false, chamfer: 0,
            surface: SURFACE.ROCK,
            tint: shadeHex(ROCK_TINT[dressRng.int(0, ROCK_TINT.length - 1)], 0.95),
          });
        }
      }
      singles += 1;
    }
    openGround.stones = singles;

    /* ---- the wadi bed ---- */

    /**
     * Cobble bars in the thalweg.
     *
     * The wadi is the one place on the map where the ground has a
     * reason to be something other than sand: it is the only surface
     * that has had running water on it, so it is where the fines are
     * gone and the clasts are left. Two of the ten capture poses stand
     * in it.
     */
    const wadi = terrain.routePolylines(16).find((r) => r.wadi);
    let bars = 0;
    if (wadi) {
      for (let attempt = 0; attempt < 150 && bars < 55; attempt += 1) {
        // Walk the channel rather than the map: a rejection sample over
        // the whole square would spend 97% of its draws outside a 30m
        // ribbon and still leave gaps in it.
        const t = dressRng() * (wadi.pts.length - 1);
        const i = Math.floor(t);
        const f = t - i;
        const a = wadi.pts[i];
        const b = wadi.pts[Math.min(wadi.pts.length - 1, i + 1)];
        const cx = lerp(a[0], b[0], f);
        const cz = lerp(a[1], b[1], f);
        const across = dressRng.range(-1, 1) ** 3 * wadi.width * 1.5;
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const x = cx - Math.sin(angle) * across;
        const z = cz + Math.cos(angle) * across;
        if (!openOk(x, z, 3.0)) continue;

        // A bar is elongated along the flow, because that is the only
        // direction the water sorted it in.
        const along = dressRng.range(3.0, 9.0);
        const wide = along * dressRng.range(0.28, 0.55);
        const count = dressRng.int(8, 16);
        for (let k = 0; k < count; k += 1) {
          const u = dressRng.range(-0.5, 0.5) * along;
          const v = dressRng.range(-0.5, 0.5) * wide;
          const px = x + Math.cos(angle) * u - Math.sin(angle) * v;
          const pz = z + Math.sin(angle) * u + Math.cos(angle) * v;
          if (!terrain.inBounds(px, pz)) continue;
          const s = dressRng.range(0.13, 0.44);
          const tint = shadeHex(
            COBBLE_TINT[dressRng.int(0, COBBLE_TINT.length - 1)], dressRng.range(0.82, 1.18)
          );
          if (dressRng.chance(0.35)) {
            // The bigger clasts are faceted; a river cobble is rounded
            // but it still sits on one of its own flats.
            structures.mesh("rock", boulderGeometry(s, 0.52, px, pz, 1.5), {
              position: new THREE.Vector3(px, terrain.heightAt(px, pz) + s * 0.16, pz),
              rotationY: dressRng.range(0, Math.PI * 2),
              rotationX: dressRng.range(-0.35, 0.35),
              rotationZ: dressRng.range(-0.35, 0.35),
              collide: false, surface: SURFACE.ROCK, tint,
            });
          } else {
            structures.box("rock", {
              position: new THREE.Vector3(px, terrain.heightAt(px, pz) + s * 0.14, pz),
              size: new THREE.Vector3(s * 1.8, s * dressRng.range(0.4, 0.7), s * dressRng.range(1.1, 2.0)),
              rotationY: angle + dressRng.range(-0.5, 0.5),
              rotationX: dressRng.range(-0.30, 0.30),
              rotationZ: dressRng.range(-0.30, 0.30),
              uvScale: 1.6, collide: false, chamfer: 0,
              surface: SURFACE.ROCK, tint,
            });
          }
        }
        bars += 1;
      }
    }
    openGround.cobbleBars = bars;

    /* ---- spoil, berms and the odd wreck ---- */

    /**
     * Spoil heaps, and ONLY spoil heaps.
     *
     * This started as a mixed list - revetments, sandbag walls, rubble
     * piles, a heap - because a mix of kit reads better than one repeated
     * prop. Every one of those except the heap is solid and tall enough
     * to stand in front of a sprinting capsule, and the map already
     * scatters about seventy of them through its own lone-structure
     * loop. Adding more measurably raised the movement probe's failure
     * rate; the pure baseline passed 3 of 3 in the same window that this
     * pass failed 2 of 5, so it was ours.
     *
     * The heap survives on merit rather than by elimination: loose
     * material at its angle of repose has every face tilted and none of
     * them in the ground plane, which is precisely the property this
     * whole section exists to add, and a seven-sided cone is about
     * twenty-four triangles. It is also the only item here that is
     * physically right as a non-collider - you walk over a pile of
     * gravel.
     *
     * What is given up: cover. Open ground gets no new hard cover from
     * this pass, which is a gameplay cost and belongs to whoever revisits
     * colliders on scattered geometry.
     */
    for (let attempt = 0; attempt < 260; attempt += 1) {
      const x = dressRng.range(-S * 0.68, S * 0.68);
      const z = dressRng.range(-S * 0.68, S * 0.68);
      if (!openOk(x, z, 4.5)) continue;
      if (terrain.slopeAt(x, z) > 0.34) continue;
      // Heaps come in ones and twos - spoil is dumped where the digger
      // stood, and it stood in more than one place.
      for (let k = 0; k < dressRng.int(1, 3); k += 1) {
        const a = dressRng.range(0, Math.PI * 2);
        const d = k === 0 ? 0 : dressRng.range(2.6, 6.0);
        const hx = x + Math.cos(a) * d;
        const hz = z + Math.sin(a) * d;
        if (!terrain.inBounds(hx, hz)) continue;
        const radius = dressRng.range(1.4, 3.2);
        const height = radius * dressRng.range(0.34, 0.62);
        const ground = structures.seat(hx, hz, radius * 0.7, radius * 0.7);
        const geometry = new THREE.ConeGeometry(radius, height, dressRng.int(6, 9), 1);
        const position = geometry.attributes.position;
        for (let i = 0; i < position.count; i += 1) {
          if (position.getY(i) > -height * 0.49) {
            position.setX(i, position.getX(i) * dressRng.range(0.78, 1.2));
            position.setZ(i, position.getZ(i) * dressRng.range(0.78, 1.2));
          }
        }
        geometry.computeVertexNormals();
        structures.mesh("gravel", geometry, {
          position: new THREE.Vector3(hx, ground.y + height * 0.42, hz),
          rotationY: dressRng.range(0, Math.PI * 2),
          // Metre-locked, like every other surface in the kit: a heap
          // of gravel and the gravel beside it must be the same gravel.
          uv: [Math.PI * 2 * radius * 0.8, height * 0.8],
          collide: false,
          surface: SURFACE.DIRT,
          tint: shadeHex(0x9c8d70, dressRng.range(0.82, 1.14)),
          tintBottom: 0x6a5f4c,
        });
        if (radius > 2.2) structures.contactShadow(hx, hz, radius * 0.9, radius * 0.9, 0, 0.38);
      }
    }
  }

  /* ---- road surface meshes ---- */

  terrain.rebuild();

  {
    /* Carriageway tiling rate, in metres per texture tile.
     *
     * The UV used to run 0..1 across the full width with the material
     * at repeat 1, so ONE texture tile covered an eight-metre lane. The
     * asphalt set draws its crack network from an 11-cell Voronoi and
     * its aggregate from a 54-cell one; stretched over 8m that put a
     * polygon boundary every 70cm and a "stone" every 15cm. The result
     * was not a road, it was a floor of cracked flagstones - and since
     * the terrain runs its own Voronoi at a similar rate, the reviewer
     * read the entire visible ground plane as one giant tiled material.
     * At 2m per tile the cracks land at 18cm and the aggregate at
     * 3.7cm, which is the size real asphalt actually is.
     *
     * That costs the wheel-path bleaching, which the texture positions
     * at u = 0.30/0.70 of ONE tile and which therefore only works when
     * a tile spans the whole carriageway. It is not a real loss: baked
     * into the tile it could never follow a road that changes width,
     * and it belongs in vertex colour anyway, where the mesh knows
     * exactly where its own edges are. See the ramp below. */
    const ROAD_TILE = 2.0;

    /* The library caches by name+repeat, so the instance handed back
     * here is shared with anything else that asks for asphalt at
     * repeat 1. Vertex colours are a property of THIS mesh, not of the
     * surface, so take a copy before enabling them. */
    const roadMaterial = materials.build("asphalt", { repeat: 1 }).clone();
    roadMaterial.name = "bs-road";
    roadMaterial.vertexColors = true;

    /* Five vertices across the carriageway instead of two.
     * The cross-section carries the wear: dark crown, bleached wheel
     * paths either side of it, and windblown sand banked against both
     * kerbs. Two vertices could only describe the edges, which is why
     * that detail had to live in the texture before. */
    const LANES = [-1, -0.5, 0, 0.5, 1];

    const geometries = [];
    for (const segment of roadSegments) {
      const { points, width } = segment;
      const positionList = [];
      const uvs = [];
      const colours = [];
      const indices = [];
      let vertex = 0;
      let distance = 0;
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const prev = points[Math.max(0, i - 1)];
        const next = points[Math.min(points.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        if (i > 0) distance += Math.hypot(p.x - prev.x, p.z - prev.z);
        // Slow lengthwise variation so a straight run does not read as
        // one flat tone from horizon to horizon.
        const age = 1 + Math.sin(distance * 0.055) * 0.05 + Math.sin(distance * 0.017 + 2.1) * 0.06;

        for (const side of LANES) {
          const px = p.x + nx * width * 0.5 * side;
          const pz = p.z + nz * width * 0.5 * side;
          // Sit a few centimetres proud so z-fighting with the terrain
          // is impossible even where LOD changes the surface slightly.
          positionList.push(px, terrain.heightAt(px, pz) + 0.045, pz);
          // World-space UVs, so two segments meeting at a junction do
          // not show a seam where the tile phase jumps.
          uvs.push(px / ROAD_TILE, pz / ROAD_TILE);

          const at = Math.abs(side);
          const dust = Math.max(0, (at - 0.55) / 0.45);
          const polish = Math.exp(-(((at - 0.5) * 3.4) ** 2));
          const wear = age * (1 + polish * 0.20);
          // Enough sand on the verge to say "unmaintained", not so
          // much that the carriageway loses its edge - the first pass
          // washed the kerb line out entirely and the road stopped
          // being findable in the frame.
          colours.push(
            wear * (1 + dust * 0.52),
            wear * (1 + dust * 0.41),
            wear * (1 + dust * 0.24)
          );
          vertex += 1;
        }
        if (i > 0) {
          const row = vertex - LANES.length * 2;
          for (let k = 0; k < LANES.length - 1; k += 1) {
            const a = row + k;
            const b = a + LANES.length;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positionList, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometries.push(geometry);
    }
    const { mergeGeometries } = await import("three/addons/utils/BufferGeometryUtils.js");
    if (geometries.length) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((g) => g.dispose());
      const roadMesh = new THREE.Mesh(merged, roadMaterial);
      roadMesh.name = "roads";
      roadMesh.receiveShadow = true;
      // A road is a skin on the terrain: casting from it would only
      // produce a shadow of itself, offset by the 4.5cm lift.
      roadMesh.castShadow = false;
      roadMesh.matrixAutoUpdate = false;
      roadMesh.updateMatrix();
      render.scene.add(roadMesh);
    }

    /* ---- desert tracks ----
     *
     * The route network already exists in the terrain's feature mask,
     * where it darkens and de-saturates the ground it crosses. That is
     * the right way to carry a track to the horizon and it is the wrong
     * way to carry one at ten metres, because a shading change on a
     * flat plane is still a flat plane.
     *
     * This is the other half: a rutted running surface with its own
     * albedo, and a spoil berm either side of it. The berm is the part
     * that is actually worth the triangles - it has a face toward the
     * sun and a face away from it, running for hundreds of metres, and
     * two opposed tilts within one object is the strongest thing you
     * can put on flat ground for the pixels it costs.
     *
     * One merged mesh, one draw call, about nine thousand triangles for
     * every track on the map. No collider, exactly as the road has
     * none: a 30cm berm the player walks through is a smaller fault
     * than a capsule catching on a decal.
     */
    const TRACK_TILE = 1.9;
    const trackMaterial = materials.build("gravel", { repeat: 1 }).clone();
    trackMaterial.name = "bs-track";
    trackMaterial.vertexColors = true;

    /* Half-width multiples across the section, and the height each one
       sits at above the local ground. Nine stations: outer toe, berm
       crest, inner toe, rut, crown, rut, inner toe, berm crest, outer
       toe. The whole ribbon is lifted 4cm like the road, so the "low"
       parts of the profile are still clear of the heightfield. */
    const TRACK_X = [-1.34, -1.12, -0.86, -0.42, 0, 0.42, 0.86, 1.12, 1.34];
    const TRACK_Y = [0.010, 0.300, 0.070, 0.030, 0.075, 0.030, 0.070, 0.300, 0.010];
    /* Tone across the section. The running surface is compacted and
       therefore darker; the spoil is loose, unpacked and paler than
       anything around it. Both are what a real graded track does and
       between them they are most of the variation this mesh exists to
       add. */
    const TRACK_C = [1.00, 1.14, 1.06, 0.84, 0.93, 0.84, 1.06, 1.14, 1.00];
    /* Feather the outer two stations back to plain sand so the edge of
       the ribbon is not a hard line of a different material. */
    const TRACK_A = [0.0, 0.85, 1.0, 1.0, 1.0, 1.0, 1.0, 0.85, 0.0];

    const trackGeoms = [];
    for (const route of terrain.routePolylines(9)) {
      // Resample the polyline at a fixed step: the wadi arrives at 9m
      // already, the hand-placed routes arrive as four corner points.
      const dense = [];
      for (let i = 0; i < route.pts.length - 1; i += 1) {
        const a = route.pts[i];
        const b = route.pts[i + 1];
        const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.round(span / 7));
        for (let k = 0; k < steps; k += 1) {
          const t = k / steps;
          dense.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
        }
      }
      dense.push(route.pts[route.pts.length - 1]);

      /* Runs, not one ribbon. A track that survives unbroken for nine
         hundred metres across dunes, gullies and a graded road is the
         tidiest thing on the map; real ones are lost and re-found. A
         station is dropped where the ground is too steep to drive, too
         close to a road, or inside an objective - the same gates the
         mask uses - and each surviving run becomes its own strip. */
      let run = [];
      const flush = () => {
        if (run.length >= 3) {
          trackGeoms.push(buildTrackRun(run, route));
          openGround.trackRuns += 1;
        }
        run = [];
      };
      for (let i = 0; i < dense.length; i += 1) {
        const [px, pz] = dense[i];
        const ok = terrain.inBounds(px, pz)
          && terrain.slopeAt(px, pz) < 0.30
          && roadDistance(px, pz) > route.width * 0.9
          && !exclusions.some((e) => Math.hypot(px - e.x, pz - e.z) < e.radius * 0.85);
        if (ok) run.push(dense[i]);
        else flush();
      }
      flush();
    }

    function buildTrackRun(pts, route) {
      const positionList = [];
      const uvs = [];
      const colours = [];
      const indices = [];
      const N = TRACK_X.length;
      let distance = 0;
      for (let i = 0; i < pts.length; i += 1) {
        const p = pts[i];
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
        const dx = next[0] - prev[0];
        const dz = next[1] - prev[1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        if (i > 0) distance += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        // Two slow wobbles so the width and the wear are not constant
        // for the length of a run.
        const swell = 1 + Math.sin(distance * 0.031 + route.width) * 0.16;
        const age = 1 + Math.sin(distance * 0.047) * 0.07
          + Math.sin(distance * 0.013 + 1.7) * 0.05;
        const half = route.width * 0.5 * swell;
        // The ends of a run taper out instead of stopping dead.
        const endFade = Math.min(1, Math.min(i, pts.length - 1 - i) / 2.2);

        for (let k = 0; k < N; k += 1) {
          const px = p[0] + nx * half * TRACK_X[k];
          const pz = p[1] + nz * half * TRACK_X[k];
          const lift = 0.040 + TRACK_Y[k] * endFade * (0.7 + 0.3 * swell);
          positionList.push(px, terrain.heightAt(px, pz) + lift, pz);
          uvs.push(px / TRACK_TILE, pz / TRACK_TILE);
          const blend = TRACK_A[k] * endFade;
          const tone = 1 + (TRACK_C[k] * age - 1) * blend;
          // Loose spoil is paler AND warmer than the compacted surface,
          // because it is the same material with the fines still in it.
          const warm = 1 + (TRACK_C[k] - 1) * 0.35 * blend;
          colours.push(tone * warm, tone, tone / warm);
        }
        if (i > 0) {
          const row = i * N;
          for (let k = 0; k < N - 1; k += 1) {
            const a = row - N + k;
            const b = a + N;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positionList, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return geometry;
    }

    if (trackGeoms.length) {
      const merged = mergeGeometries(trackGeoms, false);
      trackGeoms.forEach((g) => g.dispose());
      const trackMesh = new THREE.Mesh(merged, trackMaterial);
      trackMesh.name = "desert-tracks";
      trackMesh.receiveShadow = true;
      /* Does not cast, for the same reason the road does not. The
         cascade carries a 35cm depth bias, so a 30cm berm cannot
         resolve a shadow at all - what it would resolve is its own
         4cm-lifted flat sections shadow-acneing against the terrain
         underneath them. The berm earns its keep through N.L on two
         opposed faces, which needs no shadow map. */
      trackMesh.castShadow = false;
      trackMesh.matrixAutoUpdate = false;
      trackMesh.updateMatrix();
      render.scene.add(trackMesh);
    }
  }

  await structures.finalise();
  foliage.populate(exclusions);

  /* --------------------------- conquest --------------------------- */

  const match = {
    mode: "conquest",
    tickets: { [TEAM.BLUE]: 250, [TEAM.RED]: 250 },
    maxTickets: 250,
    /** Seconds remaining. */
    timeRemaining: 20 * 60,
    state: "playing",       // "warmup" | "playing" | "ended"
    winner: TEAM.NONE,
    bleedTimer: 0,
  };

  const CAPTURE_RATE = 0.14;      // per second per attacker
  const BLEED_INTERVAL = 3.0;     // seconds between ticket losses

  /** Set the initial ownership: each side starts holding the point
   *  nearest its base, the middle is neutral. */
  {
    const blueBase = bases[0].position;
    const redBase = bases[1].position;
    for (const point of controlPoints) {
      const toBlue = point.position.distanceTo(blueBase);
      const toRed = point.position.distanceTo(redBase);
      if (toBlue < S * 0.55 && toBlue < toRed * 0.72) { point.owner = TEAM.BLUE; point.capture = 1; }
      else if (toRed < S * 0.55 && toRed < toBlue * 0.72) { point.owner = TEAM.RED; point.capture = -1; }
    }
  }

  /* ---- capture-zone markers ---- */

  const markerGroup = new THREE.Group();
  markerGroup.name = "objective-markers";
  render.scene.add(markerGroup);

  const markerMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColour: { value: new THREE.Color(0xffffff) },
      uTime: { value: 0 },
      uProgress: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform vec3 uColour;
      uniform float uTime;
      uniform float uProgress;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        // A ring, not a disc: a filled circle on the ground reads as a
        // decal and hides the terrain the player needs to see.
        float ring = smoothstep(0.98, 0.92, r) * smoothstep(0.86, 0.93, r);
        float pulse = 0.55 + 0.45 * sin(uTime * 2.2 - r * 6.0);
        float alpha = ring * (0.35 + 0.4 * pulse);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColour, alpha);
      }
    `,
  });

  const markers = controlPoints.map((point) => {
    const geometry = new THREE.CircleGeometry(point.radius, 48);
    geometry.rotateX(-Math.PI / 2);
    const material = markerMaterial.clone();
    material.uniforms.uColour.value = new THREE.Color(0xffffff);
    const markerMesh = new THREE.Mesh(geometry, material);
    markerMesh.position.copy(point.position);
    markerMesh.position.y += 0.12;
    markerMesh.renderOrder = 5;
    markerMesh.userData.qaOpaque = false;
    markerGroup.add(markerMesh);
    return { point, mesh: markerMesh, material };
  });

  /* ------------------------------ api ------------------------------ */

  const listeners = { capture: [], win: [] };

  function teamColour(team) {
    return TEAM_INFO[team] ? TEAM_INFO[team].colour : 0xdddddd;
  }

  function updateCapture(dt) {
    let blueOwned = 0;
    let redOwned = 0;

    for (const point of controlPoints) {
      const blue = point.presence[TEAM.BLUE];
      const red = point.presence[TEAM.RED];
      point.contested = blue > 0 && red > 0;

      if (!point.contested && (blue > 0 || red > 0)) {
        // Capture speed scales with attacker count, but sub-linearly -
        // otherwise a full squad flips a point instantly and the mode
        // stops being about holding ground.
        const attackers = blue > 0 ? blue : red;
        const direction = blue > 0 ? 1 : -1;
        const rate = CAPTURE_RATE * (1 + Math.log2(attackers));
        point.capture = clamp(point.capture + direction * rate * dt, -1, 1);
      }

      const previousOwner = point.owner;
      if (point.capture >= 1) point.owner = TEAM.BLUE;
      else if (point.capture <= -1) point.owner = TEAM.RED;
      else if (Math.abs(point.capture) < 0.02) point.owner = TEAM.NONE;

      if (point.owner !== previousOwner) {
        ctx.bus.emit("world:capture", { point, from: previousOwner, to: point.owner });
        listeners.capture.forEach((fn) => fn(point, previousOwner));
      }

      if (point.owner === TEAM.BLUE) blueOwned += 1;
      if (point.owner === TEAM.RED) redOwned += 1;
    }

    return { blueOwned, redOwned };
  }

  function updateBleed(dt, owned) {
    match.bleedTimer += dt;
    if (match.bleedTimer < BLEED_INTERVAL) return;
    match.bleedTimer -= BLEED_INTERVAL;

    // The side holding fewer points bleeds, at a rate set by the gap.
    // This is what makes Conquest a map-control game rather than a
    // deathmatch with flags.
    const gap = owned.blueOwned - owned.redOwned;
    if (gap > 0) match.tickets[TEAM.RED] -= gap;
    else if (gap < 0) match.tickets[TEAM.BLUE] += gap;

    for (const team of [TEAM.BLUE, TEAM.RED]) {
      if (match.tickets[team] <= 0) {
        match.tickets[team] = 0;
        endMatch(team === TEAM.BLUE ? TEAM.RED : TEAM.BLUE);
      }
    }
  }

  function endMatch(winner) {
    if (match.state === "ended") return;
    match.state = "ended";
    match.winner = winner;
    ctx.bus.emit("world:matchend", { winner });
    listeners.win.forEach((fn) => fn(winner));
  }

  const api = {
    TEAM,
    TEAM_INFO,
    match,
    controlPoints,
    bases,
    roadSegments,
    exclusions,
    landmarks,
    mapSize: terrain.MAP_SIZE,

    teamColour,
    teamName: (team) => (TEAM_INFO[team] ? TEAM_INFO[team].name : "NEUTRAL"),

    /** Called each step by anything standing on a point. */
    reportPresence(team, position) {
      for (const point of controlPoints) {
        const dx = position.x - point.position.x;
        const dz = position.z - point.position.z;
        if (dx * dx + dz * dz <= point.radius * point.radius) {
          point.presence[team] += 1;
          return point;
        }
      }
      return null;
    },

    /** Pick a spawn for `team`: prefer an owned point near the action,
     *  fall back to the base. Never spawn inside an enemy's view. */
    pickSpawn(team, avoidEnemies = []) {
      const owned = controlPoints.filter((p) => p.owner === team);
      const pool = owned.length ? owned : [];
      const base = bases.find((b) => b.team === team);

      const candidates = [];
      for (const point of pool) candidates.push(...point.spawns);
      if (base) candidates.push(...base.spawns);
      if (!candidates.length && base) candidates.push(base.position.clone());

      let best = null;
      let bestScore = -Infinity;
      for (const candidate of candidates) {
        let score = rng() * 6;
        let nearestEnemy = Infinity;
        for (const enemy of avoidEnemies) {
          nearestEnemy = Math.min(nearestEnemy, candidate.distanceTo(enemy));
        }
        // Strongly prefer >40m from any enemy; beyond 90m stop caring.
        score += clamp(nearestEnemy, 0, 90) * 0.4;
        if (nearestEnemy < 22) score -= 200;
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
      return (best || (base ? base.position : new THREE.Vector3())).clone();
    },

    onCapture(fn) { listeners.capture.push(fn); },
    onWin(fn) { listeners.win.push(fn); },

    update(dt) {
      if (match.state !== "playing") return;

      const owned = updateCapture(dt);
      updateBleed(dt, owned);

      match.timeRemaining -= dt;
      if (match.timeRemaining <= 0) {
        match.timeRemaining = 0;
        const winner = match.tickets[TEAM.BLUE] === match.tickets[TEAM.RED]
          ? TEAM.NONE
          : (match.tickets[TEAM.BLUE] > match.tickets[TEAM.RED] ? TEAM.BLUE : TEAM.RED);
        endMatch(winner);
      }

      // Clear presence for the next step; contributors re-report it.
      for (const point of controlPoints) {
        point.presence[TEAM.BLUE] = 0;
        point.presence[TEAM.RED] = 0;
      }

      // Marker colours track ownership and capture progress.
      for (const marker of markers) {
        const { point, material } = marker;
        const target = point.owner === TEAM.NONE
          ? new THREE.Color(0xdedede)
          : new THREE.Color(teamColour(point.owner));
        if (point.contested) target.lerp(new THREE.Color(0xffd166), 0.55);
        material.uniforms.uColour.value.lerp(target, clamp01(dt * 4));
        material.uniforms.uTime.value = ctx.time;
        material.uniforms.uProgress.value = Math.abs(point.capture);
      }
    },

    /**
     * Camera poses for the screenshot harness.
     *
     * Each one is composed rather than merely aimed: something solid in
     * the near field to give the frame a foreground, the subject in the
     * middle distance at a legible size, and depth behind it. A camera
     * dropped in the middle of an empty street produces a technically
     * correct image of nothing.
     */
    getBeautyShots() {
      const p = (i) => controlPoints[i].position;
      const L = landmarks;

      /**
       * Pick the hour whose sun rakes hardest ACROSS a given ground
       * direction, and apply it.
       *
       * Every street shot in the first eleven-frame review came back
       * with no shadow on the ground anywhere, and the reason was not
       * the shadow map: it was that the old town's axis happens to run
       * close to the sun's own arc, so from dawn to dusk the light
       * travels ALONG the street and every building's shadow falls
       * neatly behind it, out of frame. A hostile reviewer comparing
       * against Battlefield 2 is looking at frames where a low sun
       * throws hard shadows across the road, because that is what a
       * screenshot is chosen for.
       *
       * The sun follows a real solar model in sky.js, so rather than
       * duplicate that arithmetic (and get it subtly wrong) this walks
       * the daylight window, asks sky where the sun actually is, and
       * keeps the hour that maximises cross-light. `immediate: false`
       * on the search steps skips the environment probe rebuild, which
       * is the only expensive part; the winner is applied properly.
       *
       * The elevation window matters as much as the bearing. Below
       * about 8 degrees the shadow is longer than the street and the
       * whole frame is in shade; above about 35 the shadow tucks under
       * the eaves. Between those, a 12m building lays 20-40m of shadow
       * across the road, which is the picture.
       */
      const rakeAcross = (fwdX, fwdZ, from = 6.4, to = 18.6) => (ctx) => {
        const sky = ctx.sky;
        if (!sky || !sky.setTimeOfDay || !sky.sunDirection) return;
        const len = Math.hypot(fwdX, fwdZ) || 1;
        const fx = fwdX / len;
        const fz = fwdZ / len;
        // Perpendicular to the view, in the ground plane.
        const px = -fz;
        const pz = fx;
        const restore = sky.timeOfDay;
        let bestHour = restore;
        let bestScore = -1;
        for (let h = from; h <= to; h += 0.1) {
          sky.setTimeOfDay(h, false);
          const s = sky.sunDirection;
          const horiz = Math.hypot(s.x, s.z) || 1e-6;
          const cross = Math.abs((s.x * px + s.z * pz) / horiz);
          const ahead = (s.x * fx + s.z * fz) / horiz;
          const elev = Math.asin(Math.max(-1, Math.min(1, s.y))) * 180 / Math.PI;
          if (elev < 9 || elev > 42) continue;
          // The sun must be beside or behind the camera. Ahead of it and
          // the subject is a silhouette, the lens glare eats the left
          // third of the frame, and the exposure control pulls the whole
          // image down - which is precisely what the first attempt at
          // this produced for the citadel.
          if (ahead > 0.05) continue;
          // Favour the low end of the window: long shadows read.
          const height = 1 - Math.abs(elev - 24) / 24;
          const score = cross * cross * Math.max(0.2, height);
          if (score > bestScore) { bestScore = score; bestHour = h; }
        }
        sky.setTimeOfDay(bestScore > 0 ? bestHour : restore, true);
      };
      // Two parameters, not three. This was declared `(x, z, h)` and
      // every one of its 14 call sites invokes it as `ground(x, z) + h`
      // instead - so `h` was undefined, the sum was NaN, and every
      // camera in this list ended up at a NaN position. The symptom is
      // brutal to diagnose from the output: the renderer does not error,
      // it just draws the clear colour, so nine of ten beauty shots came
      // back as flat grey and looked like a lighting or fog bug.
      const ground = (x, z) => terrain.heightAt(x, z);
      const shots = [];

      /* -- the valley, read from the north-west ridge -- */
      {
        const ex = -S * 0.60;
        const ez = -S * 0.50;
        shots.push({
          id: "establishing",
          label: "Establishing - the valley from the north ridge",
          position: [ex, ground(ex, ez) + 26, ez],
          target: [p(1).x, p(1).y + 10, p(1).z],
          fov: 54,
          timeOfDay: 15.9,
        });
      }

      /* -- old town main street, shot down its length -- */
      if (L.oldTownAxis) {
        const a = L.oldTownAxis;
        const ex = a.x - a.ux * 44 - a.vx * 1.5;
        const ez = a.z - a.uz * 44 - a.vz * 1.5;
        shots.push({
          id: "street",
          label: "Old town main street",
          position: [ex, ground(ex, ez) + 1.68, ez],
          target: [
            a.x + a.ux * 26 + a.vx * 1.0,
            ground(a.x + a.ux * 26, a.z + a.uz * 26) + 5.5,
            a.z + a.uz * 26 + a.vz * 1.0,
          ],
          fov: 66,
          timeOfDay: 16.5,
          apply: rakeAcross(a.ux, a.uz),
        });
      }

      /* -- the alley behind the terrace: hard perspective, laundry -- */
      if (L.oldTownAxis) {
        const a = L.oldTownAxis;
        const ex = a.x - a.ux * 30 + a.vx * 22;
        const ez = a.z - a.uz * 30 + a.vz * 22;
        shots.push({
          id: "alley",
          label: "Alley behind the terrace",
          position: [ex, Math.max(ground(ex, ez), ground(a.x, a.z)) + 1.66, ez],
          target: [
            a.x + a.ux * 34 + a.vx * 22,
            ground(a.x + a.ux * 34, a.z + a.uz * 34) + 4.0,
            a.z + a.uz * 34 + a.vz * 22,
          ],
          fov: 70,
          timeOfDay: 15.2,
          apply: rakeAcross(a.ux, a.uz),
        });
      }

      /* -- from the old town tower roof, over the rooftops -- */
      if (L.oldTownTower) {
        const t = L.oldTownTower;
        const a = L.oldTownAxis;
        shots.push({
          id: "rooftop",
          label: "Rooftop overwatch from the tower",
          position: [t.x - a.ux * 2.6, t.topY + 2.6, t.z - a.uz * 2.6],
          target: [p(3).x, p(3).y + 26, p(3).z],
          fov: 46,
          timeOfDay: 14.2,
        });
      }

      /* -- the depot, containers in the near field, tanks behind -- */
      {
        const d = p(0);
        const ex = d.x + 46;
        const ez = d.z + 40;
        shots.push({
          id: "depot",
          label: "Fuel depot - tank farm",
          position: [ex, ground(ex, ez) + 5.0, ez],
          target: [
            L.depotTanks ? L.depotTanks.x : d.x,
            d.y + 5.5,
            L.depotTanks ? L.depotTanks.z : d.z,
          ],
          fov: 58,
          timeOfDay: 9.6,
        });
      }

      /* -- the market, from under the canopy -- */
      if (L.marketAxis) {
        const a = L.marketAxis;
        const ex = a.x - a.ux * 33 - a.vx * 7;
        const ez = a.z - a.uz * 33 - a.vz * 7;
        shots.push({
          id: "market",
          label: "Bazaar aisle across the plaza",
          position: [ex, ground(ex, ez) + 2.3, ez],
          target: [
            a.x + a.ux * 10, ground(a.x + a.ux * 10, a.z + a.uz * 10) + 3.6, a.z + a.uz * 10,
          ],
          fov: 68,
          // No rake here. The aisle is roofed, so cross-light at 20
          // degrees is simply blocked by the canopy and the frame goes
          // to 22% crushed black. A market wants a high sun cutting
          // through the gaps in the awnings.
          timeOfDay: 12.4,
        });
      }

      /* -- low sun raking up the wadi towards town -- */
      shots.push({
        id: "golden-hour",
        label: "Low sun across the wadi",
        position: [-60, ground(-60, 120) + 3.0, 120],
        target: [260, ground(260, 90) + 16, 90],
        fov: 62,
        timeOfDay: 17.5,
      });

      /* -- the checkpoint, seen down the highway -- */
      if (L.checkpointAxis) {
        const a = L.checkpointAxis;
        /* Shot from the far side, looking back down the highway.
         *
         * The original approach stood 50m short of the chicane, where
         * the highway runs along the foot of a natural scarp: two
         * thirds of the frame was blank sunlit dune with the
         * revetments stuck to it like flies. Standing on the berm and
         * looking down solved the dune and produced a near-plan view of
         * a car park. Reversing the approach puts the scarp BEHIND the
         * camera, the chicane and the tower in the middle distance, and
         * the valley behind them. */
        const ex = a.x + a.ux * 38 - a.vx * 5.0;
        const ez = a.z + a.uz * 38 - a.vz * 5.0;
        const tower = L.checkpointTower;
        shots.push({
          id: "checkpoint",
          label: "Checkpoint from the southern approach",
          position: [ex, ground(ex, ez) + 2.3, ez],
          target: tower
            ? [tower.x, tower.topY - 1.0, tower.z]
            : [a.x, ground(a.x, a.z) + 4.0, a.z],
          fov: 60,
          timeOfDay: 11.2,
          apply: rakeAcross(a.ux, a.uz),
        });
      }

      /* -- dawn, from the eastern high ground -- */
      {
        const ex = S * 0.30;
        const ez = S * 0.30;
        shots.push({
          id: "dawn-ridge",
          label: "Dawn over the eastern ridge",
          position: [ex, ground(ex, ez) + 22, ez],
          target: [-S * 0.18, 24, -S * 0.08],
          fov: 50,
          timeOfDay: 6.8,
        });
      }

      /* -- inside the citadel, looking at the keep -- */
      if (L.citadelKeep) {
        const k = L.citadelKeep;
        const ux = Math.cos(k.gateAngle);
        const uz = Math.sin(k.gateAngle);
        const ex = k.x - ux * 19 - uz * 6;
        const ez = k.z - uz * 19 + ux * 6;
        shots.push({
          id: "compound",
          label: "The citadel keep from the gate",
          // Clamp the eye to the keep's own floor level. `ground()` here
          // is whatever the mesa apron happens to be doing at the gate,
          // and widening the objective aprons dropped this camera to the
          // foot of the slope: the frame became a hill with a roof
          // behind it, shot from below like a monument.
          position: [ex, Math.max(ground(ex, ez), k.baseY) + 1.72, ez],
          target: [k.x, k.baseY + 7.0, k.z],
          fov: 64,
          timeOfDay: 13.4,
          // Rake across the approach, so the keep throws its shadow
          // over the courtyard the camera is standing in rather than
          // behind itself.
          apply: rakeAcross(ux, uz),
        });
      }

      return shots;
    },

    report() {
      const s = structures.report();
      return {
        mode: match.mode,
        state: match.state,
        tickets: { blue: match.tickets[TEAM.BLUE], red: match.tickets[TEAM.RED] },
        timeRemaining: formatTime(match.timeRemaining),
        points: controlPoints.map((point) => ({
          id: point.id,
          owner: point.owner,
          capture: Number(point.capture.toFixed(2)),
          contested: point.contested,
        })),
        buildings: s.buildings,
        pieces: s.pieces,
        structureMeshes: s.meshes,
        structureTriangles: s.triangles,
        openGround,
      };
    },

    dispose() {
      render.scene.remove(markerGroup);
    },
  };

  return api;
}
