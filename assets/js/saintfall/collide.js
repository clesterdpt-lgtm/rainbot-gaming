/* ============================================================
   SAINTFALL - collision

   A sparse solidity grid rasterised from the world's own geometry,
   rather than a set of hand-placed collider volumes.

   The choice matters. The world builder places several thousand
   pieces through a dozen different builders and merges them per
   district per material, so there is no per-object list left to hang
   colliders on by the time the meshes exist. Authoring a proxy volume
   at every call site would mean touching every builder, and would
   then DRIFT: a wall moved for a composition reason keeps its old
   collider, and the bug reads as "the player walks through masonry
   here but not there", which is the worst kind to chase.

   Rasterising the triangles that actually shipped cannot drift,
   because it is derived from what is on screen.

   Storage is chunked-sparse: a 32x32 cell page allocated only for
   supercells that contain something. The map is 2048m of mostly
   empty dune, so a dense 1m grid would be 4.2M cells to hold a few
   hundred thousand that matter.
   ============================================================ */

const CELL = 1.0;              // metres per cell
const PAGE = 32;               // cells per page edge
const PAGE_M = CELL * PAGE;    // 32m
const HALF = 1024;             // world half-extent
const PAGES = Math.ceil((HALF * 2) / PAGE_M);

/* A triangle only blocks if it starts low enough to be in the way.
   Without this the Cathedral's vaulting, 40m up, would wall off the
   floor beneath it and the nave would be unenterable. */
const HEAD_ROOM = 2.35;

/* How far out collision is built. The player clamps to 1010, so a
   small margin past that is all the boundary needs. */
const REACH = 1030;

export function buildCollision(ctx, world) {
  const pages = new Map();
  /* Flight keeps a separate full-height grid. Walking deliberately
     discards roofs, vaults and catwalk decks so they do not wall off
     the floor beneath them; a jetborne capsule needs those surfaces.
     Each flight cell stores MULTIPLE spans so an arch remains an arch
     instead of one filled column from its sill to its crown. */
  const flightPages = new Map();
  let cells = 0;
  let flightCells = 0;
  let flightIntervals = 0;

  const pageIndex = (px, pz) => pz * PAGES + px;

  /* Each cell records the vertical SPAN of geometry over it, not
     just its top.

     A single top height cannot tell a wall from an overhang: both
     report "something solid 12m up", but one you walk into and the
     other you walk under. Storing only the top made the ground
     beneath every leaning glass shard, arch, catwalk and flying
     buttress impassable - a scan found 50 blocked spots with nothing
     visible standing at them, clustered under the Glass Scar's
     overhangs. Two numbers per cell answers it exactly. */
  function pageFor(px, pz, create) {
    const key = pageIndex(px, pz);
    let page = pages.get(key);
    if (!page && create) {
      page = {
        hi: new Float32Array(PAGE * PAGE).fill(-Infinity),
        lo: new Float32Array(PAGE * PAGE).fill(Infinity),
      };
      pages.set(key, page);
    }
    return page;
  }

  function flightPageFor(px, pz, create) {
    const key = pageIndex(px, pz);
    let page = flightPages.get(key);
    if (!page && create) {
      page = new Array(PAGE * PAGE);
      flightPages.set(key, page);
    }
    return page;
  }

  /** Record geometry spanning [bottom, top] over a world position. */
  function mark(x, z, top, bottom) {
    const gx = Math.floor((x + HALF) / CELL);
    const gz = Math.floor((z + HALF) / CELL);
    if (gx < 0 || gz < 0 || gx >= HALF * 2 || gz >= HALF * 2) return;
    const px = (gx / PAGE) | 0;
    const pz = (gz / PAGE) | 0;
    const page = pageFor(px, pz, true);
    const i = (gz - pz * PAGE) * PAGE + (gx - px * PAGE);
    if (page.hi[i] === -Infinity) cells += 1;
    if (top > page.hi[i]) page.hi[i] = top;
    if (bottom < page.lo[i]) page.lo[i] = bottom;
  }

  function markFlight(x, z, top, bottom) {
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;
    /* Reachability is a per-cell question on steep terrain. A single
       triangle can span a low ravine and a high rim; filtering it by
       the ground at its AABB midpoint either drops the reachable rim
       or retains hundreds of buried ravine intervals. */
    const localGround = groundAt(x, z);
    const surfaceLo = Math.min(top, bottom);
    const surfaceHi = Math.max(top, bottom);
    if (surfaceHi < localGround + 0.05 || surfaceLo > localGround + 16.0) return;
    const gx = Math.floor((x + HALF) / CELL);
    const gz = Math.floor((z + HALF) / CELL);
    if (gx < 0 || gz < 0 || gx >= HALF * 2 || gz >= HALF * 2) return;
    const px = (gx / PAGE) | 0;
    const pz = (gz / PAGE) | 0;
    const page = flightPageFor(px, pz, true);
    const i = (gz - pz * PAGE) * PAGE + (gx - px * PAGE);
    let spans = page[i];
    if (!spans) {
      spans = [];
      page[i] = spans;
      flightCells += 1;
    }
    let lo = Math.min(top, bottom) - 0.045;
    let hi = Math.max(top, bottom) + 0.045;
    /* Merge touching triangle surfaces online. A vaulted cell usually
       receives dozens of adjacent triangles; keeping those as dozens
       of JS objects would make both load memory and the hot overlap
       query needlessly large. Flat number pairs stay compact. */
    for (let s = 0; s < spans.length; s += 2) {
      if (hi < spans[s] - 0.08 || lo > spans[s + 1] + 0.08) continue;
      spans[s] = Math.min(spans[s], lo);
      spans[s + 1] = Math.max(spans[s + 1], hi);
      for (let j = spans.length - 2; j > s; j -= 2) {
        if (spans[j + 1] < spans[s] - 0.08 || spans[j] > spans[s + 1] + 0.08) continue;
        spans[s] = Math.min(spans[s], spans[j]);
        spans[s + 1] = Math.max(spans[s + 1], spans[j + 1]);
        spans.splice(j, 2);
        flightIntervals -= 1;
      }
      return;
    }
    spans.push(lo, hi);
    flightIntervals += 1;
  }

  function cellAt(x, z) {
    const gx = Math.floor((x + HALF) / CELL);
    const gz = Math.floor((z + HALF) / CELL);
    if (gx < 0 || gz < 0 || gx >= HALF * 2 || gz >= HALF * 2) return null;
    const px = (gx / PAGE) | 0;
    const pz = (gz / PAGE) | 0;
    const page = pageFor(px, pz, false);
    if (!page) return null;
    const i = (gz - pz * PAGE) * PAGE + (gx - px * PAGE);
    if (page.hi[i] === -Infinity) return null;
    return { hi: page.hi[i], lo: page.lo[i] };
  }

  function flightCellAt(x, z) {
    const gx = Math.floor((x + HALF) / CELL);
    const gz = Math.floor((z + HALF) / CELL);
    if (gx < 0 || gz < 0 || gx >= HALF * 2 || gz >= HALF * 2) return null;
    const px = (gx / PAGE) | 0;
    const pz = (gz / PAGE) | 0;
    const page = flightPageFor(px, pz, false);
    if (!page) return null;
    return page[(gz - pz * PAGE) * PAGE + (gx - px * PAGE)] || null;
  }

  /** Highest solid surface at a world position, or -Infinity. */
  function solidTop(x, z) {
    const c = cellAt(x, z);
    return c ? c.hi : -Infinity;
  }

  /** Lowest solid surface at a world position, or Infinity. */
  function solidBottom(x, z) {
    const c = cellAt(x, z);
    return c ? c.lo : Infinity;
  }

  /* ------------------------------------------------------------
     RASTERISE
     ------------------------------------------------------------ */

  const terrain = ctx.terrain;

  /** The surface a walking capsule and its feet actually stand on.
   *  Most of the map is terrain; authored raised floors can opt in
   *  through the world without becoming blocking obstacles. */
  function groundHeight(x, z) {
    const terrainY = terrain.groundHeightAt
      ? terrain.groundHeightAt(x, z)
      : terrain.heightAt(x, z);
    const authoredY = world.walkSurfaceAt ? world.walkSurfaceAt(x, z) : -Infinity;
    return Math.max(terrainY, authoredY);
  }

  /* Terrain height, memoised per cell.
     The buried-geometry test asks for the ground under every cell a
     triangle marks, and many triangles mark the same cells - so the
     naive version evaluated several octaves of fbm hundreds of
     thousands of times and took the level's load from 3.6s to 13.7s.
     One page-shaped cache per 32x32 block brings it back: the answer
     is the same for every query in a cell, and the build only ever
     touches a fraction of the map. */
  const groundPages = new Map();
  // The last page, kept out of the Map. Every cell a triangle touches
  // is in the same 32m page as the one before it, so this hits nearly
  // always and turns a hash lookup per query into a compare.
  let gLastKey = -1;
  let gLastPage = null;
  function groundAt(x, z) {
    const gx = Math.floor((x + HALF) / CELL);
    const gz = Math.floor((z + HALF) / CELL);
    /* The paged cache only covers the authored 2 km terrain square.
       A projectile or recovery probe can briefly sample beyond that
       edge; letting a negative/out-of-range cell alias a valid page
       makes the answer depend on which side of the map was visited
       first. Out there the uncached sampler is both correct and rare. */
    const cells = Math.ceil((HALF * 2) / CELL);
    if (gx < 0 || gz < 0 || gx >= cells || gz >= cells) {
      return groundHeight(x, z);
    }
    const px = (gx / PAGE) | 0;
    const pz = (gz / PAGE) | 0;
    const key = pz * PAGES + px;
    let page;
    if (key === gLastKey) page = gLastPage;
    else {
      page = groundPages.get(key);
      if (!page) {
        // -1e9 as "unset" rather than NaN: a plain compare beats
        // Number.isNaN in the inner loop and cannot be a real height.
        page = new Float32Array(PAGE * PAGE).fill(-1e9);
        groundPages.set(key, page);
      }
      gLastKey = key;
      gLastPage = page;
    }
    const i = (gz - pz * PAGE) * PAGE + (gx - px * PAGE);
    let v = page[i];
    if (v === -1e9) {
      /* Cache a canonical cell-centre sample. The old cache stored
         whichever arbitrary triangle point queried the cell first,
         so collider generation on steep grade depended on mesh
         traversal order. */
      const sx = gx * CELL - HALF + CELL * 0.5;
      const sz = gz * CELL - HALF + CELL * 0.5;
      v = groundHeight(sx, sz);
      page[i] = v;
    }
    return v;
  }

  function rasterMesh(mesh) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    const idx = geo.index;
    const count = idx ? idx.count : pos.count;
    const m = mesh.matrixWorld;
    const e = m.elements;
    // Inlined transform. This runs over ~450k triangles at load and
    // a Vector3 per vertex is three allocations per triangle.
    const tx = (x, y, z) => e[0] * x + e[4] * y + e[8] * z + e[12];
    const ty = (x, y, z) => e[1] * x + e[5] * y + e[9] * z + e[13];
    const tz = (x, y, z) => e[2] * x + e[6] * y + e[10] * z + e[14];

    for (let t = 0; t < count; t += 3) {
      const a = idx ? idx.getX(t) : t;
      const b = idx ? idx.getX(t + 1) : t + 1;
      const c = idx ? idx.getX(t + 2) : t + 2;
      const ax = pos.getX(a); const ay = pos.getY(a); const az = pos.getZ(a);
      const bx = pos.getX(b); const by = pos.getY(b); const bz = pos.getZ(b);
      const cx = pos.getX(c); const cy = pos.getY(c); const cz = pos.getZ(c);

      const wax = tx(ax, ay, az); const way = ty(ax, ay, az); const waz = tz(ax, ay, az);
      const wbx = tx(bx, by, bz); const wby = ty(bx, by, bz); const wbz = tz(bx, by, bz);
      const wcx = tx(cx, cy, cz); const wcy = ty(cx, cy, cz); const wcz = tz(cx, cy, cz);

      const minY = Math.min(way, wby, wcy);
      const maxY = Math.max(way, wby, wcy);
      const minX = Math.min(wax, wbx, wcx);
      const maxX = Math.max(wax, wbx, wcx);
      const minZ = Math.min(waz, wbz, wcz);
      const maxZ = Math.max(waz, wbz, wcz);

      /* Outside the playable area entirely.
         The player is clamped to +/-1010 and the rim mountains stand
         beyond that, so most of the largest mesh on the map was being
         rasterised into cells nobody can ever stand in - 287k of the
         386k cells in the grid, and the bulk of the build's cost. A
         band is kept past the clamp so the boundary still stops you
         rather than letting you walk into the skirt. */
      if (minX > REACH || maxX < -REACH || minZ > REACH || maxZ < -REACH) continue;

      const g = groundAt((minX + maxX) * 0.5, (minZ + maxZ) * 0.5);

      /* Full-height flight raster. The jetpack is capped near the
         terrain, so geometry whose LOWEST point starts well above its
         reachable capsule can still be omitted. Ground-connected
         walls remain in full even when their tops rise much higher.
         Thin decorative wire stays brush-through, matching walking. */
      const footprint = Math.max(maxX - minX, maxZ - minZ);
      if (footprint >= 0.5) {
        const ga = groundAt(wax, waz);
        const gb = groundAt(wbx, wbz);
        const gc = groundAt(wcx, wcz);
        const flightGroundMax = Math.max(g, ga, gb, gc);
        const flightGroundMin = Math.min(g, ga, gb, gc);
        if (maxY >= flightGroundMin + 0.05 && minY <= flightGroundMax + 16.0) {
          rasterTriangle(
            wax, way, waz, wbx, wby, wbz, wcx, wcy, wcz,
            minX, maxX, minZ, maxZ, minY, maxY,
            false, null, markFlight
          );
        }
      }

      // Skip anything that begins above head height over the ground
      // it stands on - arches, vaulting, catwalks, banner tops.
      if (minY > g + HEAD_ROOM) continue;
      // ...and anything too flat to be an obstacle. A 4cm floor slab
      // is a surface, not a wall, and marking it turns every paved
      // road into a kerb the player cannot step over. Kept just under
      // STEP, so nothing is stored that could never block anyway.
      if (maxY - g < 0.75) continue;

      /* Sub-cell geometry does not block.
         The grid's resolution is 1m and `blocked` probes the player's
         rim as well as its centre, so ANY triangle that touches a
         cell becomes an obstacle roughly two metres across. On a
         banner pole 0.2m thick that is a ten-fold invisible pillar
         standing in open desert - the player walks into nothing, in
         a place where there is visibly nothing to walk into.

         Below the threshold the honest answer is that the object is
         too small to stop a soldier: poles, guy wires, rebar, cable
         runs and prop clutter are things you brush past. Anything
         with a real footprint - a pillar, a wall, a rock - clears it
         easily, because the test is the LONGER of the two horizontal
         dimensions, so a thin wall still counts along its length. */
      if (Math.max(maxX - minX, maxZ - minZ) < 0.5) continue;
      /* Wholly buried geometry cannot block. The Saint's 108m head is
         sunk ten metres into the dune and its lower half was marking
         cells solid where the player sees only sand. Tested per
         TRIANGLE off the ground sample already taken above, which
         costs nothing; the per-cell version costs one fbm evaluation
         per triangle-cell pair and took the level's load from 3.6s to
         13.7s, so it is reserved for triangles big enough that the
         ground varies across their own footprint. */
      if (maxY < g - 0.05) continue;

      /* For a triangle wide enough that the ground varies across its
         own footprint, approximate that ground by a PLANE through its
         three corners rather than sampling it per cell. The rim's
         mountain faces cover tens of thousands of cells each, and one
         fbm evaluation per cell put 4.8 seconds into the load. Three
         evaluations per triangle give the same answer to well within
         the 5cm tolerance this test needs. */
      /* Only triangles that STRADDLE the ground can have buried
         cells, so only they pay for the per-cell test. Geometry
         standing clear of the terrain - which is nearly all of it -
         skips it entirely. Testing every triangle put 4.8 seconds
         into the load; testing only the ones that dip below their own
         ground costs 1.7, and unlike a plane approximation through
         the corners it stays exact, which matters because the whole
         point is to stop marking cells the player can see are
         empty. */
      const straddles = minY < g + 0.05;
      // Only a LARGE straddling triangle needs the ground resampled
      // across its footprint; over a couple of metres the centre
      // sample is the same answer for a fraction of the cost.
      const wide = straddles && Math.max(maxX - minX, maxZ - minZ) > 2.0;

      rasterTriangle(
        wax, way, waz, wbx, wby, wbz, wcx, wcy, wcz,
        minX, maxX, minZ, maxZ, minY, maxY, wide, straddles ? g : null
      );
    }
  }

  /**
   * Mark the cells a triangle actually covers.
   *
   * This replaced a bounding-box fill, which was the source of the
   * map's invisible walls. A single mountain face or a long thin
   * sliver would mark its whole AABB solid - hundreds of square
   * metres of open desert with nothing standing on it - and a
   * top-down dump of the grid showed the result plainly: big
   * axis-aligned blocks and diagonal streaks across empty dune,
   * covering 9.9% of the map. No screenshot of the GAME could ever
   * have shown it, because the entire defect is that there is
   * nothing there to see.
   *
   * Two passes, because either alone is wrong:
   *   - a scanline fill covers the interior, but a wall thinner than
   *     a cell can pass between two cell centres and vanish;
   *   - an edge walk catches thin walls, but leaves interiors hollow.
   *
   * Height is the triangle's own plane evaluated per cell rather
   * than its maximum, so a steep face does not stamp its ridge
   * height across its whole footprint.
   */
  function rasterTriangle(ax, ay, az, bx, by, bz, cx, cy, cz,
    minX, maxX, minZ, maxZ, minY, maxY, wide, flatGround, markFn = mark) {
    const e1x = bx - ax; const e1z = bz - az; const e1y = by - ay;
    const e2x = cx - ax; const e2z = cz - az; const e2y = cy - ay;
    const det = e1x * e2z - e1z * e2x;
    let pa = 0; let pb = 0; let pc = 0;
    // A triangle seen edge-on from above has no plane in y(x,z) -
    // and a vertical wall is exactly that case, so it must not be
    // dropped. Fall back to its top edge.
    const edgeOn = Math.abs(det) < 1e-7;
    if (!edgeOn) {
      pa = (e1y * e2z - e1z * e2y) / det;
      pb = (e1x * e2y - e1y * e2x) / det;
      pc = ay - pa * ax - pb * az;
    }
    const yAt = (x, z) => (edgeOn
      ? maxY
      : Math.min(maxY, Math.max(minY, pa * x + pb * z + pc)));
    /* A triangle seen edge-on from above is a vertical face, and it
       occupies every height between its own bottom and top at the
       cells it covers - that is what makes a wall a wall. A sloping
       triangle is a single surface, so its span at a cell is the
       interpolated height and nothing else, which is what lets the
       player walk beneath it. */
    const yLow = (x, z) => (edgeOn ? minY : yAt(x, z));

    /* Buried geometry cannot block.
       The Saint's 108m head is sunk ten metres into the dune, and its
       lower half was being rasterised at its own interpolated heights
       - marking cells solid where the player sees nothing but sand.
       An invisible-wall scan found blocks whose nearest geometry sat
       8.31m BELOW the ground. Anything whose surface at a cell is at
       or under the terrain there is simply not in the way. */
    const put = (x, z) => {
      const top = yAt(x, z);
      if (wide) {
        if (top < groundAt(x, z) + 0.05) return;
      } else if (flatGround !== null && top < flatGround + 0.05) return;
      markFn(x, z, top, yLow(x, z));
    };

    // --- edges ---
    const edge = (x0, z0, x1, z1) => {
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (CELL * 0.5));
      for (let i = 0; i <= n; i += 1) {
        const t = n === 0 ? 0 : i / n;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        put(x, z);
      }
    };
    edge(ax, az, bx, bz);
    edge(bx, bz, cx, cz);
    edge(cx, cz, ax, az);

    // --- interior, by scanline ---
    const z0 = Math.floor(minZ / CELL) * CELL + CELL * 0.5;
    const zEnd = maxZ;
    const xs = [];
    for (let z = z0; z <= zEnd; z += CELL) {
      xs.length = 0;
      const cross = (px, pz, qx, qz) => {
        if ((pz <= z && qz > z) || (qz <= z && pz > z)) {
          xs.push(px + ((z - pz) / (qz - pz)) * (qx - px));
        }
      };
      cross(ax, az, bx, bz);
      cross(bx, bz, cx, cz);
      cross(cx, cz, ax, az);
      if (xs.length < 2) continue;
      const lo = Math.min(xs[0], xs[1]);
      const hi = Math.max(xs[0], xs[1]);
      for (let x = Math.floor(lo / CELL) * CELL; x <= hi; x += CELL) {
        put(x, z);
      }
    }
    void minX; void maxX;
  }

  const meshes = [];
  world.group.traverse((o) => {
    if (!o.isMesh) return;
    // The raised paving is represented by world.walkSurfaceAt and is
    // therefore support, never an obstacle. Road furniture is kept in
    // a separate `road-stone` mesh and rasterised normally.
    if (o.name.startsWith("road-surface-")) return;
    meshes.push(o);
  });
  /* Per-mesh cell counts, kept because "something is walling off
     open desert" is unanswerable without provenance: the grid stores
     a height, not who put it there. */
  const perMesh = [];
  const buildT0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  for (const mesh of meshes) {
    const before = cells;
    rasterMesh(mesh);
    perMesh.push({ name: mesh.name, cells: cells - before });
  }
  perMesh.sort((a, b) => b.cells - a.cells);
  const buildMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - buildT0;
  groundPages.clear();
  gLastPage = null;
  gLastKey = -1;

  /* ------------------------------------------------------------
     QUERIES
     ------------------------------------------------------------ */

  const RADIUS = 0.42;
  /* Feet may settle into the rendered terrain by only this small skin.
     The previous 10cm allowance was large enough to put a boot and the
     chase ray visibly below a steep hill for a frame. */
  const FLIGHT_TERRAIN_SKIN = 0.02;
  const FLIGHT_TERRAIN_RING_PROBES = 64;
  const FLIGHT_TERRAIN_UNIT_RING = Array.from(
    { length: FLIGHT_TERRAIN_RING_PROBES },
    (_, i) => {
      const a = i * Math.PI * 2 / FLIGHT_TERRAIN_RING_PROBES;
      return [Math.cos(a), Math.sin(a)];
    }
  );
  /* What the player can walk up without being stopped. Kerbs, steps,
     rubble, bone fragments and the causeway edge are all below this.

     Raised from 0.62m after a survey found 328 sample points blocked
     by something standing less than 0.8m proud. Knee-high debris that
     stops a soldier dead is indistinguishable, from inside the game,
     from an invisible wall - the player cannot see what stopped them
     because what stopped them is below the bottom of the screen. */
  const STEP = 0.82;
  let recoveries = 0;
  let angledSlides = 0;
  let hardStops = 0;

  /** Is a capsule at (x, z) standing on ground `feetY` blocked? */
  function blocked(x, z, feetY, radius = RADIUS) {
    const knee = feetY + STEP;        // steppable below this
    const head = feetY + HEAD_ROOM;   // duckable above this
    // An obstruction only stops the player if it overlaps the body:
    // its top must be above the step height AND its bottom below head
    // height. Testing the top alone cannot tell a wall from an
    // overhang, and made the ground under every arch impassable.
    const hit = (px, pz) => {
      const c = cellAt(px, pz);
      return c !== null && c.hi > knee && c.lo < head;
    };
    // Centre plus eight probes on the capsule's rim. Cardinal-only
    // sampling misses a solid cell that clips the capsule at a
    // diagonal corner; the player can then enter it and be blocked
    // only after their centre crosses the cell edge.
    const d = radius * Math.SQRT1_2;
    return hit(x, z) || hit(x + radius, z) || hit(x - radius, z)
      || hit(x, z + radius) || hit(x, z - radius)
      || hit(x + d, z + d) || hit(x + d, z - d)
      || hit(x - d, z + d) || hit(x - d, z - d);
  }

  /** Full-height capsule overlap for jetborne movement.
   *
   * Unlike `blocked`, this has no walking step window and reads the
   * multi-interval flight grid, so a vault roof can stop the capsule
   * without filling the open nave beneath it. Geometry that is
   * steppable from the current support is ignored only during the
   * first metre of takeoff, preventing a paving relief or low kerb
   * from imprisoning a capsule that legally stood there. */
  function flightBlocked(x, z, feetY, radius = RADIUS, height = HEAD_ROOM,
    ignoreTerrain = false) {
    /* Being below the support at a CANDIDATE point does not mean the
       capsule is taking off; it is also exactly what happens when an
       airborne player flies into a hill. The old inference therefore
       re-enabled the 0.82m walking-step allowance on uphill contact
       and accepted a frame with the trooper visibly under terrain.
       Only the sweep's bounded, legal-launch exemption may classify
       a probe as takeoff clearance. */
    const takingOff = ignoreTerrain
      && feetY <= groundHeight(x, z) + STEP + 0.04;
    const bottom = feetY + 0.02;
    const head = feetY + height;
    if (!ignoreTerrain) {
      const terrainLimit = feetY + FLIGHT_TERRAIN_SKIN;
      /* The capsule occupies a DISK, not nine isolated columns. On a
         steep rendered triangle, the old centre/cardinal/diagonal
         probes missed the high point between bearings by 2.5cm.

         On the rendered terrain, a linear triangle reaches its disk
         maximum on the circular boundary unless a terrain vertex lies
         inside it. Sample that boundary finely and include every LOD0
         grid vertex inside the footprint. This keeps the hot authored-
         mesh span query at its existing nine probes while making hill
         contact match the visible terrain height field. */
      if (flightGroundHeight(x, z, radius, terrainLimit) > terrainLimit) return true;
    }
    const hit = (px, pz) => {
      /* Terrain was resolved against the full footprint above. Keep
         the local support only to distinguish low, launch-overlapped
         mesh spans while the authoritative takeoff latch is active. */
      const localGround = takingOff ? groundHeight(px, pz) : -Infinity;
      const spans = flightCellAt(px, pz);
      if (!spans) return false;
      for (let i = 0; i < spans.length; i += 2) {
        const lo = spans[i];
        const hi = spans[i + 1];
        if (takingOff && hi <= localGround + STEP + 0.04) continue;
        if (hi > bottom && lo < head) return true;
      }
      return false;
    };
    const d = radius * Math.SQRT1_2;
    return hit(x, z) || hit(x + radius, z) || hit(x - radius, z)
      || hit(x, z + radius) || hit(x, z - radius)
      || hit(x + d, z + d) || hit(x + d, z - d)
      || hit(x - d, z + d) || hit(x - d, z - d);
  }

  /** Highest rendered/support surface under a circular flight capsule.
   *  `stopAbove` lets hot overlap queries return on their first block;
   *  landing calls omit it to classify terrain contact against roofs. */
  function flightGroundHeight(x, z, radius = RADIUS, stopAbove = Infinity) {
    let high = groundHeight(x, z);
    if (high > stopAbove) return high;
    for (const [ux, uz] of FLIGHT_TERRAIN_UNIT_RING) {
      high = Math.max(high, groundHeight(x + ux * radius, z + uz * radius));
      if (high > stopAbove) return high;
    }
    if (world.walkSurfaceMaxInCircle) {
      high = Math.max(high, world.walkSurfaceMaxInCircle(x, z, radius));
      if (high > stopAbove) return high;
    }
    const gridStep = terrain.groundSampleStep;
    if (!Number.isFinite(gridStep) || gridStep <= 0) return high;
    const minGX = Math.ceil((x - radius + HALF) / gridStep);
    const maxGX = Math.floor((x + radius + HALF) / gridStep);
    const minGZ = Math.ceil((z - radius + HALF) / gridStep);
    const maxGZ = Math.floor((z + radius + HALF) / gridStep);
    const radiusSq = radius * radius + 1e-9;
    for (let gx = minGX; gx <= maxGX; gx += 1) {
      const px = gx * gridStep - HALF;
      for (let gz = minGZ; gz <= maxGZ; gz += 1) {
        const pz = gz * gridStep - HALF;
        if ((px - x) ** 2 + (pz - z) ** 2 > radiusSq) continue;
        high = Math.max(high, groundHeight(px, pz));
        if (high > stopAbove) return high;
      }
    }
    return high;
  }

  /** Swept/substepped flight resolve.
   *
   * A boosted frame can travel several metres, so testing only its
   * destination can hop a one-metre collision cell. This divides the
   * complete 3D displacement into capsule-sized microsteps, resolves
   * vertical contact first, then keeps the better of X->Z and Z->X
   * slides. The return includes hit axes so the controller can cancel
   * only the velocity that struck something. */
  function sweepFlightCapsule(x, y, z, nx, ny, nz,
    radius = RADIUS, height = HEAD_ROOM, stepSize = 0.20,
    allowTakeoffExit = false) {
    nx = Math.max(-1010, Math.min(1010, nx));
    nz = Math.max(-1010, Math.min(1010, nz));
    const dx = nx - x;
    const dy = ny - y;
    const dz = nz - z;
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / Math.max(0.08, stepSize)));
    const sx = dx / count;
    const sy = dy / count;
    const sz = dz / count;
    let px = x;
    let py = y;
    let pz = z;
    let hitX = false;
    let hitY = false;
    let hitZ = false;
    /* Takeoff clearance is controller state, not something a sweep
       can rediscover from proximity to its starting ground. At
       flight speed each frame begins less than a capsule radius from
       the last; auto-detecting here re-armed the exemption every
       frame and let a player ratchet through an uphill bank. */
    const legalTakeoff = !!allowTakeoffExit;
    const overlaps = (qx, qz, qy) => {
      /* A position accepted by the walking controller is a known
         legal launch origin. Ignore terrain-only rim overlap for the
         first capsule radius of upward clearance, while still
         testing every authored mesh span. This lets the body lift
         free of a sloped support without granting horizontal passage
         through the bank beside it. */
      const takeoffExemption = legalTakeoff
        && qy >= y - 0.02
        && Math.hypot(qx - x, qz - z) <= radius + 0.08;
      return flightBlocked(qx, qz, qy, radius, height, takeoffExemption);
    };

    const resolveOrder = (x0, z0, yy, ax, az, xFirst) => {
      let rx = x0;
      let rz = z0;
      if (xFirst) {
        if (!overlaps(rx + ax, rz, yy)) rx += ax;
        if (!overlaps(rx, rz + az, yy)) rz += az;
      } else {
        if (!overlaps(rx, rz + az, yy)) rz += az;
        if (!overlaps(rx + ax, rz, yy)) rx += ax;
      }
      return [rx, rz];
    };

    for (let i = 0; i < count; i += 1) {
      const wantY = py + sy;
      if (!overlaps(px, pz, wantY)) py = wantY;
      else {
        /* Resolve to the contact skin instead of discarding a whole
           20cm microstep. Five bisections leave under 7mm of sweep
           uncertainty, so feet do not visibly hover over roof planes. */
        let lo = 0;
        let hi = 1;
        for (let j = 0; j < 5; j += 1) {
          const mid = (lo + hi) * 0.5;
          if (overlaps(px, pz, py + sy * mid)) hi = mid;
          else lo = mid;
        }
        py += sy * lo;
        hitY = true;
      }

      const wantX = px + sx;
      const wantZ = pz + sz;
      if (!overlaps(wantX, wantZ, py)) {
        px = wantX;
        pz = wantZ;
        continue;
      }
      const xz = resolveOrder(px, pz, py, sx, sz, true);
      const zx = resolveOrder(px, pz, py, sx, sz, false);
      const xzDot = (xz[0] - px) * sx + (xz[1] - pz) * sz;
      const zxDot = (zx[0] - px) * sx + (zx[1] - pz) * sz;
      const best = zxDot > xzDot ? zx : xz;
      if (Math.abs(best[0] - wantX) > 1e-6) hitX = true;
      if (Math.abs(best[1] - wantZ) > 1e-6) hitZ = true;
      px = best[0];
      pz = best[1];
    }

    return {
      x: px, y: py, z: pz,
      hitX, hitY, hitZ,
      blocked: hitX || hitY || hitZ,
      steps: count,
    };
  }

  /** Nearest ground column a descending flight capsule can actually
   * reach. Roofs stop the upward/downward sweep but are not authored
   * walking supports, so an exhausted player above one needs a short
   * assisted drift to open terrain rather than an infinite hover. */
  function findFlightLanding(x, z, feetY, spread = 6) {
    const rings = Math.ceil(spread / 0.5);
    for (let ring = 1; ring <= rings; ring += 1) {
      const r = ring * 0.5;
      const phase = (ring & 1) ? Math.PI / 16 : 0;
      for (let i = 0; i < 16; i += 1) {
        const a = phase + (i / 16) * Math.PI * 2;
        const nx = Math.max(-1010, Math.min(1010, x + Math.cos(a) * r));
        const nz = Math.max(-1010, Math.min(1010, z + Math.sin(a) * r));
        const gy = groundHeight(nx, nz);
        if (blocked(nx, nz, gy)) continue;
        const across = sweepFlightCapsule(x, feetY, z, nx, feetY, nz);
        if (Math.hypot(across.x - nx, across.z - nz) > 0.08) continue;
        const down = sweepFlightCapsule(nx, feetY, nz, nx, gy, nz);
        if (down.hitY && down.y > gy + 0.11) continue;
        return [nx, nz, gy];
      }
    }
    return null;
  }

  /**
   * Move from (x,z) toward (nx,nz), sliding along whatever stops it.
   *
   * Axis-separated fallback rather than a true swept resolve: if the
   * diagonal is blocked, try each axis alone. It is three grid probes
   * in the worst case and it produces the wall-sliding every shooter
   * has, without a contact manifold.
   */
  function slide(x, z, nx, nz, feetY = null, radius = RADIUS, validate = null) {
    /* A grounded player must be tested at the ground under EACH
       candidate, not at the body's vertically damped Y from the
       previous frame. On a descent the stale, higher feet value made
       waist-high geometry look steppable for one frame; after the
       body settled, the player was inside it and every direction was
       blocked. Passing a finite feetY keeps airborne movement at the
       capsule's real height. */
    const atY = (px, pz) => Number.isFinite(feetY) ? feetY : groundHeight(px, pz);

    /* Recover a capsule that is already overlapping. This covers old
       saves, teleports, and the edge of a coarse collision cell. The
       search is intentionally bounded: it can lift a player out of a
       snag, not teleport them through a building. */
    if (blocked(x, z, atY(x, z), radius)) {
      let open = findOpen(x, z, atY(x, z), 48, 3.0, radius, atY);
      /* Ordinary one-frame penetrations resolve inside the tight 3m
         budget. A second, still-bounded ring handles old saves made
         inside the deepest bone stacks and Cathedral rubble instead
         of leaving the player permanently unable to move. */
      if (!open) open = findOpen(x, z, atY(x, z), 80, 5.0, radius, atY);
      if (open) {
        recoveries += 1;
        return open;
      }
    }

    const legal = (px, pz) => !blocked(px, pz, atY(px, pz), radius)
      && (!validate || validate(px, pz));
    if (legal(nx, nz)) return [nx, nz];
    if (legal(nx, z)) return [nx, z];
    if (legal(x, nz)) return [x, nz];

    /* Axis separation is excellent on square walls but can dead-stop
       against a rotated rock or round pillar because both axis probes
       remain in the same 1m cell. Try shallow turns that retain a
       forward component before declaring the move impossible. */
    const dx = nx - x;
    const dz = nz - z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) {
      const base = Math.atan2(dz, dx);
      for (const turn of [Math.PI / 8, -Math.PI / 8, Math.PI / 4, -Math.PI / 4,
        Math.PI * 3 / 8, -Math.PI * 3 / 8]) {
        const tx = x + Math.cos(base + turn) * len;
        const tz = z + Math.sin(base + turn) * len;
        if (legal(tx, tz)) {
          angledSlides += 1;
          return [tx, tz];
        }
      }
    }
    hardStops += 1;
    return [x, z];
  }

  /**
   * How far a ray travels before it hits masonry.
   *
   * Stepped along the grid rather than intersected against triangles.
   * A shot needs to know whether a wall is in the way, and at 0.35m
   * steps that answer is right to within a third of a metre - which
   * is under the width of the things being shot at.
   */
  function rayBlock(ox, oy, oz, dx, dy, dz, maxDist) {
    const step = 0.35;
    const n = Math.ceil(maxDist / step);
    /* If the ORIGIN is already inside solid, the ray has to get out
       before anything counts as a wall.

       Without this, firing while pressed against masonry - or while
       standing on any geometry the grid marks solid, which includes
       every ledge, stair and bunker roof - blocks the shot at the
       first sample and the weapon silently stops working. The trace
       that found this read `wallAtM: 0.35` with the target in clear
       line of sight at 19.5m, and from inside the game it looks like
       the gun has simply stopped hitting things. */
    const solidAt = (x, y, z) => {
      const c = cellAt(x, z);
      if (c !== null && c.lo - step <= y && y <= c.hi + step) return true;
      const spans = flightCellAt(x, z);
      if (!spans) return false;
      for (let s = 0; s < spans.length; s += 2) {
        if (spans[s] - step <= y && y <= spans[s + 1] + step) return true;
      }
      return false;
    };
    let inside = solidAt(ox, oy, oz);
    for (let i = 1; i <= n; i += 1) {
      const d = i * step;
      const x = ox + dx * d;
      const y = oy + dy * d;
      const z = oz + dz * d;
      if (y < groundHeight(x, z)) return inside ? Infinity : d;
      // The ray is stopped only where geometry actually spans its
      // height - it passes beneath an overhang like anything else.
      const solid = solidAt(x, y, z);
      if (inside) { if (!solid) inside = false; continue; }
      if (solid) return d;
    }
    return Infinity;
  }

  /**
   * The nearest position to (x,z) that is not inside masonry.
   *
   * Spawning things without asking this question produced exactly
   * what you would expect: a garrison unit standing inside a wall,
   * permanently blocked by `slide` and therefore unable to ever
   * reach the player, which reads as an enemy that ignores you.
   */
  function findOpen(x, z, groundY, tries = 24, spread = 9,
    radius = RADIUS, feetAt = null) {
    const atY = feetAt || groundHeight;
    if (!blocked(x, z, atY(x, z), radius)) return [x, z];
    /* Search complete near-to-far rings rather than one golden-spiral
       point per radius. The spiral can sail between a narrow legal
       lane even when an open cell is directly beside the capsule;
       that left two boundary overlaps unrecoverable in the full POI
       fuzz. Sixteen bearings at sub-metre radial spacing still cost
       little because this path runs only for an existing overlap. */
    const rings = Math.max(1, tries);
    const radialStep = Math.max(0.25, spread / rings);
    for (let ring = 1; ring <= rings; ring += 1) {
      const r = Math.min(spread, ring * radialStep);
      const phase = (ring & 1) ? Math.PI / 16 : 0;
      for (let d = 0; d < 16; d += 1) {
        const a = phase + (d / 16) * Math.PI * 2;
        const nx = x + Math.cos(a) * r;
        const nz = z + Math.sin(a) * r;
        if (!blocked(nx, nz, atY(nx, nz), radius)) return [nx, nz];
      }
      if (r >= spread) break;
    }
    void groundY;
    return null;
  }

  /**
   * A visible overlay of the collision grid around the player.
   *
   * An invisible wall is, by definition, a thing the player cannot
   * see - so the only way to report one precisely is to make it
   * visible. This draws the blocking cells near the camera as
   * translucent boxes, which turns "I got stuck somewhere around
   * here" into a screenshot with the collider in it.
   *
   * Rebuilt from scratch on each call rather than kept in sync: it
   * is a debug view toggled by hand, and a stale debug view is worse
   * than none.
   */
  let debugMesh = null;
  function setDebugView(THREE, scene, on, x, z, range = 44) {
    if (debugMesh) {
      scene.remove(debugMesh);
      debugMesh.geometry.dispose();
      debugMesh.material.dispose();
      debugMesh = null;
    }
    if (!on) return null;
    const pos = [];
    const idx = [];
    let n = 0;
    for (let dx = -range; dx <= range; dx += CELL) {
      for (let dz = -range; dz <= range; dz += CELL) {
        const c = cellAt(x + dx, z + dz);
        if (!c) continue;
        const g = groundHeight(x + dx, z + dz);
        // Only what would actually stop a walking player.
        if (!(c.hi > g + STEP && c.lo < g + HEAD_ROOM)) continue;
        const x0 = Math.floor((x + dx) / CELL) * CELL;
        const z0 = Math.floor((z + dz) / CELL) * CELL;
        const y0 = Math.max(c.lo, g);
        const y1 = Math.min(c.hi, g + HEAD_ROOM + 1.5);
        const b = n * 8;
        for (const [ox, oy, oz] of [
          [0, 0, 0], [CELL, 0, 0], [CELL, 0, CELL], [0, 0, CELL],
          [0, 1, 0], [CELL, 1, 0], [CELL, 1, CELL], [0, 1, CELL],
        ]) pos.push(x0 + ox, oy ? y1 : y0, z0 + oz);
        idx.push(
          b, b + 1, b + 5, b, b + 5, b + 4,
          b + 1, b + 2, b + 6, b + 1, b + 6, b + 5,
          b + 2, b + 3, b + 7, b + 2, b + 7, b + 6,
          b + 3, b, b + 4, b + 3, b + 4, b + 7,
          b + 4, b + 5, b + 6, b + 4, b + 6, b + 7
        );
        n += 1;
      }
    }
    if (!n) return { boxes: 0 };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    debugMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xff3344, transparent: true, opacity: 0.28,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    debugMesh.name = "collision-debug";
    debugMesh.frustumCulled = false;
    scene.add(debugMesh);
    return { boxes: n };
  }

  return {
    solidTop,
    solidBottom,
    groundHeight,
    cellAt,
    flightCellAt,
    setDebugView,
    blocked,
    flightBlocked,
    flightGroundHeight,
    sweepFlightCapsule,
    findFlightLanding,
    findOpen,
    slide,
    rayBlock,
    radius: RADIUS,
    step: STEP,
    stats() {
      return {
        pages: pages.size,
        cells,
        flightPages: flightPages.size,
        flightCells,
        flightIntervals,
        meshes: meshes.length,
        buildMs: Math.round(buildMs),
        recoveries,
        angledSlides,
        hardStops,
        perMesh,
      };
    },
  };
}
