/* ============================================================
   SAINTFALL - summit world  (Kenosis, "The White Vigil")

   Everything that stands ON the mountain: the nine stations, the
   Via Sacra's furniture, and the Cathedral of the Ninth Ascent.

   The peer of world.js, and it borrows that file's whole assembly
   strategy - one batcher, merge-only, paint before merge, bed
   before place. What follows is only what is different.

   ------------------------------------------------------------
   THE THREE RULES THIS FILE EXISTS TO ENFORCE

   1. BATCH PER STATION, NEVER PER LEVEL.

      world.js keys its bins on `district|material|tag` and that is
      not tidiness, it is frustum culling. A merged mesh has ONE
      bounding sphere; merge the whole level's granite into one
      mesh and that sphere is 2km across, so it is on screen from
      everywhere and every triangle in it is submitted every frame
      from every camera. Nine stations means nine spheres of a few
      hundred metres, and standing at the basecamp costs you the
      basecamp.

   2. NOTHING STANDS ON THE SNOW. EVERYTHING STANDS IN IT.

      This is the single clearest tell that a snow level is a
      desert level with a white ramp. Every prop here goes through
      `kit.snowCap`, which does two things: it sinks the geometry
      to the MINIMUM ground under its own footprint (the same rule
      world.js's `restOnTerrain` and structures.js's `parapet` use,
      and for the same reason - bed to the lowest support and pay
      it back in height, or the far side floats), and it builds a
      drift skin piled against the windward face. A prop without a
      cap reads as a sticker no matter how good its silhouette is.

   3. A STATION MUST BE IDENTIFIABLE FROM 800 METRES.

      The layout gives each one a silhouette in one line - "a wide
      pale-cyan wedge", "a vertical white organ pipe", "a broken
      comb of masonry on a cliff edge" - and that line is the
      acceptance test for its build. Detail that only resolves at
      20m is detail spent on the wrong problem: this is a level
      where you can see seven of the nine stations at once from the
      parvis, and the read at that range is the whole design.

   ------------------------------------------------------------
   STATUS

   This is the FIRST DRAFT of the dressing. Every station is sited,
   scaled and identifiable; each carries a TODO block naming what
   the finishing pass owes it. The terrain, the sky, the weather
   and the material model underneath are not drafts.
   ============================================================ */

import {
  TAU, clamp, clamp01, lerp, smoothstep, sstep, makeRng, makeNoise2D, makeRamp,
} from "saintfall/core.js";
import { paintGeometry, paintByHeight, paintFlat, patchMaterial } from "saintfall/art.js";
import { mergeGeometries, cleanGeometry } from "saintfall/structures.js";
import { makeSummitKit } from "saintfall/summit-structures.js";
import {
  SNOW_RAMP, SLAB_RAMP, GLACIER_RAMP, BLACKICE_RAMP, GRANITE_RAMP,
  RIME_RAMP, SCREE_RAMP, SULPHUR_RAMP, BARK_RAMP, BELL_RAMP,
  SUMMIT_PALETTE, SUMMIT_WIND,
} from "saintfall/summit-art.js";
import {
  STATIONS, STATION_ORDER, VIA_SACRA_PATH, VIA_SACRA_TURNS,
  VIA_SACRA_SPURS, BASECAMP, CREVASSES, MOULINS, MAP_HALF,
  viaSacraPointAt, VIA_SACRA_LENGTH,
} from "saintfall/summit-terrain.js";

const K = SUMMIT_PALETTE;

/* The one ramp this file owns rather than borrows.
   `summit-art` publishes nine, and none of them is painted metal:
   the basecamp's wrecked lander is the level's only manufactured
   object, and handed GRANITE_RAMP it comes out grey-GREEN, which is
   exactly the hue that ramp exists to separate rock from snow with.
   Bottom end lifted for the same reason every other ramp on this
   level has its bottom end lifted - a 7-degree key means most of a
   hull's area is taking fill only. */
const HULL_RAMP = makeRamp([
  [0.00, "#3a3e46"],
  [0.30, "#565c66"],
  [0.62, "#7c828c"],
  [0.86, "#a2a6ac"],
  [1.00, "#c6c4bd"],
]);

/* ============================================================
   THE BATCHER

   world.js:51's, with one change: the bin key's first field is a
   STATION and the flush asserts it. See rule 1 in the header.
   ============================================================ */

function makeBatcher(ctx, root) {
  const { THREE, materials } = ctx;
  const bins = new Map();
  return {
    add(station, matName, geo, opts = {}) {
      if (!geo || !geo.attributes || !geo.attributes.position) return;
      if (geo.attributes.position.count === 0) return;
      const key = `${station}|${matName}|${opts.tag || ""}`;
      let bin = bins.get(key);
      /* FIRST OPTS OBJECT WINS for the whole bin - world.js:60 has
         the same trap. Two calls that disagree about `collisionSolid`
         silently resolve to whichever ran first, which is a collision
         bug that depends on build order. Say so rather than merge. */
      if (!bin) bins.set(key, (bin = { station, matName, geos: [], opts }));
      bin.geos.push(geo);
    },
    flush() {
      const out = [];
      for (const bin of bins.values()) {
        const mat = materials[bin.matName] || materials.get?.(bin.matName) || materials.stone;
        const merged = mergeGeometries(ctx.THREE, bin.geos);
        if (!merged || !merged.attributes.position || merged.attributes.position.count === 0) continue;
        /* One clean pass per merged mesh. Every primitive that closes
           to a point emits zero-area triangles, whose orphaned
           vertices carry zero-length normals that normalise to NaN -
           and one NaN in a vertex buffer is a black mesh. Doing it
           here means no builder can forget it. */
        const geo = cleanGeometry(ctx.THREE, merged) || merged;
        const mesh = new ctx.THREE.Mesh(geo, mat);
        /* `name` is an OVERRIDE and there is exactly one legitimate
           reason to use it: collide.js:518 excludes any mesh whose
           name starts with `road-surface-` from the obstacle raster,
           unconditionally and by prefix. That is the engine's only
           way to say "this is a raised FLOOR, not a wall", and the
           other half of the contract is `world.walkSurfaceAt`, which
           has to report the same surface or the player walks on air.

           Anything else that takes the prefix silently stops
           blocking, so the override is spelled out at the call site
           rather than derived from a flag. */
        mesh.name = bin.opts.name || (bin.opts.tag
          ? `${bin.station}-${bin.opts.tag}-${bin.matName}`
          : `${bin.station}-${bin.matName}`);
        mesh.castShadow = bin.opts.castShadow !== false;
        mesh.receiveShadow = bin.opts.receiveShadow !== false;
        /* collide.js drops any triangle whose XZ footprint is under
           half a metre as clutter. A finely subdivided hull - sixty
           rings of a serac - is built entirely from such triangles
           even though the block stands nine metres tall, so without
           this the collider registers a few slivers and nothing else
           while the render mesh stands there solid. */
        if (bin.opts.collisionSolid) mesh.userData.collisionSolid = true;
        /* `noCollide`, spelled EXACTLY that, because that is the key
           collide.js reads (collide.js:517) and it is the only one it
           reads. The first pass wrote `collisionIgnore`, which nothing
           in the repository has ever looked at - so every mesh this
           file called uncollidable was rasterised anyway. Silent, and
           in the worst possible way: the rose window, the drift skins
           and (once they existed) the icicle fringes and every glow
           card were standing in the collision grid as invisible walls.
           A grep for `collisionIgnore` across assets/ and scripts/
           returned exactly one hit - the line that wrote it. */
        if (bin.opts.noCollide) mesh.userData.noCollide = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.userData.station = bin.station;
        root.add(mesh);
        out.push(mesh);
      }
      bins.clear();
      return out;
    },
  };
}

/* ============================================================
   BUILD
   ============================================================ */

export async function buildSummitWorld(ctx, onProgress) {
  const { THREE, scene, terrain, atmos } = ctx;
  const field = terrain.field;
  const kit = makeSummitKit(THREE);
  const root = new THREE.Group();
  root.name = "world";
  scene.add(root);

  const batch = makeBatcher(ctx, root);
  const pois = [];
  const emitters = [];
  const lightObjects = [];
  const banners = [];
  const stationSites = [];
  let meshes = [];
  /* ------------------------------------------------------------
     THE WHEEL-CROSS

     The one object this level shares with Vesper, and the only
     reason it is loaded rather than rebuilt from the summit kit:
     it is the mark of the order, so it has to be the SAME object in
     both worlds. A snow-country variant of a religious symbol is not
     the same symbol - a player who walked past seventeen of these in
     the Gilded Reach has to recognise this one at a glance, at
     range, in a whiteout, or the thread between the two maps is
     decoration instead of doctrine.

     It arrives as authored GLB meshes rather than through the
     batcher, exactly as world.js handles it, which means it is
     outside the station bins: each cross is its own draw call and
     its own bounding sphere. That is affordable at this count and
     it is what lets the same asset carry its own collision.
     ------------------------------------------------------------ */
  const authoredMeshes = [];
  const authoredLandmarks = [];
  let crossAsset = null;
  const crossAssetReady = (async () => {
    try {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const loader = new GLTFLoader();
      const url = new URL(
        "../../../assets/models/saintfall/meshy/gilded-reach-choir-wheel.glb",
        import.meta.url
      );
      if (ctx.build) url.searchParams.set("v", ctx.build);
      const gltf = await loader.loadAsync(url.href);
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(source);
      const size = box.getSize(new THREE.Vector3());
      if (!(size.y > 1e-6)) throw new Error("model has no measurable height");
      const seen = new Set();
      source.traverse((node) => {
        if (!node.isMesh) return;
        const list = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of list) {
          if (!material || seen.has(material)) continue;
          seen.add(material);
          material.envMapIntensity = 0.82;
          /* A HIGHER RIM THAN VESPER GIVES IT, and for the reason
             every ramp on this mountain has a lifted floor: the key
             is 7 degrees off the SSE, so a north or west face of a
             1.9m-slender object takes fill alone. Vesper's 0.78 is
             tuned against a desert bounce that does not exist here. */
          patchMaterial(material, atmos, { rim: 0.95, glitter: 0 });
        }
      });
      crossAsset = { source, box, size };
    } catch (error) {
      console.warn("[saintfall] wheel-cross failed to load; Kenosis goes without", error);
      crossAsset = null;
    }
  })();
  /* The cathedral's own ground plane, published upward out of
     `buildSummitStation` so the beauty shots can frame the building
     rather than the parvis it stands on. It is the parvis elevation
     plus the stylobate, and it is set where the podium is built so
     the two can never disagree. */
  let summitBase = STATIONS.summit.padY;
  /* The Frozen Cascade's measured headwall, published upward out of
     its builder so `cascade-backlit` frames the fall instead of the
     snowfield in front of it. Set where the lip is found. */
  let cascadeLip = null;
  /* The Black Tarn's ice plane, published for the `tarn-mirror`
     shot: the lake is 1.02 m above its pad and 120 m across, and a
     camera sited off the pad elevation photographs the bank. */
  let tarnIce = null;
  /* The Avalanche Bowl's snow bridge, as a walkable rectangle. Read
     by `walkSurfaceAt`, so it is declared with the other published
     surfaces rather than inside the builder. */
  let snowBridge = null;
  /* The Fumarole Steps' melt ring, published for `fumarole-plume`:
     the one frame in the level whose subject is a BOUNDARY, so the
     camera has to be sited on it rather than near the station. */
  let fumaroleField = null;

  const H = (x, z) => field.heightAt(x, z);
  const D = (x, z) => field.snowDepthAt(x, z);
  const N = (x, z) => field.normalAt(x, z);

  let step = 0;
  const STEPS = 14;
  async function progress(label) {
    step += 1;
    if (onProgress) onProgress(clamp01(step / STEPS), label);
    // Yield, or a twelve-second build is twelve seconds of frozen tab.
    await new Promise((r) => setTimeout(r, 0));
  }

  /* ------------------------------------------------------------
     PLACEMENT HELPERS

     `place` is the workhorse and it does the three things every
     prop on this mountain needs: bed it into the minimum support
     under its own footprint, cap it with the drift the wind would
     have piled against it, and submit both halves to the right
     station bin.
     ------------------------------------------------------------ */

  /**
   * Bed a geometry at (x, z), cap it with snow, and queue both.
   *
   * `capMat` defaults to "powder" rather than "snow" because a
   * drift piled against something in the last day has not been
   * carved yet - it is the one place on the mountain where the
   * sastrugi shader should be nearly silent.
   */
  /* ================================================================
     THE ROAD IS NOT A PLACE TO PUT THINGS

     Three content passes below place props with collision on, and
     none of them knew where the Via Sacra was. Measured against the
     player's own collision, 67 of the road's 800 nodes were blocked
     by a solid - one of them 30m from the Fumarole Steps, which is
     exactly where a player reported "a block on the ascent... there
     should be a clear path up the mountain without having to fly".

     The road itself is fine: tested against the player's real walk
     rule (1.05m step, 1.7 slope) all 800 segments are walkable. It
     was the dressing standing on it.

     Bucketed into 48m cells because the naive test is 800 nodes per
     candidate and the passes below try thousands of candidates; this
     turns it into a handful of comparisons.
     ================================================================ */
  const ROAD_CELL = 48;
  const roadGrid = new Map();
  const roadKey = (x, z) => `${Math.floor(x / ROAD_CELL)},${Math.floor(z / ROAD_CELL)}`;
  for (const n of VIA_SACRA_PATH) {
    const nx = n.x !== undefined ? n.x : n[0];
    const nz = n.z !== undefined ? n.z : n[1];
    const k = roadKey(nx, nz);
    if (!roadGrid.has(k)) roadGrid.set(k, []);
    roadGrid.get(k).push([nx, nz]);
  }
  for (const sp of VIA_SACRA_SPURS) {
    /* Spurs are straight runs from the road to each pad; sample them
       so a prop cannot stand in a station's own approach either. */
    const st = STATIONS[sp.id];
    if (!st) continue;
    const steps = Math.max(2, Math.round(Math.hypot(st.x - sp.x, st.z - sp.z) / 8));
    for (let i = 0; i <= steps; i += 1) {
      const f = i / steps;
      const nx = sp.x + (st.x - sp.x) * f;
      const nz = sp.z + (st.z - sp.z) * f;
      const k = roadKey(nx, nz);
      if (!roadGrid.has(k)) roadGrid.set(k, []);
      roadGrid.get(k).push([nx, nz]);
    }
  }
  /** True if (x, z) is within `margin` metres of the road or a spur. */
  function nearRoad(x, z, margin) {
    const cx = Math.floor(x / ROAD_CELL);
    const cz = Math.floor(z / ROAD_CELL);
    const reach = Math.ceil(margin / ROAD_CELL);
    const m2 = margin * margin;
    for (let i = -reach; i <= reach; i += 1) {
      for (let j = -reach; j <= reach; j += 1) {
        const cell = roadGrid.get(`${cx + i},${cz + j}`);
        if (!cell) continue;
        for (const [nx, nz] of cell) {
          const dx = x - nx;
          const dz = z - nz;
          if (dx * dx + dz * dz < m2) return true;
        }
      }
    }
    return false;
  }

  /* --- THE CATHEDRAL'S FLOOR IS A RAISED FLOOR ------------------

     Published for `walkSurfaceAt`, which is the engine's only way to
     say "this is a floor you stand on, not a wall you hit" - see the
     note on the `road-surface-` prefix in the batcher above.

     It has to go through that channel because the obstacle raster
     cannot carry it. `collide.js` skips any triangle that begins
     above head height over the ground beneath it, which is the right
     rule for arches and vaulting and exactly wrong for a chapel
     standing on a 5.8 m podium: the floor is 6 m over the parvis, so
     every triangle of it was discarded and the interior had no
     ground at all. A player reported being unable to enter "even if
     you fly over the stairs" - they could get in, and then fell
     through the floor to the parvis. */
  const floatLedger = [];
  /* --- A DRIFT IS A FLOOR, NOT A WALL ---------------------------

     Snow drifts rasterised onto a 1 m grid of walkable tops, read
     back by `walkSurfaceAt`. See the note at the collar's `batch.add`
     for why this is not collision. Capped so a collar banked 17 m up
     a buttress does not become a staircase to its roof. */
  const DRIFT_CELL = 1;
  const DRIFT_WALK_CAP = 3.5;
  const driftFloor = new Map();
  const driftKey = (gx, gz) => (gx + 2048) * 8192 + (gz + 2048);
  /* The ceiling is measured against the terrain under EACH CELL, not
     under the prop's origin. A mass bedded on a slope has its collar
     crown metres uphill of its own centre, and centre-relative
     capping threw those crowns away - measured, it was the difference
     between a drift you walk over and one you walk through. One
     terrain sample per drift cell, memoised, rather than one per
     vertex. */
  const driftGround = new Map();
  function driftGroundAt(gx, gz, k) {
    let g = driftGround.get(k);
    if (g === undefined) {
      g = H((gx + 0.5) * DRIFT_CELL, (gz + 0.5) * DRIFT_CELL);
      driftGround.set(k, g);
    }
    return g;
  }
  let summitPodium = null;
  let summitStair = null;

  function place(station, matName, geo, x, z, opts = {}) {
    if (!geo) return null;
    /* BOTH SAMPLERS ARE WRAPPED, and snowCap's own header is
       explicit about why: it works in the GEOMETRY's coordinates,
       which for every kit builder means a prop standing on y = 0 at
       the local origin. Handing it the world-space samplers puts
       every drift on the level at the depth measured at the map
       origin - a plausible number, so nothing fails and every prop
       on the mountain is subtly wrong. The depth sampler was
       unwrapped in the first pass and that is exactly what happened.

       The X/Z wrap makes `groundAt` return a WORLD height, so what
       comes back in `extras.seatY` (= minimum support minus the
       bedding depth) is the world Y to seat the prop at - NOT an
       offset from the ground. Adding H(x, z) to it, which the first
       pass also did, doubles the altitude: measured on the first
       build, the Glacier Tongue's moraine sat at 743m and its drift
       collars at 1094m, on a mountain 452m high, and read from the
       parvis as a scatter of dark specks in the sky.

       The COLLAR is built from `groundAt`'s own return values, so it
       is already at world Y and moves in X/Z only. */
    /* `opts.groundAt` lets a caller substitute a different support
       surface for the terrain - the Glacier Tongue's ice sheet is a
       raised authored floor, and a serac bedded to the rock 3.5 m
       under it stands in a hole of its own making. It is a WORLD
       sampler, wrapped here the same way `H` is. */
    const ground = opts.groundAt || H;
    const cap = kit.snowCap(geo, (gx, gz) => D(gx + x, gz + z), {
      groundAt: (gx, gz) => ground(gx + x, gz + z),
      bedFactor: opts.bedFactor ?? 0.55,
      maxBed: opts.maxBed ?? 1.1,
      load: opts.load ?? 1.0,
      bins: opts.capBins ?? 20,
      /* `loadOn: false` turns off the snow lying ON the prop and
         keeps only the collar around it. It exists for a prop that
         is never drawn - the wheel-cross's proxy footing - where a
         load slab is snow sitting on a prism nobody can see. It also
         keeps that bin's bounding sphere honest: the load is built
         in the geometry's LOCAL frame while the collar is already in
         world Y, so a bin carrying both spans from the prop's own
         height up to its altitude, and a bin whose sphere is four
         hundred metres tall is never culled. */
      loadOn: opts.loadOn !== false,
    });
    const seat = (cap.extras && Number.isFinite(cap.extras.seatY))
      ? cap.extras.seatY : ground(x, z);
    geo.translate(x, seat + (opts.lift || 0), z);
    /* --- PER-PROP FLOAT LEDGER ------------------------------------

       `floatingProps` in the QA module measures whole MERGED MESHES,
       so it can only report a bin in which EVERY prop hangs clear of
       the ground. One lintel left in the air among a hundred bedded
       stones is invisible to it - which is how the one a player
       photographed survived an audit that returned 13 of 571 and
       looked clean.

       Measured here instead, against the same support sampler the
       prop was actually seated on, so a serac on the Tongue's ice
       floor and a reliquary on the podium are compared with the floor
       they stand on rather than the rock 6 m below it. */
    if (opts.noFloatAudit !== true) {
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (bb) {
        floatLedger.push({
          station, tag: opts.tag || "prop", name: opts.name || null,
          x, z, gap: bb.min.y - ground(x, z),
          span: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z),
        });
      }
    }
    /* --- NOTHING SOLID STANDS IN THE CARRIAGEWAY -----------------

       Every content pass in this file places props, and none of them
       knew where the road was. Measured against the player's own
       collision, 67 of the Via Sacra's 800 nodes were blocked by a
       solid - one of them thirty metres from the Fumarole Steps,
       which is exactly where a player reported being unable to climb
       without flying.

       The road itself is not the problem: tested against the player's
       real walk rule - 1.05m step, 1.7 slope - all 800 of its
       segments are walkable. It was the dressing standing on it.

       The individual passes now keep their distance, but they are not
       the only source: the stations dress their own approaches, and a
       margin measured from a prop's CENTRE cannot know its radius. So
       the rule lives here, where every prop in the level passes
       through, and it is about collision rather than existence - a
       marker post beside the way should stay, it just must not be a
       wall. Seven metres is the carriageway plus its shoulder. */
    const inRoad = nearRoad(x, z, 7);
    /* INTO ITS OWN BIN, not just its own flags. `batch.add` above is
       explicit that the FIRST opts object wins for a whole bin, so
       passing `collisionSolid: false` on the ninth prop of a bin that
       opened solid does nothing at all - which is why the first
       attempt at this removed four road blocks out of sixty-seven.
       A distinct tag is a distinct bin, and a distinct bin gets its
       own opts. */
    /* `visual: false` runs the whole placement - bedding, the drift
       collar, the drift walk-floor - and then throws the prop
       geometry away. It exists for the wheel-cross, which is an
       authored GLB rather than a merged geometry and so cannot go
       into a station bin: a squat proxy prism the size of its plinth
       is bedded here purely to MEASURE the seat and to grow the
       drift the wind would have piled against it, and the real
       object is then stood on the number that comes back. Without
       this the cross is the one thing on the mountain standing ON
       the snow, which is the failure rule 2 of this file's header
       exists to prevent. */
    if (opts.visual !== false) {
      batch.add(station, matName, geo, {
        tag: inRoad ? `${opts.tag || "prop"}-onroad` : opts.tag,
        collisionSolid: inRoad ? false : (opts.collisionSolid !== false),
        noCollide: inRoad ? true : (opts.noCollide === true),
        name: opts.name,
      });
    }
    if (cap.geo && cap.geo.attributes && cap.geo.attributes.position
      && cap.geo.attributes.position.count > 0 && opts.cap !== false) {
      cap.geo.translate(x, opts.lift || 0, z);
      /* NOT REPAINTED HERE. `snowCap` already painted this collar
         from SNOW_RAMP over its own measured y-range, with a 0.58
         normal weight and a 0.72 cavity term - which is what gives
         the load slab a readable lip and the scour moat its shadow.
         The first pass then overwrote all of that with a flat
         `paintByHeight` at default weights, so every drift on the
         mountain lost the one bit of shading that makes a drift look
         like snow rather than like a white cone. */
      /* --- A DRIFT IS SOMETHING YOU WALK UP, NOT THROUGH ---------

         These were built with collision off, and measured, their
         visual tops stand between 0.87m and 17.45m above the ground
         the player actually stands on - the collar banked against the
         basecamp buttress is a seventeen-metre wall of snow you walk
         straight through. A player reported it as "on snow piles it
         is not working well", which is exactly what it looks like.

         SOLID WAS THE WRONG ANSWER, and the reasoning that chose it
         - the collar is already a ramp, the player has a 1.05 m step,
         so a knee-high drift is walked over - assumed the player can
         stand on top of a solid. It cannot. `solidTop` has no consumer
         anywhere in player.js or any other movement code; grep it and
         the only readers are audio.js picking a footstep material and
         the QA probes. `groundHeight` is `max(terrain, walkSurfaceAt)`
         and nothing else, so in this engine a prop is a WALL and the
         floor comes from the terrain or from an authored surface -
         which is the same thing that left the cathedral's podium with
         no floor on it.

         Measured after making the collars solid: of sixteen drifts
         standing 0.8-2.1 m proud, every one was in the collision
         raster with `solidTop` exactly at the drift's crown, and the
         player came to rest on the GROUND beside all but one of them.
         Solid turned each drift from something you walked through
         into something you bumped into and still could not climb,
         which is worse than where it started.

         So the drift is published as a walk surface, the way the road
         surfaces and the podium are, and its geometry leaves the
         obstacle raster entirely. Snow you can walk up and over. */
      /* Separate bin when it is on the road, for the same reason the
         prop itself gets one: first opts wins per bin, so a single
         road-adjacent collar opening a shared bin with collision off
         silently disarms every other collar in it. That is what left
         the seventeen-metre buttress drift out of the raster while
         the scree drift beside it went in. */
      /* Rasterise the collar's own top into the drift floor before it
         is handed to the batcher. Vertices rather than triangles: the
         collar meshes are dense enough that a 1 m cell catches them,
         and triangle rasterisation over seven thousand collars is not
         worth 1 m of resolution. */
      if (!inRoad) {
        const cpos = cap.geo.attributes.position;
        for (let i = 0; i < cpos.count; i += 1) {
          const wy = cpos.getY(i);
          const gx = Math.floor(cpos.getX(i) / DRIFT_CELL);
          const gz = Math.floor(cpos.getZ(i) / DRIFT_CELL);
          const k = driftKey(gx, gz);
          if (wy > driftGroundAt(gx, gz, k) + DRIFT_WALK_CAP) continue;
          const cur = driftFloor.get(k);
          if (cur === undefined || wy > cur) driftFloor.set(k, wy);
        }
      }
      batch.add(station, opts.capMat || "powder", cap.geo, {
        tag: inRoad ? `${opts.tag || "prop"}-drift-onroad` : `${opts.tag || "prop"}-drift`,
        collisionSolid: false,
        noCollide: true,
      });
    }
    return cap.extras;
  }

  /** A named point of interest, sited on the real ground. */
  function poi(id, name, x, z) { pois.push({ id, name, x, z }); }

  /** The absolute world Y `place` seated a prop at, with the raw
   *  ground as the fallback. Anything that hangs off a placed prop
   *  has to use this and not `H`, because bedding can be over a
   *  metre and the two silently differ by exactly that. */
  const seatOf = (extras, x, z) => (
    extras && Number.isFinite(extras.seatY) ? extras.seatY : H(x, z)
  );

  /* ------------------------------------------------------------
     ONE WHEEL-CROSS

     `height` is the finished world height of the monument, exactly
     as world.js means it, so the two maps are commensurable: an 8m
     wayside cross here is the same object at the same size as an 8m
     one in the desert would be.

     MEASURED OFF THE MESH, not eyeballed off the preview render.
     The model is 1.008 x 1.898 x 0.707 in its own units, and every
     vertex below half its height lies inside a SQUARE 0.187 of the
     height each way - the stepped footing - while the arms reach
     0.266. So the footing that has to be bedded and drifted is
     0.187 * height in half-width, and 0.20 is that with the margin
     a drift collar wants. Both numbers live here and nowhere else.

     A caller may override the collar radius with `footR` where the
     real footing would grow an absurd drift - see the great cross.
     ------------------------------------------------------------ */
  const CROSS_FOOT_RATIO = 0.20;

  function placeWheelCross(opts) {
    if (!crossAsset) return null;
    const { x, z, height } = opts;
    const yaw = opts.yaw || 0;
    const tiltX = opts.tiltX || 0;
    const tiltZ = opts.tiltZ || 0;

    /* --- bed and drift, through the level's own placer ---------- */
    const footR = Math.max(0.8, opts.footR || height * CROSS_FOOT_RATIO);
    const proxy = kit.prism({
      h: Math.max(0.9, height * 0.16), rBottom: footR, rTop: footR * 0.86, sides: 8,
    });
    const bin = opts.bin || "waycross";
    const extras = place(bin, "granite", proxy, x, z, {
      tag: opts.tag || "waycross",
      visual: false,
      noFloatAudit: true,
      /* Bedded harder than a serac and softer than a fence post. The
         thing has a stone footing that was dug in when it was raised
         and has been drifting over ever since. */
      bedFactor: opts.bedFactor ?? 0.80,
      maxBed: opts.maxBed ?? Math.min(1.5, height * 0.10),
      capBins: 16,
      cap: opts.cap !== false,
      capMat: "powder",
      // The proxy is never drawn, so snow cannot lie on it.
      loadOn: false,
      collisionSolid: false,
      noCollide: true,
    });
    const seat = seatOf(extras, x, z);

    /* --- the object itself -------------------------------------- */
    const pivot = new THREE.Group();
    pivot.name = opts.name || opts.key;
    pivot.rotation.order = "YXZ";
    pivot.rotation.set(tiltX, yaw, tiltZ);
    pivot.position.set(x, seat, z);

    const fitted = new THREE.Group();
    const visual = crossAsset.source.clone(true);
    const scale = height / crossAsset.size.y;
    fitted.scale.setScalar(scale);
    fitted.position.set(
      -((crossAsset.box.min.x + crossAsset.box.max.x) * 0.5) * scale,
      -crossAsset.box.min.y * scale,
      -((crossAsset.box.min.z + crossAsset.box.max.z) * 0.5) * scale
    );
    fitted.add(visual);
    pivot.add(fitted);

    const meshList = [];
    visual.traverse((node) => {
      if (!node.isMesh) return;
      node.name = `${pivot.name}-mesh`;
      node.castShadow = true;
      node.receiveShadow = true;
      node.userData.station = opts.station || "waycross";
      /* Same tag world.js gives it, and for the same reason: Meshy
         triangulates the panels finer than collide.js's half-metre
         clutter filter, so without this the collider keeps a few
         slivers and the player walks through the monument. */
      node.userData.collisionSolid = opts.solid !== false;
      node.userData.authoredLandmark = opts.key;
      if (opts.solid !== false) authoredMeshes.push(node);
      meshList.push(node);
    });
    root.add(pivot);
    pivot.updateMatrixWorld(true);

    authoredLandmarks.push({
      key: opts.key,
      root: pivot,
      meshes: meshList,
      placement: {
        variant: opts.variant || "wayside",
        targetHeight: height,
        yaw, tiltX, tiltZ,
        rotOrder: "YXZ",
        seatY: seat,
        ground: H(x, z),
      },
    });
    return pivot;
  }

  /* ------------------------------------------------------------
     THE RIME PASS

     This is the single mechanic that finishes this level, and it
     took a measurement to see why.

     The sun is at azimuth 158 (SSE) and 7 degrees up, and the
     ambient fill was cut to a third in round 1 because a
     non-directional hemisphere was flattening the mountain. Both
     decisions are right and together they mean that ANY surface
     facing away from the SSE takes fill only. Measured on the
     first Bell Terrace frame: every campanile post, every cloister
     arch and both faces of the fallen bell rendered under sRGB 24
     - a "broken comb of masonry on a cliff edge" that is a black
     blob against a peach sky.

     Painting the ramp lighter is the wrong fix; the granite ramp's
     floor has already been raised two and a half stops for exactly
     this reason and going further makes lit stone chalky.

     The right fix is the one the art direction asks for by name:
     the windward faces of everything are RIMED. Rime is off-white,
     it is nearly rangeless, and it is the brightest material in
     the level - so a WNW-facing wall covered in it reads pale and
     keeps its form even with no key on it at all. The wind blows
     from 292 (WNW) and the sun comes from 158 (SSE), 134 degrees
     apart, which means the rimed face and the lit face are almost
     never the same face. That is not a coincidence to exploit; it
     is what a real mountain looks like, and it is why the level's
     wind bearing and sun bearing were authored where they are.

     summit-structures does this twice over for the cathedral -
     displacement and paint, over one shared exposure term. This is
     the same idea for everything else that stands on the mountain,
     and it is deliberately ONE function so the whole level agrees
     about which way the weather comes from.
     ------------------------------------------------------------ */

  const WINDWARD = SUMMIT_WIND.windward;    // unit [x, z] pointing INTO the wind
  const DOWNWIND = SUMMIT_WIND.toward;      // unit [x, z] the air travels
  /* One noise field for every paint call in the file. Sampled in
     WORLD space, so two props of the same kind standing five metres
     apart do not carry identical mottle - which is what a
     per-geometry noise gives you and it reads as instancing. */
  const paintNoise = makeNoise2D(0x21ce);

  /**
   * How hard a vertex faces into the wind, in 0..1.
   *
   * The vertical component is DISCOUNTED rather than ignored, the
   * same 0.2-ish weight `rimeFeathers` uses: an up-facing ledge does
   * catch rime, just far less than a vertical windward face, and
   * zeroing it leaves a bald cap on every post and every coping.
   */
  function windExposure(nx, ny, nz) {
    return clamp01(nx * WINDWARD[0] + nz * WINDWARD[1] + Math.max(0, ny) * 0.22);
  }

  /**
   * Paint a geometry from its own ramp and blend RIME_RAMP over the
   * windward faces.
   *
   * `paintGeometry` already carries the second-ramp machinery it
   * needs (`ramp2` / `mix2`, art.js:1700) - it was written for the
   * bone knight's patina - and reusing it means the rime lands on
   * the SAME tonal position as the base coat, so a rimed face keeps
   * the shape's own shading instead of flattening to one value.
   * That is the difference between rime and white paint.
   *
   * `min`/`max` are the honest names. The first pass of this file
   * passed `lo`/`hi` to `paintByHeight` throughout, and there are no
   * such options - art.js:1817 reads `opts.min` and `opts.max` and
   * falls back to the geometry's own bounding box. Every call was
   * therefore silently painting over the prop's full height, which
   * is right for a boulder and wrong for anything whose ramp
   * position is supposed to mean something.
   */
  function paintRimed(geo, ramp, opts = {}) {
    if (!geo || !geo.attributes || !geo.attributes.position) return geo;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    geo.computeBoundingBox();
    const lo = opts.min ?? geo.boundingBox.min.y;
    const hi = Math.max(lo + 1e-3, opts.max ?? geo.boundingBox.max.y);
    const span = hi - lo;
    const normalWeight = opts.normalWeight ?? 0.36;
    const noise = opts.noise ?? 0.13;
    const bias = opts.bias ?? 0;
    const rime = opts.rime ?? 0.85;
    const threshold = opts.threshold ?? 0.18;
    const power = opts.power ?? 1.3;
    /* An optional predicate that kills the rime where the caller
       knows the wind cannot reach - a cloister's inner face, the
       underside of a bell. Without one, a hollow object rimes on
       the inside of its own windward wall, where the normal points
       the right way and the weather does not. */
    const reach = opts.reach || null;
    return paintGeometry(THREE, geo, ramp, (x, y, z, i) => {
      const h = (y - lo) / span;
      const up = nrm.getY(i) * 0.5 + 0.5;
      /* `fbm` is SIGNED - it returns roughly [-1, 1], not [0, 1].
         Treating it as unipolar and subtracting a half, which is what
         the art.js value-noise idiom does, biases every vertex a full
         half-step down the ramp and darkens the whole prop. */
      const n = paintNoise.fbm(x * 0.21, z * 0.21, 2) * 0.62
        + paintNoise.fbm(x * 0.63 + y * 0.31, z * 0.63, 2) * 0.38;
      return clamp01(h * (1 - normalWeight) + up * normalWeight + bias + n * noise * 0.5);
    }, {
      jitter: opts.jitter ?? 0.06,
      ramp2: rime > 0 ? RIME_RAMP : null,
      mix2: rime > 0
        ? (x, y, z, i) => {
          const e = windExposure(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
          if (e <= threshold) return 0;
          let m = Math.pow((e - threshold) / (1 - threshold), power) * rime;
          /* Feathers grow in patches, not as a coat. A uniform mix
             over a whole wall reads as a colour change; broken up
             it reads as ice that has accreted. */
          m *= 0.62 + 0.38 * clamp01(paintNoise.fbm(x * 0.42, z * 0.42, 2) * 0.5 + 0.5);
          if (reach) m *= clamp01(reach(x, y, z));
          return m;
        }
        : null,
    });
  }

  /**
   * Rime a prop for real - displace the windward geometry, facet it,
   * then paint it - and hand back the finished, non-indexed result.
   *
   * The order is the one `rimeFeathers` warns about in its own
   * header and it is not negotiable: displacement needs an INDEXED
   * geometry (a faceted one tears along every shared edge), and
   * `facet` has to run before the paint or the vertex colours
   * interpolate across facets instead of landing on them.
   *
   * `kit.facet` RETURNS A NEW GEOMETRY. The first pass of this file
   * called it as `kit.facet(tree)` and threw the return away in two
   * places - the Rime Forest's conifers and the cathedral body - so
   * neither was ever faceted and both rendered smooth-shaded, which
   * on a low-poly trunk is the difference between bark and a candle.
   */
  function rimeProp(geo, opts = {}) {
    let g = geo;
    if (g && g.index && (opts.feathers ?? 1) > 0) {
      g = kit.rimeFeathers(g, DOWNWIND, {
        amount: opts.feathers ?? 0.3,
        scale: opts.featherScale ?? 1.1,
        threshold: opts.featherThreshold ?? 0.10,
        power: 1.6,
        rootBand: opts.rootBand ?? 0,
        normalMix: 0.45,
      });
    }
    g = kit.facet(g);
    return paintRimed(g, opts.ramp || GRANITE_RAMP, opts);
  }

  /* ------------------------------------------------------------
     ICICLE FRINGES

     `icicleFringe` costs about thirty triangles per icicle and the
     art direction wants one on every ledge in the level. That is a
     budget question before it is an art question: at the density
     summit-structures' own probe used, the cathedral's nine eaves
     and twenty-five ledges came to 50,120 triangles on their own -
     as much as the entire building.

     So the spacing is authored per RUN by what the run is for. A
     roof drip edge you stand under gets 0.5 m spacing; a hundred-
     and-fifty-metre string course seen from the parvis gets 2.4 m
     and short icicles, because at that distance the fringe is a
     tone along an edge rather than a row of objects.

     Every fringe is `noCollide`. They are sub-decimetre triangles,
     so collide.js's 0.5 m footprint filter would drop most of them
     anyway - and the ones it kept would be an invisible fence
     hanging under every eave in the level.
     ------------------------------------------------------------ */
  function hangFringe(station, runs, opts = {}) {
    if (!runs || !runs.length) return 0;
    const geos = [];
    let seed = opts.seed || 0x1c1c1e;
    for (const run of runs) {
      if (!run || run.length < 2) continue;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const g = kit.icicleFringe(run, {
        spacing: opts.spacing ?? 0.55,
        length: opts.length ?? 1.1,
        lengthVary: opts.lengthVary ?? 0.6,
        radius: opts.radius ?? 0.06,
        max: opts.max ?? 260,
        sides: opts.sides ?? 4,
        lean: opts.lean ?? 0.12,
        seed,
        exposure: opts.exposure,
      });
      if (g && g.attributes && g.attributes.position && g.attributes.position.count) geos.push(g);
    }
    if (!geos.length) return 0;
    const merged = mergeGeometries(THREE, geos);
    batch.add(station, opts.material || "glacierIce", merged, {
      tag: opts.tag || "icicles", collisionSolid: false, noCollide: true, castShadow: false,
    });
    return geos.length;
  }

  /** Every `k`th entry of a list, keeping the first. Used to thin a
   *  ledge set down to what is worth hanging ice off. */
  const everyNth = (list, k) => list.filter((_, i) => i % k === 0);

  /* ------------------------------------------------------------
     THE VIA SACRA'S FURNITURE

     The road itself is cut into the height field by
     summit-terrain; what this adds is the things that make it read
     as a ROUTE rather than as a ledge: a parapet on the exposed
     side, a votive marker at every hairpin, cairns where the spurs
     leave, and prayer flags strung across the highest turns.
     ------------------------------------------------------------ */

  async function buildViaSacra() {
    const rng = makeRng(0x5ac2a);
    const path = VIA_SACRA_PATH;

    /* The parapet goes on the DOWNHILL side, which is the side the
       ground falls away from - computed rather than assumed,
       because a spiral changes which side that is twice per turn
       and a parapet on the cut face is a wall against a wall. */
    const outer = [];
    for (let i = 1; i < path.length - 1; i += 1) {
      const p = path[i];
      const a = path[i - 1];
      const b = path[i + 1];
      const tx = b[0] - a[0];
      const tz = b[1] - a[1];
      const inv = 1 / (Math.hypot(tx, tz) || 1);
      // Left normal, then choose whichever side is lower.
      const nx = -tz * inv;
      const nz = tx * inv;
      const off = 6.2;
      const yL = H(p[0] + nx * off, p[1] + nz * off);
      const yR = H(p[0] - nx * off, p[1] - nz * off);
      const s = yL < yR ? 1 : -1;
      const drop = Math.abs(yL - yR);
      /* Only where there is something to fall off. A parapet along
         a road cut into a 6% apron is street furniture; a parapet
         where the ground drops four metres in six is the thing that
         makes the exposure readable. */
      if (drop < 3.4) { outer.length && outer.push(null); continue; }
      const ox = p[0] + nx * off * s;
      const oz = p[1] + nz * off * s;
      outer.push([ox, H(ox, oz), oz]);
    }

    // Split at the nulls into continuous runs.
    let run = [];
    const runs = [];
    for (const pt of outer) {
      if (!pt) { if (run.length > 3) runs.push(run); run = []; continue; }
      run.push(pt);
    }
    if (run.length > 3) runs.push(run);

    let parapetLen = 0;
    for (const r of runs) {
      parapetLen += r.length;
      const wall = kit.parapet(r, {
        h: 0.92, w: 0.44, spacing: 1.2, ruin: 0.16, embed: 0.16,
        seed: rng.int(1, 1e6), groundAt: H,
      });
      paintByHeight(THREE, wall, GRANITE_RAMP, { lo: 0.22, hi: 0.86, jitter: 0.05 });
      batch.add("road", "granite", wall, { tag: "parapet", collisionSolid: true });
    }

    /* A votive marker at every hairpin, on the inside of the turn,
       and a cairn where each spur leaves. Both are navigation: this
       level's one real risk is not knowing which way is up. */
    for (const turn of VIA_SACRA_TURNS) {
      const g = kit.votiveMarker(rng, { h: 2.7, r: 0.21, sides: 5 });
      paintByHeight(THREE, g.geo, GRANITE_RAMP, { lo: 0.30, hi: 0.92, jitter: 0.04 });
      place("road", "granite", g.geo, turn.x, turn.z, { tag: "marker" });
    }

    /* A spur is a POLYLINE - `{ id, from, length, points }` - and the
       cairn marks where it LEAVES the road, which is points[0]. It has
       no x/z of its own and reaching for one silently yields undefined,
       which reaches THREE.translate as a missing argument and takes the
       whole build down. */
    for (const spur of VIA_SACRA_SPURS) {
      const head = spur.points && spur.points[0];
      if (!head) continue;
      // `cairn` returns an already-painted geometry, not a wrapper.
      const geo = kit.cairn(rng, { h: 1.9, r: 0.68, layers: 8 });
      place("road", "granite", geo, head[0] + 5.5, head[1] + 5.5, { tag: "cairn" });
    }

    /* Prayer flags across the two highest hairpins only. Everywhere
       else they would be litter; at 380m they are the last human
       mark before the parvis and they move in the wind, which at
       that altitude is 31 m/s. */
    const high = [...VIA_SACRA_TURNS].sort((a, b) => H(b.x, b.z) - H(a.x, a.z)).slice(0, 2);
    for (const t of high) {
      const a = [t.x - 9, H(t.x - 9, t.z) + 3.0, t.z];
      const b = [t.x + 9, H(t.x + 9, t.z) + 3.4, t.z];
      const run2 = kit.prayerFlagRun([a, b], { flags: 18, seed: rng.int(1, 1e6) });
      /* THE CORD IS GEOMETRY, THE FLAGS ARE BANNER SPECS, and they
         go to two different places. `run2.geo` is the lashing - a
         static tube - and belongs in the batch. The flags belong in
         `world.banners`, which vfx.js's `buildBanners` consumes:
         it reads `spec.geo.attributes.wave` and bakes the colours
         into vertex colours so all the cloth on the level animates
         from one merged mesh. Pushing a plain {x,y,z} there instead
         is what a first pass did, and buildBanners dereferences
         `spec.geo.attributes` with no guard at all. */
      if (run2.geo && run2.geo.attributes && run2.geo.attributes.position.count) {
        batch.add("road", "iron", run2.geo, { tag: "flag-cord", collisionSolid: false });
      }
      for (const spec of (run2.extras && run2.extras.flagSpecs) || []) {
        if (spec && spec.geo && spec.geo.attributes && spec.geo.attributes.wave) {
          banners.push(spec);
        }
      }
    }

    poi("via-sacra", "The Via Sacra", path[Math.floor(path.length * 0.55)][0],
      path[Math.floor(path.length * 0.55)][1]);
    await progress("Laying the Via Sacra");
    return { parapetRuns: runs.length, parapetNodes: parapetLen };
  }

  /* ------------------------------------------------------------
     STATION: THE BASECAMP  (S, 12m)

     Silhouette: two rock buttresses framing the valley mouth, with
     the whole mountain between them. This is the level's first
     frame and its only job is scale.
     ------------------------------------------------------------ */

  async function buildBasecamp() {
    const S = STATIONS.basecamp;
    const rng = makeRng(0xba5ec);

    /* The two buttresses. They are the frame of the arrival shot,
       so they are sited by ANGLE from the camera rather than by
       offset: 26 degrees either side of the sightline to the peak
       puts them just outside a 64-degree frame's centre third. */
    const toPeak = Math.atan2(0 - S.x, 0 - S.z);
    for (const sgn of [-1, 1]) {
      const a = toPeak + sgn * (26 * Math.PI / 180);
      const bx = S.x + Math.sin(a) * 118;
      const bz = S.z + Math.cos(a) * 118;
      const g = kit.crag(rng, {
        height: rng.range(46, 58), radius: rng.range(20, 26), layers: 7,
        sides: 8, lean: 0.22 * -sgn, cliff: 0.55, benches: 2, sink: 0.18,
      });
      paintByHeight(THREE, g, GRANITE_RAMP, { lo: 0.10, hi: 0.92, jitter: 0.06 });
      place("basecamp", "granite", g, bx, bz, { tag: "buttress", maxBed: 3.0 });
    }

    // Scree fans off both buttresses, at the angle of repose.
    for (let i = 0; i < 34; i += 1) {
      const a = rng() * TAU;
      const r = 96 + rng.range(0, 62);
      const x = S.x + Math.cos(a) * r;
      const z = S.z + Math.sin(a) * r;
      const g = kit.crag(rng, {
        height: rng.range(0.7, 2.6), radius: rng.range(0.8, 2.4),
        layers: 4, sides: rng.int(5, 8), lean: rng.range(0, 0.4), sink: 0.36,
      });
      paintByHeight(THREE, g, SCREE_RAMP, { lo: 0.12, hi: 0.9, jitter: 0.1 });
      place("basecamp", "scree", g, x, z, { tag: "scree", cap: i % 3 === 0 });
    }

    /* The gate: two posts and a lintel where the Via Sacra leaves
       the pan. Deliberately small - 7m - because the mountain
       behind it is 452 and the gate's job is to be the thing you
       measure it against. */
    const gx = BASECAMP.x;
    const gz = BASECAMP.z - 46;
    for (const sgn of [-1, 1]) {
      const post = kit.prism({ h: 7.2, rBottom: 1.05, rTop: 0.85, sides: 6, segments: 3, jitter: 0.05, seed: rng.int(1, 1e6) });
      paintByHeight(THREE, post, GRANITE_RAMP, { lo: 0.24, hi: 0.9, jitter: 0.05 });
      place("basecamp", "granite", post, gx + sgn * 6.6, gz, { tag: "gate" });
    }
    const lintel = kit.slab(15.4, 1.15, 1.5, 0.10);
    paintByHeight(THREE, lintel, GRANITE_RAMP, { lo: 0.3, hi: 0.88 });
    lintel.translate(gx, H(gx, gz) + 7.0, gz);
    batch.add("basecamp", "granite", lintel, { tag: "gate", collisionSolid: true });

    // A cairn and a marker at the trailhead.
    // Pre-painted by the kit; a second pass would only cost time.
    const c = kit.cairn(rng, { h: 2.3, r: 0.8, layers: 9 });
    place("basecamp", "granite", c, gx + 11, gz + 5, { tag: "cairn" });

    /* --- THE CAMP ITSELF ---

       Everything below stands in the lee of the eastern buttress
       and to one side of the gate, so the `arrival` frame - the
       level's first image and the one thing every player sees - is
       still the mountain between two rocks with a camp in the
       corner of it, rather than a camp with a mountain behind it.

       `campX/campZ` is that corner, and every prop is placed as an
       offset from it in a LOCAL frame whose +z runs downwind. A camp
       is laid out against the weather, not against the compass. */
    const campA = Math.atan2(DOWNWIND[0], DOWNWIND[1]);   // yaw, measured off +z
    const cs = Math.cos(campA);
    const sn = Math.sin(campA);
    /** Local (right, forward) -> world, with forward running downwind. */
    const camp = (rt, fw) => [
      BASECAMP.x - 44 + rt * cs + fw * sn,
      BASECAMP.z - 18 - rt * sn + fw * cs,
    ];

    /* --- TENTS ---

       Ridge tents, because a ridge tent is the one shelter whose
       silhouette survives being 40 px wide: two sloping planes and a
       line. Built as a triangular section extruded along the ridge,
       with the DOOR END downwind and the guys taken out to pegs.

       The guy lines are the reason to build these at all. A tent
       with no guys is a wedge; a tent with six lines pulling
       downwind off its windward ridge end is a tent in a gale, and
       it restates the level's wind vector at ground level where the
       spindrift up on the crests cannot be seen. */
    for (let i = 0; i < 9; i += 1) {
      const row = i % 3;
      const col = Math.floor(i / 3);
      const [tx, tz] = camp(-26 + row * 15 + rng.jit(2.6), -14 + col * 16 + rng.jit(2.6));
      const L = rng.range(4.2, 5.6);
      const W = rng.range(2.6, 3.2);
      const HT = rng.range(1.7, 2.1);
      const parts = [];
      /* The canvas: a gable section swept along the ridge. Authored
         in (x, y) and extruded in z by `extrudeZ`, which force-winds
         its profile - so a section entered clockwise cannot come out
         inside-out, which is the failure that took the Vault-
         Cathedral's largest roof out of the light entirely. */
      const skin = kit.extrudeZ([
        [-W / 2, 0], [0, HT], [W / 2, 0], [W / 2 * 0.86, 0], [0, HT * 0.86], [-W / 2 * 0.86, 0],
      ], L);
      parts.push(skin);
      // The two end poles, and the ridge pole between them.
      for (const s of [-1, 1]) {
        parts.push(kit.prism({ h: HT + 0.2, rBottom: 0.05, rTop: 0.04, sides: 4 })
          .translate(0, 0, s * L / 2));
      }
      const ridge = kit.prism({ h: L, rBottom: 0.05, rTop: 0.05, sides: 4 });
      ridge.rotateX(Math.PI / 2);
      ridge.translate(0, HT + 0.06, -L / 2);
      parts.push(ridge);
      let tent = mergeGeometries(THREE, parts);
      /* Turned first, rimed second: `paintRimed` resolves the wind in
         the geometry's own frame, so a prop yawed after the paint
         carries its ice round with it. */
      kit.transform(tent, { rot: [0, campA + rng.jit(0.2), 0] });
      tent = paintRimed(tent, BARK_RAMP, {
        min: -0.2, max: HT + 0.3, rime: 0.65, threshold: 0.06,
        normalWeight: 0.3, jitter: 0.14,
      });
      place("basecamp", "bark", tent, tx, tz, {
        tag: "tent", bedFactor: 0.85, maxBed: 0.55, load: 1.5, capBins: 14,
      });

      /* GUY LINES, in their own bin: they are 4 cm tubes, so they
         belong in `iron` with the flag cords rather than in the
         canvas, and they must not be `collisionSolid` - the whole
         reason collide.js has a half-metre clutter filter is that a
         guy line marked solid is a two-metre invisible pillar
         standing in an open camp. */
      const lines = [];
      const groundY = H(tx, tz);
      for (let g = 0; g < 6; g += 1) {
        const s = g % 2 ? 1 : -1;
        const along = (Math.floor(g / 2) - 1) * L * 0.42;
        const top = [
          Math.sin(campA) * along + Math.cos(campA) * 0,
          HT + 0.06,
          Math.cos(campA) * along,
        ];
        /* The peg goes downwind and out to the side, at about 45
           degrees, which is where a guy is pegged and also where it
           casts a readable shadow across the snow at a 7-degree sun. */
        const out = 2.3 + rng.range(0, 0.8);
        const px = top[0] + (Math.cos(campA) * s * out) + DOWNWIND[0] * out * 0.5;
        const pz = top[2] + (-Math.sin(campA) * s * out) + DOWNWIND[1] * out * 0.5;
        const pegY = H(tx + px, tz + pz) - groundY;
        lines.push(kit.tube([
          [top[0], top[1], top[2]],
          [lerp(top[0], px, 0.5), lerp(top[1], pegY, 0.5) - 0.10, lerp(top[2], pz, 0.5)],
          [px, pegY + 0.05, pz],
        ], 0.035, 3));
        lines.push(kit.prism({ h: 0.34, rBottom: 0.045, rTop: 0.03, sides: 3 })
          .translate(px, pegY - 0.06, pz));
      }
      const guys = paintFlat(THREE, mergeGeometries(THREE, lines), K.barkLit, 0.2);
      guys.translate(tx, groundY, tz);
      batch.add("basecamp", "iron", guys, {
        tag: "guys", collisionSolid: false, noCollide: true, castShadow: true,
      });
    }

    /* --- THE SUPPLY STACK ---

       One heap, not a scatter. A depot is a place somebody stacked
       things and then lashed them down, and the stack reads as human
       intent from 400 m in a way that fifteen crates lying about
       does not. */
    {
      const [sx, sz] = camp(20, 2);
      const parts = [];
      for (let i = 0; i < 14; i += 1) {
        const tier = Math.floor(i / 5);
        const k = i % 5;
        const w = rng.range(1.1, 1.7);
        const d = rng.range(0.8, 1.2);
        const hh = rng.range(0.6, 0.9);
        const b = kit.slab(w, hh, d, 0.05);
        b.translate(
          (k - 2) * 1.5 + rng.jit(0.3) + tier * 0.5,
          tier * 0.86,
          rng.jit(0.5) - tier * 0.4,
        );
        kit.transform(b, { rot: [0, rng.jit(0.24), 0] });
        parts.push(b);
      }
      for (let i = 0; i < 5; i += 1) {
        const c = kit.merge([
          kit.prism({ h: 1.9, rBottom: 0.42, rTop: 0.42, sides: 8 }),
          kit.prism({ h: 0.2, rBottom: 0.48, rTop: 0.44, sides: 8 }).translate(0, 1.9, 0),
        ]);
        kit.transform(c, { rot: [Math.PI / 2, rng() * TAU, 0] });
        c.translate(-5.4 + i * 0.95, 0.42, rng.jit(1.1));
        parts.push(c);
      }
      let stack = mergeGeometries(THREE, parts);
      // Turned first, rimed second - see the tents above.
      kit.transform(stack, { rot: [0, campA, 0] });
      stack = paintRimed(stack, SCREE_RAMP, {
        min: -0.3, max: 2.8, rime: 0.7, threshold: 0.06,
        normalWeight: 0.34, jitter: 0.2,
      });
      place("basecamp", "scree", stack, sx, sz, {
        tag: "supplies", bedFactor: 0.8, maxBed: 0.5, load: 1.6,
      });
      poi("basecamp-depot", "The Supply Stack", sx, sz);
    }

    /* --- THE WRECKED LANDER ---

       The reason there is a camp here at all, and the level's one
       piece of scale furniture that is neither rock nor masonry: a
       26 m hull lying on its side gives the mountain behind it a
       ruler. Vesper's threshold has the same object for the same
       reason (world.js:1052) and the massing is deliberately its
       cousin - one fleet, two worlds.

       It lies NOSE UPHILL and heeled over, so the mountain is
       framed by something that came down trying to reach it. */
    {
      const [wx, wz] = camp(-40, 26);
      const L = 26;
      const parts = [];
      parts.push(kit.ringSolid([
        { y: 0, rx: 2.6, rz: 3.0, sides: 7 },
        { y: L * 0.30, rx: 3.7, rz: 4.1, sides: 7, phase: 0.3 },
        { y: L * 0.66, rx: 3.4, rz: 3.8, sides: 7, phase: 0.5 },
        { y: L * 0.88, rx: 2.4, rz: 2.7, sides: 7, phase: 0.7 },
        { y: L, rx: 0.8, rz: 0.9, sides: 7, phase: 0.9 },
      ]));
      for (const s of [-1, 1]) {
        const wing = kit.extrudeZ([
          [0, 0], [9.5 * s, 1.4], [11.5 * s, 4.2], [2.4 * s, 4.0], [0, 2.2],
        ], 0.7);
        wing.rotateX(Math.PI / 2);
        wing.rotateZ(s * 0.1);
        wing.translate(0, L * 0.42, 0);
        parts.push(wing);
      }
      let hull = mergeGeometries(THREE, parts);
      /* Laid down FIRST. The hull is rolled about x and z as well as
         yawed, so riming it upright and then tipping it would put the
         ice on what is now its underside - and the min/max below are
         read off the bounding box for the same reason: after a 1.3
         radian roll a 26 m hull is 8 m tall. */
      kit.transform(hull, { rot: [1.30, campA + 0.9, 0.22] });
      /* Rimed like everything else, and this is the object that
         proves the rule is not just for masonry: an iron hull lying
         on a col in a 14 m/s wind ices on its WNW flank and stays
         bare metal on its lee, and that split is the difference
         between a wreck that has been here a season and a prop. */
      hull = rimeProp(hull, {
        ramp: HULL_RAMP, feathers: 0.18,
        rime: 0.85, threshold: 0.05, normalWeight: 0.42, jitter: 0.2, noise: 0.24,
      });
      place("basecamp", "iron", hull, wx, wz, {
        tag: "lander", bedFactor: 0.9, maxBed: 2.2, load: 1.8, capBins: 22,
      });
      /* 0.7, not 1.7. A wreck that is still smoking is good
         storytelling and a forty-metre brown column across the
         level's arrival frame is not - a blind reviewer picked it
         out as the single ugliest thing in that shot. Enough to
         read as smoke from the gate, not enough to be the subject. */
      emitters.push({ kind: "smoke", x: wx, y: H(wx, wz) + 4.5, z: wz, scale: 0.7, rate: 0.18 });
      poi("basecamp-lander", "The Wreck", wx, wz);
    }

    /* --- RIBBON POLES ---

       The Concord marks its dead with a pole and a ribbon, and the
       basecamp is where a climbing party's dead are counted. They
       are also the only cloth in the lower half of the level, which
       means they are the only thing down here that MOVES: `banners`
       goes to vfx.js's `buildBanners`, which reads
       `spec.geo.attributes.wave` and animates every piece of cloth
       on the level from one merged mesh.

       Pushing a bare {x,y,z} into that array instead is what a first
       pass did elsewhere in this file, and `buildBanners`
       dereferences `spec.geo.attributes` with no guard at all. */
    for (let i = 0; i < 30; i += 1) {
      const [px, pz] = camp(rng.gauss() * 34 - 6, rng.gauss() * 26 + 8);
      if (Math.hypot(px - BASECAMP.x, pz - BASECAMP.z) < 12) continue;
      const poleH = rng.range(2.4, 4.0);
      const yaw = rng() * TAU;
      const poleY = H(px, pz) - 0.06;
      const g = kit.ribbonPole(rng, { h: poleH });
      paintFlat(THREE, g, K.barkMid, 0.22);
      kit.transform(g, { pos: [px, poleY, pz], rot: [0, yaw, 0] });
      batch.add("basecamp", "bark", g, {
        tag: "ribbon-pole", collisionSolid: false, noCollide: true,
      });

      const ban = kit.banner({
        w: 0.44, h: rng.range(1.5, 2.7), cols: 2, rows: 7,
        sag: 0.02, amp: 0.30, taper: 0.35,
      });
      ban.translate(-0.30, poleH * 0.86, 0);
      kit.transform(ban, { pos: [px, poleY, pz], rot: [0, yaw, 0] });
      banners.push({
        geo: ban, district: "basecamp",
        colour: rng.pick([K.ember, K.rimeMid, K.bellVerdigris, K.sulphurLit]),
        accent: K.rimeLit, wind: 2.2,
      });
    }

    poi("basecamp", S.name, S.x, S.z);
    stationSites.push({ id: "basecamp", x: S.x, z: S.z, padR: S.padR, padY: S.padY });
    await progress("Pitching the Basecamp");
  }

  /* ------------------------------------------------------------
     STATION: THE BLACK TARN  (SW, 41m)

     Silhouette: a flat dark oval. The only dark ground on the
     mountain, and the only mirror.

     THE TARN IS THE LEVEL'S ONE PIECE OF NEGATIVE VALUE. Everything
     else here is between mid grey and white; this is the only place
     the frame gets a true dark, and it is what every other surface
     is measured against. That is why the ice is `blackIce` at
     roughness 0.10 - almost a mirror, taking its colour from the
     sky rather than scattering its own - and why nothing bright is
     allowed to sit on it.

     Three things the finishing pass owed it, and all three are
     about the EDGE of the ice rather than its middle: the shore
     ice-shelf where the lake meets the pad, the thermokarst cracks
     radiating from the pressure ridges, and a paint fix.
     ------------------------------------------------------------ */

  async function buildTarn() {
    const S = STATIONS.tarn;
    const rng = makeRng(0x7a2f);
    const R = S.padR * 0.86;
    const ICE_Y = S.padY + 1.02;

    /* The lake surface is REAL GEOMETRY, one metre above the pad,
       because black ice has to be a PLANE - a lake that follows the
       terrain's undulation is not a lake. Radial rather than
       gridded so the rim is a circle and not a staircase. */
    const ice = kit.ringSolid([
      { y: S.padY + 0.72, r: R * 0.985, sides: 64, phase: 0 },
      { y: ICE_Y, r: R, sides: 64, phase: 0 },
    ], { capTop: true, capBottom: false });
    /* Painted from a NOISE field rather than by height: a plane has
       no height range, so `paintByHeight` on it returns one flat
       tone and the ice reads as a sheet of card. What varies on
       black ice is where it is thick and where a ridge has milled
       it white.

       `fbm` IS SIGNED - it returns about [-1, 1] (core.js:176) - and
       the first pass wrote `0.30 + fbm*0.55 + fbm*0.16`, which
       spends most of its range below zero. Measured on the built
       mesh, the whole lake surface came back inside a linear colour
       range of 0.004 to 0.011: not "dark", but clamped flat against
       the bottom stop of BLACKICE_RAMP, so the one surface in the
       level whose job is to reflect the sky had no tonal variation
       in it at all. */
    const tn = makeNoise2D(0x7a2f);
    paintGeometry(THREE, ice, BLACKICE_RAMP, (x, y, z) => clamp01(
      0.34
      + tn.fbm((x - S.x) / 34, (z - S.z) / 34, 4) * 0.26
      + tn.fbm((x - S.x) / 7, (z - S.z) / 7, 2) * 0.10
    ), { jitter: 0.03 });
    batch.add("tarn", "blackIce", ice, { tag: "surface", collisionSolid: true });

    /* --- THE SHORE ICE-SHELF ---

       Where a frozen lake meets its bank the ice is not flat: it has
       been lifted and dropped by the water under it all winter, so
       it breaks into a collar of tilted plates that ride up onto the
       shore. That collar is what stops the tarn reading as a dark
       disc PAINTED on the pad - the one failure this station has to
       avoid, since a disc is exactly what it is.

       Plates are cut as flat wedges of the annulus, each tipped
       about its own inner edge, so the ring stays a ring while every
       plate in it disagrees about which way is up. */
    {
      const plates = [];
      const N_PLATES = 210;
      for (let i = 0; i < N_PLATES; i += 1) {
        const a0 = (i / N_PLATES) * TAU;
        const a1 = ((i + 1) / N_PLATES) * TAU - rng.range(0.004, 0.018);
        /* 210 plates round a 120 m rim is a 3.6 m arc each, and the
           radial band is 6-9 m: a plate you can stand on. The first
           pass used 54, which at this radius cut fourteen-metre slabs
           twelve metres deep - the shore came out as a ring of
           tabletops, and from the shot's own camera height they read
           as a jetty rather than as broken ice. */
        const rIn = R * rng.range(0.955, 0.985);
        const rOut = R * rng.range(1.01, 1.055);
        const th = rng.range(0.16, 0.40);
        const foot = [
          [Math.cos(a0) * rIn, Math.sin(a0) * rIn],
          [Math.cos(a1) * rIn, Math.sin(a1) * rIn],
          [Math.cos(a1) * rOut, Math.sin(a1) * rOut],
          [Math.cos(a0) * rOut, Math.sin(a0) * rOut],
        ];
        const g = kit.polyExtrudeY(foot, 0, th);
        /* Tipped about the INNER edge, so the outboard lip rides up.
           Rotating about the plate's centroid instead drops the
           inboard edge below the lake surface and the ring reads as
           a set of steps down into the water. */
        const am = (a0 + a1) / 2;
        const px = Math.cos(am) * rIn;
        const pz = Math.sin(am) * rIn;
        g.translate(-px, 0, -pz);
        kit.transform(g, { rot: [Math.sin(am) * rng.range(0.04, 0.16), 0, -Math.cos(am) * rng.range(0.04, 0.16)] });
        g.translate(px, 0, pz);
        plates.push(g);
      }
      const shelf = kit.facet(mergeGeometries(THREE, plates));
      /* Painted by RADIUS, not height: the shelf's tonal story is
         that it goes from black lake ice at the inner edge to
         snow-choked rubble at the shore, and every plate in it is
         within 0.6 m of every other in y. */
      paintGeometry(THREE, shelf, BLACKICE_RAMP, (x, y, z) => {
        const r = Math.hypot(x, z);
        return clamp01(0.16 + 0.86 * sstep(R * 0.95, R * 1.06, r)
          + tn.fbm(x / 5, z / 5, 2) * 0.10);
      }, { jitter: 0.06 });
      shelf.translate(S.x, ICE_Y - 0.10, S.z);
      batch.add("tarn", "blackIce", shelf, { tag: "shelf", collisionSolid: true });
    }

    /* --- PRESSURE RIDGES ---

       Running as chords across the lake, because that is how an ice
       sheet fails: it buckles along a LINE, not in a patch.

       `pressureRidge` returns a geometry the kit has already painted
       from SLAB_RAMP, which on this station is wrong twice over - it
       is the level's brightest ramp on the level's darkest surface,
       and measured on the built mesh the ridges came back at a
       linear 0.51-0.88 while the lake around them sat at 0.01. Five
       white cards floating on black. Repainted here from
       BLACKICE_RAMP with the light end reserved for the milled crest
       - which is genuinely where a pressure ridge is white. */
    const ridgeAxes = [];
    for (let i = 0; i < 6; i += 1) {
      const a = rng() * TAU;
      const half = R * rng.range(0.42, 0.86);
      const pts = [];
      for (let k = 0; k <= 6; k += 1) {
        const t = (k / 6 - 0.5) * 2;
        const off = rng.jit(R * 0.10);
        pts.push([
          S.x + Math.cos(a) * half * t + Math.cos(a + 1.57) * off,
          ICE_Y,
          S.z + Math.sin(a) * half * t + Math.sin(a + 1.57) * off,
        ]);
      }
      const hh = rng.range(1.6, 3.4);
      const g = kit.pressureRidge(rng, {
        length: half * 2, height: hh, plates: 18,
        thickness: 0.4, tilt: 1.1, embed: 0.5, rubble: 12, points: pts,
      });
      paintGeometry(THREE, g, BLACKICE_RAMP, (x, y) => clamp01(
        0.10 + 0.85 * clamp01((y - ICE_Y) / Math.max(0.8, hh))
      ), { jitter: 0.08 });
      batch.add("tarn", "blackIce", g, { tag: "ridge", collisionSolid: true });
      ridgeAxes.push({ a, half, pts });
    }

    /* --- THERMOKARST CRACKS ---

       Radiating from the ridges, which is where they come from: a
       ridge is a compression failure and the cracks are the tension
       relief either side of it. They run AWAY from the ridge and
       they taper, and both of those are the whole read - a field of
       random lines on ice is a texture, a field that all points at
       the same six ridges is a mechanism.

       Built as a shallow V incised into the surface with a milled
       white lip either side, swept along the crack. The lip is what
       makes it visible: on a near-mirror surface at a 7-degree sun,
       an incision on its own returns the same sky the flat ice does
       and cannot be seen at all. */
    {
      const cracks = [];
      for (const ridge of ridgeAxes) {
        const branches = 7;
        for (let b = 0; b < branches; b += 1) {
          const along = (b / (branches - 1) - 0.5) * 1.7;
          const side = b % 2 ? 1 : -1;
          const rootX = S.x + Math.cos(ridge.a) * ridge.half * along;
          const rootZ = S.z + Math.sin(ridge.a) * ridge.half * along;
          /* Off the ridge's normal, splayed. A crack leaving at 90
             degrees every time reads as a fish bone. */
          const out = ridge.a + Math.PI / 2 * side + rng.jit(0.55);
          const len = R * rng.range(0.18, 0.46);
          const pts = [];
          let ok = true;
          for (let k = 0; k <= 8; k += 1) {
            const t = k / 8;
            const wob = Math.sin(t * 5.4 + b) * len * 0.06;
            const x = rootX + Math.cos(out) * len * t + Math.cos(out + 1.57) * wob;
            const z = rootZ + Math.sin(out) * len * t + Math.sin(out + 1.57) * wob;
            if (Math.hypot(x - S.x, z - S.z) > R * 0.965) { ok = false; break; }
            pts.push([x, ICE_Y, z]);
          }
          if (!ok || pts.length < 4) continue;
          cracks.push(kit.sweepProfile(pts, (i, t) => {
            /* Tapering to nothing at the tip: the crack closes. */
            const w = lerp(0.85, 0.10, t) * 1.0;
            const d = lerp(0.30, 0.04, t);
            return [
              [-w * 2.2, 0.09], [-w, 0.13], [-w * 0.25, -d],
              [w * 0.25, -d], [w, 0.13], [w * 2.2, 0.09],
            ];
          }, { capEnds: true }));
        }
      }
      if (cracks.length) {
        const g = mergeGeometries(THREE, cracks);
        paintGeometry(THREE, g, BLACKICE_RAMP, (x, y) => clamp01(
          /* Bright on the raised lips, black in the invert. The
             transition is the whole drawing. */
          0.04 + 0.90 * clamp01((y - (ICE_Y - 0.05)) / 0.22)
        ), { jitter: 0.05 });
        batch.add("tarn", "blackIce", g, {
          tag: "thermokarst", collisionSolid: false, noCollide: true,
        });
      }
    }

    /* --- THE DROWNED PROCESSION ---

       Statues standing in the ice to the chin. The same idea
       Vesper's Gilded Reach uses and it works for the same reason: a
       buried figure gives a surface a depth you cannot see into.

       They are RIMED on their windward faces like everything else
       above the water line, which on a figure whose only exposed
       part is a head and shoulders is most of what you can see of
       it - and it is the one thing that stops eleven granite heads
       on black ice reading as bollards. */
    for (let i = 0; i < 13; i += 1) {
      const a = (i / 13) * TAU + 0.4;
      const r = R * (0.26 + (i % 4) * 0.18);
      const x = S.x + Math.cos(a) * r;
      const z = S.z + Math.sin(a) * r;
      const g = kit.statue(rng, {
        h: 6.4, style: i % 2 ? "sword" : "orant",
        plinth: false, broken: rng.range(0, 0.35),
      });
      const geo = g && g.geo ? g.geo : g;
      const rimed = rimeProp(geo, {
        ramp: GRANITE_RAMP, feathers: 0.14, min: 4.2, max: 6.6,
        rime: 0.9, normalWeight: 0.32, jitter: 0.05,
      });
      // Sunk to the chin: 4.9 of 6.4 metres is under the ice.
      rimed.translate(x, ICE_Y - 4.9, z);
      batch.add("tarn", "granite", rimed, { tag: "drowned", collisionSolid: true });
      /* A collar of broken ice where each figure holds the sheet
         open. Cheap - twelve plates - and it is what says the
         figures were here BEFORE the ice was. */
      const collar = [];
      for (let k = 0; k < 9; k += 1) {
        const ca = (k / 9) * TAU + rng.jit(0.2);
        const cr = rng.range(1.5, 2.6);
        const p = kit.slab(rng.range(1.1, 2.0), 0.22, rng.range(0.8, 1.5), 0.04);
        kit.transform(p, { rot: [rng.jit(0.30), ca, rng.jit(0.30)] });
        p.translate(Math.cos(ca) * cr, 0, Math.sin(ca) * cr);
        collar.push(p);
      }
      const cg = kit.facet(mergeGeometries(THREE, collar));
      paintGeometry(THREE, cg, BLACKICE_RAMP, (px, py) => clamp01(0.22 + py * 1.6), { jitter: 0.06 });
      cg.translate(x, ICE_Y - 0.06, z);
      batch.add("tarn", "blackIce", cg, { tag: "collar", collisionSolid: false });
    }

    poi("tarn", S.name, S.x, S.z);
    stationSites.push({ id: "tarn", x: S.x, z: S.z, padR: S.padR, padY: S.padY });
    tarnIce = { x: S.x, z: S.z, r: R, y: ICE_Y };
    await progress("Freezing the Black Tarn");
  }

  /* ------------------------------------------------------------
     STATION: THE AVALANCHE BOWL  (SE, 62m)

     Silhouette: a clean white bowl. This station's content is
     NEGATIVE SPACE - it is the one place on the mountain where the
     player is alone in an empty field, and everything built here
     exists to make that emptiness measurable.

     SO IT IS FRAMED, NOT FILLED. Three things, all of them at the
     EDGE of the arena and all of them about the same event:

       - the CROWN LINE, a stepped fracture across the headwall,
         which says the slope has already gone once;
       - the CORNICES along the headwall's lip above it, which say
         it is loaded to go again;
       - the SNOW BRIDGE over the runnel, which is the one thing in
         the bowl you actually walk on and the only object in it
         with a consequence.

     Between them is nothing, on purpose. The floor of this arena is
     the level's white paper and the debris cones are the only marks
     allowed on it.
     ------------------------------------------------------------ */

  async function buildBowl() {
    const S = STATIONS.bowl;
    const rng = makeRng(0xb041);
    /* The headwall is uphill, which on a radial mountain means
       toward the origin. A plain xz bearing, not the compass-
       flavoured `atan2(x, z)` used for wind and sun. */
    const bear = Math.atan2(S.z, S.x);
    const padR = Math.hypot(S.x, S.z);

    /* --- THE CROWN LINE ---

       A fracture crown is a clean vertical step, a metre or two
       high, running across a slope on a curve that is convex
       downhill - it is where the slab broke away from the snow that
       stayed. It is the single most legible avalanche signature
       there is, and it is a LINE, which is why it belongs on a
       station whose subject is emptiness.

       Built in three segments with gaps, because a real crown has
       flank fractures and stops where the slab found an anchor - and
       because a continuous 300 m step 1.6 m high is a wall across
       the headwall that the walk solver cannot climb. The gaps are
       the way through. */
    {
      const crownR = padR - S.padR - 34;
      const segments = [[-0.60, -0.22], [-0.14, 0.16], [0.24, 0.58]];
      const runs = [];
      for (const [t0, t1] of segments) {
        const pts = [];
        const n = 18;
        for (let i = 0; i <= n; i += 1) {
          const t = lerp(t0, t1, i / n);
          const a = bear + t;
          /* Convex downhill: the crown bows OUT from the headwall in
             its middle, which is what a slab that failed at its
             weakest point looks like from below. */
          const r = crownR + Math.sin((i / n) * Math.PI) * 26;
          const x = Math.cos(a) * r;
          const z = Math.sin(a) * r;
          pts.push([x, H(x, z), z]);
        }
        runs.push(pts);
      }
      const crowns = [];
      for (const pts of runs) {
        crowns.push(kit.sweepProfile(pts, (i, t) => {
          /* Tapering to nothing at both ends: a crown dies out into
             the slope rather than stopping in a vertical face. */
          const hh = lerp(0.4, 1.7, Math.sin(clamp01(t) * Math.PI) ** 0.6);
          return [
            [-3.2, -0.5], [-1.1, hh * 0.10], [-0.35, hh],
            [1.4, hh + 0.24], [3.4, hh * 0.35], [4.4, -0.6],
          ];
        }, { capEnds: true }));
      }
      const crown = kit.facet(mergeGeometries(THREE, crowns));
      paintGeometry(THREE, crown, SLAB_RAMP, (x, y, z) => {
        const g = H(x, z);
        /* The exposed fracture face is the bright part - it is
           fresh-broken slab, and it is the only vertical white
           surface in the arena. The bench below it is in its own
           shadow. */
        return clamp01(0.36 + 0.58 * clamp01((y - g + 0.5) / 2.2)
          + paintNoise.fbm(x * 0.09, z * 0.09, 2) * 0.10);
      }, { jitter: 0.05 });
      batch.add("bowl", "slab", crown, { tag: "crown", collisionSolid: true });
    }

    /* --- CORNICE LIPS ALONG THE HEADWALL ---

       `crevasseLip` is a cornice builder - it cantilevers a snow lip
       over a void that it insists is ON THE LEFT of the direction of
       travel. The bowl's headwall lip has its void on the downhill
       side, so the run is walked in whichever direction puts
       downhill on its left, and getting that backwards overhangs the
       ground the player is standing on. Here the arc is walked
       CLOCKWISE in bearing, which with the outward normal pointing
       downhill puts the drop to the left. */
    {
      const lipR = padR - S.padR + 6;
      const lipRuns = [];
      for (const [t0, t1] of [[0.62, 0.04], [-0.06, -0.66]]) {
        const edge = [];
        const n = 22;
        for (let i = 0; i <= n; i += 1) {
          const a = bear + lerp(t0, t1, i / n);
          const r = lipR + Math.sin((i / n) * Math.PI) * -12;
          const x = Math.cos(a) * r;
          const z = Math.sin(a) * r;
          edge.push([x, H(x, z), z]);
        }
        const g = kit.crevasseLip(rng, {
          edge, height: 2.6, over: 2.4, under: 1.6, inboard: 3.4,
          wall: 3.0, step: 2.0, scars: 0.24,
        });
        if (g.geo && g.geo.attributes && g.geo.attributes.position.count) {
          batch.add("bowl", "slab", g.geo, { tag: "cornice", collisionSolid: true });
        }
        if (g.extras && g.extras.lip && g.extras.lip.length > 2) lipRuns.push(g.extras.lip);
      }
      hangFringe("bowl", lipRuns, {
        spacing: 2.2, length: 1.4, lengthVary: 0.8, radius: 0.06,
        max: 70, seed: 0xb041ce, tag: "cornice-ice",
      });
    }

    /* --- THE SNOW BRIDGE OVER THE RUNNEL ---

       `bowl-runnel` is a 26 m slot on the loaded headwall, and it is
       the one hazard in this arena. A bridge over it is the level's
       only piece of authored traversal, and it has to be REAL -
       walkable - or it is a decal, which the art direction rules out
       by name.

       It is therefore built the same way the Glacier Tongue's sheet
       is: a mesh named `road-surface-*` so `collide.js` leaves it out
       of the obstacle raster (collide.js:518), plus a matching entry
       in `walkSurfaceAt`. The two read one rectangle so they cannot
       drift apart.

       Sited at k = 0.30 along the slot rather than at its middle,
       because the depth tapers toward the tips - so the crossing is
       shortest and the drop under it shallowest where a bridge would
       actually have survived. It is also drawn SAGGING, and thin,
       and it is holed at one end: a snow bridge you trust is not a
       hazard. */
    {
      const c = CREVASSES.find((v) => v.id === "bowl-runnel");
      if (c) {
        const dx = c.bx - c.ax;
        const dz = c.bz - c.az;
        const L = Math.hypot(dx, dz) || 1;
        const tx = dx / L;
        const tz = dz / L;
        const nx = -tz;
        const nz = tx;
        const k = 0.30;
        const mx = lerp(c.ax, c.bx, k);
        const mz = lerp(c.az, c.bz, k);
        /* The span is the slot's full top width at this station plus
           a bank either side. Anything shorter lands in mid-air. */
        const reach = (c.half + c.span) * 0.86;
        const halfW = 5.5;
        const endY = Math.max(
          H(mx + nx * reach, mz + nz * reach),
          H(mx - nx * reach, mz - nz * reach),
        );
        const deck = [];
        const NS = 16;
        for (let i = 0; i <= NS; i += 1) {
          const t = (i / NS) * 2 - 1;
          const px = mx + nx * reach * t;
          const pz = mz + nz * reach * t;
          /* Sag: a snow bridge is a catenary of settled powder, not
             a plank. 1.1 m over a 50 m span is subtle and it is what
             separates it from a slab of masonry. */
          const y = endY - (1 - t * t) * 1.1;
          deck.push([px, y, pz]);
        }
        const bridge = kit.sweepProfile(deck, (i, t) => {
          /* Thinner and narrower in the middle. The undersides of the
             two lips are where the bridge is thickest because that is
             where it is still attached to the bank. */
          const w = halfW * lerp(1.0, 0.72, Math.sin(clamp01(t) * Math.PI));
          const th = lerp(2.6, 0.9, Math.sin(clamp01(t) * Math.PI));
          return [[-w, 0.15], [w, 0.15], [w * 0.8, -th], [-w * 0.8, -th]];
        }, { capEnds: true });
        paintGeometry(THREE, bridge, SNOW_RAMP, (x, y, z) => clamp01(
          0.30 + 0.62 * clamp01((y - (endY - 3.2)) / 3.4)
          + paintNoise.fbm(x * 0.2, z * 0.2, 2) * 0.10
        ), { jitter: 0.04 });
        batch.add("bowl", "snow", bridge, {
          tag: "bridge",
          name: "road-surface-bowl-bridge",
          collisionSolid: false, receiveShadow: true,
        });
        /* Published for `walkSurfaceAt`. The deck is stored as its
           midpoint, its two axes and its sag so the query is the same
           arithmetic the mesh used - no sampling, no table. */
        snowBridge = {
          mx, mz, nx, nz, tx, tz, reach, halfW, endY, sag: 1.1,
        };
        poi("bowl-bridge", "The Snow Bridge", mx, mz);

        /* A cairn at each end. A bridge you cannot see from thirty
           metres away in flat light is a bridge nobody crosses, and
           in whiteout - this level's second time of day - the cairns
           are the only thing that finds it. */
        for (const s of [-1, 1]) {
          const cx = mx + nx * (reach + 5) * s;
          const cz = mz + nz * (reach + 5) * s;
          const g = kit.cairn(rng, { h: 2.1, r: 0.72, layers: 8 });
          place("bowl", "granite", g, cx, cz, { tag: "bridge-cairn" });
        }
      }
    }

    /* --- OLD DEBRIS CONES ---

       Three of them, fanning from the crown line rather than from an
       arbitrary point on the headwall: this is the debris of the
       slide the crown records, so the two have to agree about where
       it started.

       A debris cone gets FINER downhill, which is the only thing
       that distinguishes it from a boulder field, and the blocks are
       SLAB, not rock - they are pieces of wind slab that tumbled and
       are already rounding off. Painting them granite makes the bowl
       read as a rockfall. */
    for (let c = 0; c < 3; c += 1) {
      const a = bear + (c - 1) * 0.34;
      const startR = padR - S.padR - 30;
      const ox = Math.cos(a) * startR;
      const oz = Math.sin(a) * startR;
      const [fx, fz] = [Math.cos(a), Math.sin(a)];
      for (let i = 0; i < 44; i += 1) {
        const t = Math.pow(rng(), 0.65);
        const spread = 0.34 * t;
        const ang = Math.atan2(-fz, -fx) + rng.jit(spread);
        const d = 18 + t * 140;
        const x = ox + Math.cos(ang) * d;
        const z = oz + Math.sin(ang) * d;
        const size = lerp(3.6, 0.55, t) * rng.range(0.6, 1.4);
        const g = kit.crag(rng, {
          height: size * rng.range(0.6, 1.2), radius: size,
          layers: 4, sides: rng.int(5, 7), lean: rng.range(0, 0.5), sink: 0.42,
        });
        paintByHeight(THREE, g, SLAB_RAMP, {
          min: -size * 0.3, max: size * 1.3, normalWeight: 0.42, noise: 0.16, jitter: 0.07,
        });
        place("bowl", "slab", g, x, z, { tag: "debris", cap: i % 4 === 0, bedFactor: 0.8 });
      }
    }

    /* Two lone markers far out in the bowl. They are the scale
       reference - "the player figure alone in white negative space"
       needs something at a known size out there or the shot has no
       depth at all - and they are the only two objects allowed on
       the floor. */
    for (const [dx, dz] of [[-88, 64], [104, -52]]) {
      const g = kit.votiveMarker(rng, { h: 3.1, r: 0.22, sides: 5 });
      const rimed = rimeProp(g.geo, {
        ramp: GRANITE_RAMP, feathers: 0.22, min: -0.3, max: 3.2,
        rime: 0.9, normalWeight: 0.3, jitter: 0.05,
      });
      place("bowl", "granite", rimed, S.x + dx, S.z + dz, { tag: "marker" });
    }

    poi("bowl", S.name, S.x, S.z);
    stationSites.push({ id: "bowl", x: S.x, z: S.z, padR: S.padR, padY: S.padY });
    await progress("Loading the Avalanche Bowl");
  }

  /* --- THE TONGUE'S GEOMETRY, AS A PURE FUNCTION ---

     Declared outside the builder because three consumers need it -
     the mesh, `walkSurfaceAt`, and every prop that stands on the
     ice - and a second copy of it is a glacier whose surface and
     whose collision disagree by however much the copies drifted.

     The flow axis is a curve rather than a ray. A glacier tongue
     follows a valley, and the NW flank's valley is where the
     terrain module already put its crevasse field (bearings -137
     to -163 degrees) and its three moulins (-129 to -158): the
     curve is fitted through those, so the ice and the holes in it
     are describing the same landform. */
  const TONGUE_R0 = 545;
  const TONGUE_R1 = 975;
  const TONGUE_A0 = -136 * Math.PI / 180;
  const TONGUE_A1 = -156 * Math.PI / 180;
  const TONGUE_THICK = 3.6;

  /** Flow-axis bearing at a normalised distance down the tongue. */
  /* `smoothstep` in core.js takes ONE argument (core.js:25); the
     three-argument GLSL spelling is `sstep`. Written the GLSL way it
     silently evaluates `smoothstep(0)` and returns a constant - which
     here would have pinned the flow axis at its first bearing and
     made the tongue a straight ray, and in the thickness term below
     would have removed both lateral margins and left a 3.6 m ice
     cliff running the length of the arena with nothing to report it. */
  const tongueAngle = (t) => lerp(TONGUE_A0, TONGUE_A1, smoothstep(clamp01(t)));
  /** Half-width in metres at a normalised distance down the tongue.
   *  Widest in the middle: a tongue is pinched where it leaves its
   *  cirque and again at the snout, and bulges where it spreads. */
  const tongueHalf = (t) => lerp(74, 104, Math.sin(clamp01(t) * Math.PI) ** 0.6)
    * (1 - 0.30 * clamp01(t) ** 3);

  /* THE SPINE IS A POLYLINE, AND THAT IS A CORRECTION.

     The first version defined the tongue in polar terms and inverted
     it analytically: `t` from the radius, `u` from the angular
     difference times the radius. Forward and backward do not agree.
     The mesh offsets laterally along the FLOW normal, while the
     inverse measures the offset along the RADIAL normal, and on a
     spiralling axis those are several degrees apart - so a vertex
     the mesh placed at u = 1.0 came back from the inverse at
     |u| = 1.1, fell through the `> 1.06` reject, and was handed a
     thickness of zero.

     The visible result was a glacier with no ice in it: the sheet
     was drawn, it was flush with the terrain everywhere, and it
     took the pale end of GLACIER_RAMP over its whole area. It
     photographed as a slightly smoother patch of snow. Nothing
     failed, nothing logged, and the station's one-line silhouette -
     "a wide pale-cyan wedge" - simply did not happen.

     A polyline spine with nearest-segment projection is exact in
     both directions by construction, because it is the same curve
     doing both jobs. 65 segments, one hypot each - and this is on
     `walkSurfaceAt`, which `collide.js` calls per query, so the
     cost was measured rather than assumed: 65 segment tests is
     under a microsecond and the tongue's bounding annulus rejects
     every sample outside the NW flank in two compares. */
  const TONGUE_SPINE = (() => {
    const pts = [];
    let s = 0;
    for (let i = 0; i <= 64; i += 1) {
      const t = i / 64;
      const r = lerp(TONGUE_R0, TONGUE_R1, t);
      const a = tongueAngle(t);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (i > 0) s += Math.hypot(x - pts[i - 1].x, z - pts[i - 1].z);
      pts.push({ x, z, s });
    }
    const total = pts[pts.length - 1].s || 1;
    for (const p of pts) p.t = p.s / total;
    return pts;
  })();

  /** A world point from tongue coordinates `(t, u)`, u in [-1, 1]. */
  function tongueXZ(t, u) {
    const tt = clamp01(t);
    const k = tt * (TONGUE_SPINE.length - 1);
    const i = Math.min(TONGUE_SPINE.length - 2, Math.floor(k));
    const f = k - i;
    const a = TONGUE_SPINE[i];
    const b = TONGUE_SPINE[i + 1];
    const px = lerp(a.x, b.x, f);
    const pz = lerp(a.z, b.z, f);
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    // Left of travel, the same handedness `sweepProfile` uses.
    const half = tongueHalf(tt);
    return [px + dz * u * half, pz - dx * u * half];
  }

  /**
   * `{ t, u, thick }` for a world point, or null outside the ice.
   * `u` is the signed lateral position in [-1, 1].
   */
  function tongueAt(x, z) {
    const r = Math.hypot(x, z);
    if (r < TONGUE_R0 - 140 || r > TONGUE_R1 + 140) return null;
    let best = Infinity;
    let bt = 0;
    let bu = 0;
    for (let i = 0; i < TONGUE_SPINE.length - 1; i += 1) {
      const a = TONGUE_SPINE[i];
      const b = TONGUE_SPINE[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const L2 = dx * dx + dz * dz || 1;
      const k = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
      const cx = a.x + dx * k;
      const cz = a.z + dz * k;
      const d = Math.hypot(x - cx, z - cz);
      if (d < best) {
        best = d;
        bt = lerp(a.t, b.t, k);
        /* Signed: the cross product of the segment tangent with the
           offset gives which side of the flow the point is on, and
           the sign has to match `tongueXZ`'s left-of-travel or the
           two disagree about which margin is which. */
        const L = Math.sqrt(L2);
        bu = ((x - cx) * (dz / L) - (z - cz) * (dx / L));
      }
    }
    const half = tongueHalf(bt);
    const u = bu / half;
    if (Math.abs(u) > 1.02) return null;
    /* Thickness: full over the middle 82% and ramped to nothing over
       the outer 18%, which at a 100 m half-width is an 18 m lateral
       margin at 20% grade. Flat to the edge reads as a swell; a
       vertical margin is a wall the player cannot leave. */
    let thick = TONGUE_THICK * sstep(1.0, 0.82, Math.abs(u))
      * lerp(0.55, 1.0, Math.sin(bt * Math.PI) ** 0.5)
      * (1 - 0.45 * clamp01((bt - 0.86) / 0.14));
    /* HOLES. The crevasses and the moulins are cut into the height
       field by summit-terrain, and ice draped over the top of them
       fills them in - which would bridge six open slots and drop
       three moulins out of the level with no error anywhere. Both
       tables are read rather than duplicated. */
    for (const c of CREVASSES) {
      const dx = c.bx - c.ax;
      const dz = c.bz - c.az;
      const L2 = dx * dx + dz * dz || 1;
      const k = clamp(((x - c.ax) * dx + (z - c.az) * dz) / L2, 0, 1);
      const dd = Math.hypot(x - (c.ax + dx * k), z - (c.az + dz * k));
      thick *= sstep(c.half + c.span * 0.45, c.half + c.span + 14, dd);
    }
    for (const m of MOULINS) {
      thick *= sstep(m.reach * 0.42, m.reach + 10, Math.hypot(x - m.x, z - m.z));
    }
    return { t: bt, u, thick: Math.max(0, thick) };
  }

  /** World Y of the ice surface, or -Infinity off the tongue.
   *  -Infinity is what `collide.js`'s `Math.max` wants; it is NOT
   *  what a geometry sampler wants. See `iceGroundAt`. */
  function iceSurfaceAt(x, z) {
    const s = tongueAt(x, z);
    if (!s || s.thick <= 0.02) return -Infinity;
    return H(x, z) + s.thick;
  }

  /** The support surface on the Tongue, for props and their drifts.
   *
   *  `snowCap` guards its BEDDING against a non-finite support
   *  (`if (!Number.isFinite(support)) support = 0`) but its drift
   *  COLLAR reads `groundAt` per bin with no guard at all - so a
   *  prop whose collar reached one metre off the ice got -Infinity
   *  back, wrote NaN into the collar's positions, and the whole
   *  merged `glacier-moraine-drift-powder` mesh came back with a NaN
   *  bounding sphere. Three.js logs it, the mesh never culls
   *  correctly again, and one NaN in a vertex buffer is a black mesh
   *  and a poisoned bloom pyramid.
   *
   *  Falling back to the terrain is also the physically right
   *  answer: a boulder half off the ice margin rests on the rock. */
  function iceGroundAt(x, z) {
    const y = iceSurfaceAt(x, z);
    return Number.isFinite(y) ? y : H(x, z);
  }

  async function buildGlacier() {
    const S = STATIONS.glacier;
    const rng = makeRng(0x91ac1e);
    /* The direction the ice travels at `t`, read off the spine so
       the seracs' topple, the channels' fall and the moraine's run
       cannot disagree with the surface they sit on. */
    const flowDir = (t) => {
      const a = tongueXZ(Math.max(0, t - 0.01), 0);
      const b = tongueXZ(Math.min(1, t + 0.01), 0);
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const L = Math.hypot(dx, dz) || 1;
      return [dx / L, dz / L];
    };

    /* --- THE ICE SHEET ---

       A grid, not a sweep. `sweepProfile` puts one world Y on a
       whole cross-section, which is correct for a parapet 0.5 m
       across and nonsense for a band 200 m across draped on a 25%
       flank - the upslope margin would float twenty metres. Every
       vertex here is sampled against the real terrain and the ice
       thickness is added on top, which is what a glacier is: a
       skin, not a bridge.

       53 x 27 samples is 1,431 vertices and 2,704 triangles for a
       430 m landform, which is under a twentieth of what the
       station's seracs cost and is the entire reason the station
       reads from 800 m. */
    {
      const NA = 52;
      const NU = 26;
      const pos = [];
      const idx = [];
      const thickAt = new Float32Array((NA + 1) * (NU + 1));
      for (let j = 0; j <= NA; j += 1) {
        const t = j / NA;
        for (let i = 0; i <= NU; i += 1) {
          const u = (i / NU) * 2 - 1;
          const [x, z] = tongueXZ(t, u * 1.0);
          const s = tongueAt(x, z);
          const th = s ? s.thick : 0;
          thickAt[j * (NU + 1) + i] = th;
          pos.push(x, H(x, z) + th, z);
        }
      }
      for (let j = 0; j < NA; j += 1) {
        for (let i = 0; i < NU; i += 1) {
          const a = j * (NU + 1) + i;
          const b = a + 1;
          const c = a + (NU + 1);
          const d = c + 1;
          /* Alternating diagonal, the same reason terrain.js:1314
             alternates its own: a fixed diagonal on a large low-relief
             sheet reads as a herringbone at grazing sun, and grazing
             sun is this level's whole texture story. */
          if ((i + j) & 1) { idx.push(a, c, b, b, c, d); } else { idx.push(a, c, d, a, d, b); }
        }
      }
      const ice = new THREE.BufferGeometry();
      ice.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      ice.setIndex(idx);
      ice.computeVertexNormals();
      /* PAINTED BY THICKNESS, not by height. GLACIER_RAMP is inverted
         relative to snow - the saturation lives at the DARK end,
         because ice is cyan where it is deep and near-white where it
         is thin - so mapping it against world height would put the
         whole ramp on the mountain's slope and hand the top of the
         tongue the pale end for no reason but its altitude.

         Two extra terms make it read as a glacier and not as a
         painted ramp: transverse banding, because ogives ARE
         transverse to the flow, and a lateral darkening, because the
         margins are dirty. */
      const bandNoise = makeNoise2D(0x91ac);
      paintGeometry(THREE, ice, GLACIER_RAMP, (x, y, z) => {
        const s = tongueAt(x, z);
        if (!s) return 0.9;
        const depth = clamp01(s.thick / TONGUE_THICK);
        const ogive = 0.5 + 0.5 * Math.sin(s.t * 46 + bandNoise.fbm(x * 0.01, z * 0.01, 2) * 2.4);
        /* Deep ice lands at 0.20 on the ramp - iceCore, a saturated
           #1a6f92 - and the thin margins run to 0.85, near the pale
           edge. The first mapping topped out at 0.86 and bottomed at
           0.28, and after 600 m of this level's aerial perspective
           the whole sheet arrived as one pale grey lobe. Aerial
           perspective is the star of the art direction and it is
           subtractive: anything meant to read as COLOUR at 600 m has
           to leave the surface with more of it than looks right up
           close. */
        return clamp01(
          0.90 - depth * 0.70
          - ogive * 0.11
          - (1 - Math.abs(s.u)) * 0.09
        );
      }, { jitter: 0.05 });
      batch.add("glacier", "glacierIce", ice, {
        tag: "sheet",
        /* THE NAME IS THE MECHANISM. See the batcher's own note: this
           prefix is the only thing that stops collide.js rasterising
           430 m of ice sheet into a wall, and `walkSurfaceAt` below
           is the other half of the same contract. */
        name: "road-surface-glacier-sheet",
        collisionSolid: false, receiveShadow: true,
      });
    }

    /* --- SERACS, in the icefall where the ice breaks over a convexity ---

       Sited by tongue coordinates rather than by bearing-and-radius,
       so they cannot leave the ice: the icefall band is t 0.18-0.46,
       which is where the terrain's own three Tongue crevasses are,
       and a serac field IS what a crevasse field looks like from
       above the fracture.

       They stand on the ICE, not on the rock under it - `groundAt`
       is the ice surface - because a serac bedded 3.6 m lower is a
       block standing in a hole it dug itself. */
    for (let i = 0; i < 34; i += 1) {
      const t = 0.16 + Math.pow(rng(), 0.9) * 0.34;
      const u = rng.range(-0.82, 0.82);
      const [x, z] = tongueXZ(t, u);
      const s = tongueAt(x, z);
      if (!s || s.thick < 1.2) continue;         // never in a slot
      const h = rng.range(7, 19);
      const [fx, fz] = flowDir(t);
      const g = kit.serac(rng, {
        h, w: h * rng.range(0.55, 1.05), d: h * rng.range(0.45, 0.9),
        topple: rng.range(0.12, 0.40),
        /* Toppling DOWNHILL, which the caller knows and the builder
           does not. Fourteen blocks leaning fourteen ways is rubble;
           thirty-four leaning one way is a glacier that is moving. */
        toppleAngle: Math.atan2(fz, fx) + rng.jit(0.35),
        fractures: rng.int(1, 3), calved: rng.int(1, 3), layers: 5, sink: 0.22,
      });
      place("glacier", "glacierIce", g, x, z, {
        tag: "serac", maxBed: 1.4, bedFactor: 0.35, capMat: "powder",
        groundAt: iceGroundAt,
      });
    }

    /* --- CREVASSE LIPS, both sides of every slot on this flank ---

       `crevasseLip` cantilevers a cornice over a void that it
       insists is ON THE LEFT of the polyline's direction of travel,
       because that is where `sweepProfile`'s positive u points.
       Handed the wrong order it overhangs solid ground and undercuts
       the snow the player is standing on, which reads as a shading
       bug rather than as a backwards array.

       So the two lips of one slot are walked in OPPOSITE directions:
       with the slot axis `t` and the left-hand normal `n = (-tz, tx)`,
       the lip at `+n` is walked along `+t` and the lip at `-n` along
       `-t`. Both then have the slot on their left. The first draft
       built one lip, on the centreline, from a polyline that never
       left the middle of the hole. */
    for (const c of CREVASSES) {
      if (!c.id.startsWith("tongue")) continue;
      const dx = c.bx - c.ax;
      const dz = c.bz - c.az;
      const L = Math.hypot(dx, dz) || 1;
      const tx = dx / L;
      const tz = dz / L;
      const nx = -tz;
      const nz = tx;
      const off = c.half + c.span - 2.2;
      const lipRuns = [];
      for (const side of [1, -1]) {
        const edge = [];
        const n = 15;
        for (let i = 0; i <= n; i += 1) {
          /* Only the middle 78% of the run. The slot's depth tapers
             to nothing over its outer quarters - that taper is the
             snow ramp a player who falls in walks out along - and a
             cornice cantilevered over ground that is no longer a
             hole is a shelf standing in a snowfield. */
          const k = 0.11 + (i / n) * 0.78;
          const kk = side > 0 ? k : 1 - k;
          const cx = lerp(c.ax, c.bx, kk) + nx * off * side;
          const cz = lerp(c.az, c.bz, kk) + nz * off * side;
          edge.push([cx, H(cx, cz), cz]);
        }
        const g = kit.crevasseLip(rng, {
          edge, height: 2.8, over: 2.1, under: 2.4, inboard: 3.0,
          wall: 4.5, step: 1.8, scars: 0.20,
        });
        if (g.geo && g.geo.attributes && g.geo.attributes.position.count) {
          batch.add("glacier", "slab", g.geo, { tag: "lip", collisionSolid: true });
        }
        if (g.extras && g.extras.lip && g.extras.lip.length > 2) lipRuns.push(g.extras.lip);
      }
      /* The cornice's own drip line is where the deepest ice in the
         level hangs. This is the `crevasse-edge` beauty shot's
         subject and the one place a fringe is worth close spacing. */
      /* 1.5 m spacing, capped at 60 per run. The first pass ran
         0.7 m uncapped and the six cornice runs alone came back at
         28,800 triangles - a tenth of the whole level's budget hung
         off three holes nobody stands at except in one beauty shot. */
      hangFringe("glacier", lipRuns, {
        spacing: 1.5, length: 2.2, lengthVary: 0.7, radius: 0.08,
        max: 60, seed: 0xc2e4a5, tag: "lip-ice",
      });
    }

    /* --- THE THREE MOULINS, with ice-lip collars ---

       summit-terrain cuts each one as a walkable funnel (a bore is a
       softlock in an environment build with no fall handler, and its
       own header says so). What the world adds is the collar: a ring
       of tipped, fractured blocks round the rim, which is what makes
       a round dip in the ice read as a shaft that water goes down.

       The throat is a dark disc at the funnel floor. It is not a
       hole - it is the bottom of one - and it is `blackIce` rather
       than glacier ice because what you see down a moulin is water
       and shadow, not a lit wall. */
    for (const m of MOULINS) {
      const rim = m.floor + m.span * 0.55;
      const blocks = [];
      const nb = 16;
      for (let i = 0; i < nb; i += 1) {
        const a = (i / nb) * TAU + rng.jit(0.10);
        const rr = rim * rng.range(0.86, 1.10);
        const bx = Math.cos(a) * rr;
        const bz = Math.sin(a) * rr;
        const g = kit.serac(rng, {
          h: rng.range(1.6, 3.6), w: rng.range(2.0, 4.2), d: rng.range(1.6, 3.4),
          /* Tipped INWARD. A collar of blocks leaning away from the
             hole is a cairn; leaning in, it is a rim that is falling
             into the thing it surrounds. */
          topple: rng.range(0.18, 0.44), toppleAngle: a + Math.PI,
          fractures: 1, calved: 1, layers: 4, sink: 0.30,
        });
        g.translate(bx, H(m.x + bx, m.z + bz) - H(m.x, m.z), bz);
        blocks.push(g);
      }
      const collar = mergeGeometries(THREE, blocks);
      place("glacier", "glacierIce", collar, m.x, m.z, {
        tag: "moulin-collar", maxBed: 0.9, bedFactor: 0.4,
      });

      const throat = kit.flatDisc(m.floor * 1.05, 0.35, 18, rng() * TAU);
      paintGeometry(THREE, throat, BLACKICE_RAMP, (x, y, z) => clamp01(
        0.06 + 0.20 * (Math.hypot(x, z) / Math.max(0.5, m.floor))
      ), { jitter: 0.06 });
      throat.translate(m.x, H(m.x, m.z) + 0.14, m.z);
      batch.add("glacier", "blackIce", throat, { tag: "moulin-throat", collisionSolid: false });
      poi(m.id, "A Moulin", m.x, m.z);

      /* A vapour plume: a moulin is the one place on a cold glacier
         where air is moving, and a wisp over the rim is what makes it
         read as a hole with depth from across the arena. `steam` is a
         PLUME_PRESETS kind - an unknown one is silently dropped. */
      emitters.push({
        kind: "steam", x: m.x, y: H(m.x, m.z) + 1.2, z: m.z, scale: 0.55,
      });
    }

    /* --- MELTWATER CHANNELS, milled into the surface ---

       Shallow incised runnels following the flow line with a wandering
       meander, sunk 0.35 m below the ice. They are the second-cheapest
       thing on this station and they are what stops the sheet reading
       as a painted ramp: an ice surface with drainage on it has a
       DIRECTION, and the direction agrees with the seracs' topple and
       with the moraine.

       0.35 m is under `collide.js`'s 0.75 m obstacle floor, so a
       channel is scenery rather than a kerb - which matters, because
       there are nine of them across the width of the arena's approach. */
    {
      const runs = [];
      for (let c = 0; c < 9; c += 1) {
        const u0 = (c / 8) * 1.5 - 0.75;
        const pts = [];
        const t0 = 0.10 + rng.range(0, 0.22);
        for (let k = 0; k <= 22; k += 1) {
          const t = t0 + (k / 22) * (0.94 - t0);
          /* Meanders drift toward the centre as they go: water on a
             convex ice surface runs to the axis, and a set of parallel
             straight lines reads as corduroy. */
          const u = lerp(u0, u0 * 0.25, t) + Math.sin(k * 0.9 + c * 2.1) * 0.055;
          const [x, z] = tongueXZ(t, u);
          const y = iceSurfaceAt(x, z);
          if (!Number.isFinite(y)) continue;
          pts.push([x, y - 0.30, z]);
        }
        if (pts.length > 4) runs.push(pts);
      }
      const chans = [];
      for (const pts of runs) {
        const w = 1.1 + rng.range(0, 1.4);
        chans.push(kit.sweepProfile(pts, () => [
          [-w, 0.34], [-w * 0.45, -0.16], [w * 0.45, -0.16], [w, 0.34],
          [w * 0.9, 0.42], [-w * 0.9, 0.42],
        ], { capEnds: true }));
      }
      if (chans.length) {
        const g = mergeGeometries(THREE, chans);
        paintGeometry(THREE, g, GLACIER_RAMP, (x, y, z) => {
          const s = tongueAt(x, z);
          /* Darkest in the invert, which is where the ice is deepest
             and wettest. The channel is the one place on this sheet
             that reaches the ramp's saturated end. */
          return clamp01(0.30 + 0.42 * clamp01((y - (iceSurfaceAt(x, z) - 0.6)) / 0.8)
            - (s ? s.thick / TONGUE_THICK : 0) * 0.16);
        }, { jitter: 0.05 });
        batch.add("glacier", "glacierIce", g, {
          tag: "meltwater", collisionSolid: false, noCollide: true,
        });
      }
    }

    /* --- THE MEDIAL MORAINE ---

       One dark stripe running the whole length of the tongue, a
       little off the axis. It is the single most legible thing you
       can put on a glacier: a medial moraine is where two ice
       streams joined and each brought its lateral rubble with it, so
       a stripe running the LENGTH of the ice is a statement that the
       ice came from two valleys and is moving.

       Built as a low ribbon of scree with boulders scattered along
       it, and the ribbon stays under 0.6 m so it is scenery rather
       than a 400 m kerb. */
    {
      const spine = [];
      for (let k = 0; k <= 30; k += 1) {
        const t = 0.06 + (k / 30) * 0.9;
        const u = -0.22 + Math.sin(t * 3.1) * 0.10;
        const [x, z] = tongueXZ(t, u);
        const y = iceSurfaceAt(x, z);
        spine.push([x, Number.isFinite(y) ? y : H(x, z), z]);
      }
      const band = kit.sweepProfile(spine, (i, t) => {
        const w = lerp(5.5, 11, Math.sin(clamp01(t) * Math.PI));
        return [[-w, 0], [-w * 0.7, 0.42], [w * 0.7, 0.42], [w, 0]];
      }, { capEnds: true });
      paintGeometry(THREE, band, SCREE_RAMP, (x, y, z) => clamp01(
        0.20 + 0.55 * clamp01(paintNoise.fbm(x * 0.06, z * 0.06, 3) * 0.5 + 0.5)
      ), { jitter: 0.14 });
      batch.add("glacier", "scree", band, { tag: "medial", collisionSolid: false });

      for (let i = 0; i < 90; i += 1) {
        const t = 0.06 + rng() * 0.9;
        const u = -0.22 + Math.sin(t * 3.1) * 0.10 + rng.jit(0.055);
        const [x, z] = tongueXZ(t, u);
        const s = rng.range(0.5, 2.6);
        const g = kit.crag(rng, {
          height: s * rng.range(0.5, 1.1), radius: s, layers: 4,
          sides: rng.int(5, 8), lean: rng.range(0, 0.5), sink: 0.44,
        });
        paintByHeight(THREE, g, SCREE_RAMP, {
          min: 0, max: s * 1.2, normalWeight: 0.4, jitter: 0.12,
        });
        place("glacier", "scree", g, x, z, {
          tag: "moraine", cap: i % 6 === 0, groundAt: iceGroundAt, maxBed: 0.5,
        });
      }
    }

    /* --- THE TERMINAL MORAINE, at the snout ---

       An arc of dirty ice and rock across the tongue's foot, just
       BEYOND where the ice ends: a terminal moraine is the bulldozed
       heap the glacier left at its furthest advance, so it belongs
       outside the present terminus, not on it. That gap is what
       says the ice has retreated. */
    for (let i = 0; i < 70; i += 1) {
      const u = rng.range(-1.15, 1.15);
      const t = 1.0 + rng.range(0.02, 0.10);
      const [bx, bz] = tongueXZ(Math.min(1, t), u);
      const push = 26 + rng.range(0, 34);
      const [fx, fz] = flowDir(1);
      const x = bx + fx * push;
      const z = bz + fz * push;
      if (Math.hypot(x, z) > 995) continue;      // inside the player's own clamp
      const s = rng.range(0.7, 3.6);
      const g = kit.crag(rng, {
        height: s * rng.range(0.5, 1.2), radius: s, layers: 4,
        sides: rng.int(5, 8), lean: rng.range(0, 0.5), sink: 0.44,
      });
      paintByHeight(THREE, g, SCREE_RAMP, {
        min: 0, max: s * 1.3, normalWeight: 0.42, jitter: 0.12,
      });
      place("glacier", "scree", g, x, z, { tag: "terminal", cap: i % 4 === 0 });
    }

    poi("glacier", S.name, S.x, S.z);
    stationSites.push({ id: "glacier", x: S.x, z: S.z, padR: S.padR, padY: S.padY });
    await progress("Grinding the Glacier Tongue");
  }

  /* ------------------------------------------------------------
     STATION: THE RIME FOREST  (E, 141m)

     Silhouette: a bristling dark band. The only canopy on the
     mountain, and the only place the wind is legible as a shape.

     THE RIME IS A SECOND MATERIAL, not a second colour, and that is
     the finishing pass's one real requirement here. Frost that is
     painted onto bark is bark that has been painted; frost that is
     its own surface - matte, rangeless, scattering, on its own
     geometry standing proud of the wood - is a different substance,
     and the difference is visible at 200 m because the two respond
     to the same light in opposite ways. `summit-art` already
     publishes `rime`: roughness 0.99, no sastrugi relief at all,
     wrap 0.70, and the highest scatter in the level.

     So every tree is built twice. The wood is the trunk and its
     stubs. The rime is the WINDWARD FACES OF THAT SAME GEOMETRY,
     copied out, displaced into feathers, and handed to the other
     material. Nothing here is rotated, mirrored or randomised per
     tree: a hundred and twenty trees carry one wind bearing between
     them, which is what the layout means by "all pointing the same
     way", and a forest with isotropic frost is a forest whose
     weather has no heading.
     ------------------------------------------------------------ */

  /**
   * The windward half of a geometry, as its own solid.
   *
   * Triangles are kept per FACE rather than per vertex: a vertex
   * normal on a five-sided trunk is an average of two faces pointing
   * 72 degrees apart, so a per-vertex test keeps half a shell of
   * loose triangles round the whole trunk. The face normal is the
   * honest question - "does this facet see the wind" - and it is the
   * one the shell has to answer.
   *
   * The kept faces are then pushed OUT along their own normal (rime
   * grows on the surface, so it has to stand proud of it or it
   * z-fights the wood it grew on) and UPWIND, because a feather
   * grows into the wind rather than along the surface.
   */
  function windwardShell(geo, opts = {}) {
    if (!geo || !geo.attributes || !geo.attributes.position) return null;
    const src = geo.attributes.position;
    const idx = geo.index;
    const count = idx ? idx.count : src.count;
    const threshold = opts.threshold ?? 0.18;
    const proud = opts.proud ?? 0.06;
    const reach = opts.reach ?? 0.55;
    const out = [];
    const ax = new Float32Array(3);
    const bx = new Float32Array(3);
    const cx = new Float32Array(3);
    for (let t = 0; t < count; t += 3) {
      const ia = idx ? idx.getX(t) : t;
      const ib = idx ? idx.getX(t + 1) : t + 1;
      const ic = idx ? idx.getX(t + 2) : t + 2;
      ax[0] = src.getX(ia); ax[1] = src.getY(ia); ax[2] = src.getZ(ia);
      bx[0] = src.getX(ib); bx[1] = src.getY(ib); bx[2] = src.getZ(ib);
      cx[0] = src.getX(ic); cx[1] = src.getY(ic); cx[2] = src.getZ(ic);
      const e1x = bx[0] - ax[0]; const e1y = bx[1] - ax[1]; const e1z = bx[2] - ax[2];
      const e2x = cx[0] - ax[0]; const e2y = cx[1] - ax[1]; const e2z = cx[2] - ax[2];
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const L = Math.hypot(nx, ny, nz);
      if (L < 1e-9) continue;                 // degenerate: no face to face the wind
      nx /= L; ny /= L; nz /= L;
      const e = windExposure(nx, ny, nz);
      if (e <= threshold) continue;
      /* How far the feather stands off, per face. A feather is longer
         where the face is square to the wind and shorter where it is
         raking, which is the whole reason a rimed trunk is a wedge
         rather than a sleeve. */
      const grow = proud + reach * Math.pow((e - threshold) / (1 - threshold), 1.4);
      for (const v of [ax, bx, cx]) {
        out.push(
          v[0] + nx * proud + WINDWARD[0] * grow,
          v[1] + ny * proud,
          v[2] + nz * proud + WINDWARD[1] * grow,
        );
      }
    }
    if (out.length < 9) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
    g.computeVertexNormals();
    return g;
  }

  async function buildRimeForest() {
    const S = STATIONS.rime;
    const rng = makeRng(0x71a3);
    const lean = SUMMIT_WIND.toward;

    /* Trees are placed by rejection over the pad, thinned toward the
       edge so the stand has a soft boundary. A hard circular edge on
       a forest reads as a haircut.

       Clustered rather than uniform: real stands grow in clumps
       round whatever sheltered the first seedling, and a Poisson
       field of one spacing reads as an orchard from 700 m - which is
       the range this station's silhouette is judged at. */
    const placed = [];
    const clumps = [];
    for (let i = 0; i < 11; i += 1) {
      const a = rng() * TAU;
      const r = Math.sqrt(rng()) * S.padR * 1.05;
      clumps.push([S.x + Math.cos(a) * r, S.z + Math.sin(a) * r, rng.range(26, 62)]);
    }
    let tries = 0;
    while (placed.length < 124 && tries < 6000) {
      tries += 1;
      let x;
      let z;
      if (rng.chance(0.72)) {
        const c = clumps[rng.int(0, clumps.length - 1)];
        const a = rng() * TAU;
        const r = Math.sqrt(rng()) * c[2];
        x = c[0] + Math.cos(a) * r;
        z = c[1] + Math.sin(a) * r;
      } else {
        const a = rng() * TAU;
        const r = Math.sqrt(rng()) * S.padR * 1.5;
        x = S.x + Math.cos(a) * r;
        z = S.z + Math.sin(a) * r;
      }
      const rr = Math.hypot(x - S.x, z - S.z);
      if (rng() > 1 - sstep(S.padR * 1.55, S.padR * 0.5, rr)) continue;
      const nrm = N(x, z);
      if (nrm[1] < 0.80) continue;             // too steep to root
      let ok = true;
      for (const p of placed) {
        if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < 8.5 * 8.5) { ok = false; break; }
      }
      if (!ok) continue;
      placed.push([x, z]);
    }

    const rimeParts = [];
    for (const [x, z] of placed) {
      const h = rng.range(9, 19);
      /* A dead conifer: a tapering trunk and a few upswept stubs.
         Trunks at 7.5% of their height rather than the 4.5% the
         first pass used - at 4.5% a 12 m tree is a 0.54 m pole,
         which is under two pixels at the range the stand is read
         from, and the whole forest photographed as brown stubble. */
      const parts = [];
      parts.push(kit.prism({
        h, rBottom: h * 0.075, rTop: h * 0.016, sides: 6,
        segments: 5, jitter: 0.12, seed: rng.int(1, 1e6),
      }));
      const branches = rng.int(5, 10);
      for (let b = 0; b < branches; b += 1) {
        const t = 0.26 + (b / branches) * 0.66;
        const ba = rng() * TAU;
        const bl = h * lerp(0.30, 0.09, t) * rng.range(0.7, 1.3);
        const br = kit.prism({
          h: bl, rBottom: h * 0.024, rTop: h * 0.005, sides: 4,
          segments: 2, jitter: 0.14, seed: rng.int(1, 1e6),
        });
        /* Upswept, then swung round the trunk, then lifted. Geometry
           rotations act about the origin, so this order is the whole
           correctness argument: tilt in the branch's own frame, yaw
           it onto its bearing, and only then move it up the trunk. */
        kit.transform(br, { rot: [0, 0, 1.02 + rng.jit(0.3)] });
        kit.transform(br, { rot: [0, ba, 0] });
        br.translate(0, h * t, 0);
        parts.push(br);
      }
      const tree = mergeGeometries(THREE, parts);

      /* THE RIME SHELL, taken off the tree BEFORE the wood is
         faceted. `windwardShell` reads the index to get face
         normals, and `facet` throws the index away. */
      const shell = windwardShell(tree, {
        threshold: 0.16,
        proud: 0.05 + h * 0.004,
        reach: 0.32 + h * 0.030,
      });
      if (shell) {
        /* Ridged, not smooth. `rimeFeathers` cannot help here - the
           shell is non-indexed by construction - so the ripple goes
           in as a paint term instead: a high-frequency band ACROSS
           the wind, which is the direction feather ribs stack, and a
           slow one along it. */
        paintGeometry(THREE, shell, RIME_RAMP, (px, py, pz) => {
          const across = px * -WINDWARD[1] + pz * WINDWARD[0];
          return clamp01(
            0.52
            + 0.30 * Math.sin(across * 5.2 + py * 0.9)
            + 0.16 * paintNoise.fbm(px * 1.1, pz * 1.1, 2)
          );
        }, { jitter: 0.08 });
        rimeParts.push({ geo: shell, x, z });
      }

      const wood = paintByHeight(THREE, kit.facet(tree), BARK_RAMP, {
        min: -0.5, max: h, normalWeight: 0.34, noise: 0.2, cavity: 0.6, jitter: 0.10,
      });
      /* Leaning downwind, and the lean is the same for every tree
         because they all grew in the same wind. The SHELL takes the
         same rotation, in the same frame, before either is placed -
         a 0.09 radian lean on a 15 m trunk moves its top 1.35 m, and
         a rime shell that did not take it stands beside the tree it
         grew on rather than on it. */
      kit.transform(wood, { rot: [lean[1] * 0.09, 0, -lean[0] * 0.09] });
      if (shell) kit.transform(shell, { rot: [lean[1] * 0.09, 0, -lean[0] * 0.09] });
      /* A deeper drift load than anything else on the mountain: a
         stand traps blown snow, which is why a rime forest has waist-
         deep powder in it and the ridge fifty metres away is bare. */
      const seat = place("rime", "bark", wood, x, z, {
        tag: "conifer", bedFactor: 0.75, load: 1.7, capBins: 14,
      });
      /* AND IT IS SEATED WHERE THE TREE IS, which is not where the
         ground is. `place` beds a prop to the MINIMUM support under
         its own footprint and hands back that absolute world Y in
         `extras.seatY`; the first pass translated the shells to
         `y = 0` instead, so 15,017 triangles of bright rime were
         built correctly and then left lying on the ring-valley floor
         141 m below the forest. Nothing failed. The trees rendered
         as pure black silhouettes and it read as a lighting problem,
         which cost a full measurement cycle chasing the ambient. */
      if (shell) {
        const y = (seat && Number.isFinite(seat.seatY)) ? seat.seatY : H(x, z);
        shell.translate(x, y, z);
      }
    }

    /* The shells go in as ONE mesh per station, in the `rime`
       material. They cannot be merged with the wood - different
       material, different bin - and they must not be `collisionSolid`:
       a feather shell is 6 cm of ice on a trunk that is already in
       the collider, and rasterising it a second time only widens
       every trunk by a foot. */
    if (rimeParts.length) {
      batch.add("rime", "rime", mergeGeometries(THREE, rimeParts.map((r) => r.geo)), {
        tag: "feathers", collisionSolid: false, noCollide: true,
      });
    }

    /* --- DEADFALL ---

       Trunks that have already gone over. Three states, and the
       three together are what says the stand is DYING rather than
       decorative: lying flat and half drifted over, leaned into a
       neighbour and stuck there, and snapped off at head height with
       the top lying beside the stump.

       Every one of them lies DOWNWIND, because what pushed them over
       is the same 31 m/s that carved everything else here. */
    for (let i = 0; i < 26; i += 1) {
      const seed = placed[rng.int(0, placed.length - 1)];
      if (!seed) break;
      const x = seed[0] + rng.jit(9);
      const z = seed[1] + rng.jit(9);
      const h = rng.range(7, 15);
      const kind = i % 3;
      const parts = [];
      const trunk = kit.prism({
        h, rBottom: h * 0.072, rTop: h * 0.022, sides: 5,
        segments: 4, jitter: 0.16, seed: rng.int(1, 1e6),
      });
      if (kind === 0) {
        /* Flat on the ground, with a root plate levered up at the
           butt. The plate is the detail that makes a fallen tree
           read as uprooted rather than as a log somebody left. */
        kit.transform(trunk, { rot: [Math.PI / 2 - 0.06, 0, 0] });
        parts.push(trunk);
        const plate = kit.crag(rng, {
          height: 1.9, radius: 1.7, layers: 3, sides: 7, lean: 0.5, sink: 0.1,
        });
        kit.transform(plate, { rot: [1.25, 0, 0] });
        parts.push(plate);
      } else if (kind === 1) {
        // Leaned over and caught - a hung tree.
        kit.transform(trunk, { rot: [0.72, 0, 0.12] });
        parts.push(trunk);
      } else {
        // Snapped: a stump, and the top lying beyond it.
        const stump = kit.prism({
          h: h * 0.28, rBottom: h * 0.075, rTop: h * 0.062, sides: 5,
          segments: 2, jitter: 0.3, seed: rng.int(1, 1e6),
        });
        parts.push(stump);
        kit.transform(trunk, { rot: [Math.PI / 2 - 0.1, 0, 0] });
        trunk.translate(0, 0, h * 0.34);
        parts.push(trunk);
      }
      let fall = mergeGeometries(THREE, parts);
      /* Turned so the fall runs downwind. `atan2(z, x)` is a plain xz
         bearing; the geometry above lies along +z, so the yaw is
         measured off +z rather than off +x - and mixing the two puts
         every fallen trunk across the wind instead of along it,
         which is the one thing this station cannot afford. */
      kit.transform(fall, { rot: [0, Math.atan2(DOWNWIND[0], DOWNWIND[1]) + rng.jit(0.35), 0] });
      fall = paintByHeight(THREE, kit.facet(fall), BARK_RAMP, {
        min: -0.4, max: 2.6, normalWeight: 0.4, noise: 0.22, cavity: 0.55, jitter: 0.12,
      });
      place("rime", "bark", fall, x, z, {
        tag: "deadfall", bedFactor: 0.95, maxBed: 0.9, load: 1.9, capBins: 12,
      });
    }

    poi("rime", S.name, S.x, S.z);
    stationSites.push({ id: "rime", x: S.x, z: S.z, padR: S.padR, padY: S.padY });
    await progress("Freezing the Rime Forest");
  }

  /* ------------------------------------------------------------
     STATION: THE FUMAROLE STEPS  (NE, 162m)

     Silhouette: a stepped dark stain with plumes. The one warm
     place, and it exists so the rest of the level reads as cold.

     THE MELT RING IS THE STATION. Everything else here - the
     terraces, the sinter rims, the sulphur crusts, the steam - is
     decoration on one idea: THE SNOW STOPS. On a mountain where
     every other surface is white, a hundred-metre patch of bare wet
     rock with a raised, rotten snow edge round it is the only proof
     in the level that the ground can be warm, and the EDGE is where
     the proof lives. Fill the middle with orange and you have a
     stain; draw the boundary and you have geothermal heat.

     So the ring is built first, its radius is what every terrace is
     sited against, and the mineral staining runs downhill from each
     rim across it - because that is the second statement: the water
     goes somewhere.
     ------------------------------------------------------------ */

  async function buildFumarole() {
    const S = STATIONS.fumarole;
    const rng = makeRng(0xf0ac1e);
    /* Downhill is away from the peak. A plain xz bearing. */
    const down = Math.atan2(S.z, S.x);
    const MELT_R = 84;
    const meltNoise = makeNoise2D(0xf0ac);
    /* The melt boundary is a lobed circle rather than a circle: heat
       comes up fractures, and fractures are not radially symmetric.
       One function, read by the ground disc, the snow rim, the
       terrace siting and the staining, so they cannot disagree. */
    const meltR = (a) => MELT_R * (1 + 0.20 * meltNoise.fbm(Math.cos(a) * 1.7, Math.sin(a) * 1.7, 3));

    /* --- THE BARE GROUND ---

       A disc of wet basalt lying just proud of the terrain, with the
       sulphur crust concentrated where the water pools rather than
       spread evenly. 0.22 m proud keeps it well under collide.js's
       0.75 m obstacle floor: this is a surface, not a kerb. */
    {
      const N_A = 72;
      const N_R = 9;
      const pos = [];
      const idx = [];
      for (let j = 0; j <= N_R; j += 1) {
        const rt = j / N_R;
        for (let i = 0; i <= N_A; i += 1) {
          const a = (i / N_A) * TAU;
          const r = meltR(a) * rt;
          const x = S.x + Math.cos(a) * r;
          const z = S.z + Math.sin(a) * r;
          /* The ground DIPS toward the vents: a fumarole field is a
             shallow basin, because that is where the rock has been
             eaten away. 0.22 at the rim down to -0.35 at the middle
             is a metre of relief across 170 m, which reads as a
             hollow without ever becoming a hole. */
          pos.push(x, H(x, z) + lerp(-0.35, 0.22, rt), z);
        }
      }
      for (let j = 0; j < N_R; j += 1) {
        for (let i = 0; i < N_A; i += 1) {
          const a = j * (N_A + 1) + i;
          const b = a + 1;
          const c = a + (N_A + 1);
          const d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const pan = new THREE.BufferGeometry();
      pan.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      pan.setIndex(idx);
      pan.computeVertexNormals();
      paintGeometry(THREE, pan, SULPHUR_RAMP, (x, z2, z) => {
        const dx = x - S.x;
        const dz = z - S.z;
        const a = Math.atan2(dz, dx);
        const rt = clamp01(Math.hypot(dx, dz) / Math.max(1, meltR(a)));
        /* Black wet basalt in the middle where the water is, orange
           crust in the drying band, pale sinter at the rim where it
           has evaporated. That order is the whole read and it is the
           reverse of what looks right in a swatch - the brightest
           mineral is at the COLDEST edge. */
        /* An exponent well above 1, not below it. At 0.75 the mean
           of the disc sat in the ramp's orange band and the pan
           photographed as one tan field against tan station-tinted
           terrain - the melt ring had nothing to be a ring against.
           At 1.5 two thirds of the area is wet black basalt and the
           mineral is a rim, which is both what a fumarole field
           looks like from above and the only way this frame gets a
           dark to measure its warm colours against. */
        return clamp01(
          0.02 + 0.94 * Math.pow(rt, 1.5)
          + meltNoise.fbm(x * 0.055, z * 0.055, 3) * 0.18
        );
      }, { jitter: 0.10 });
      batch.add("fumarole", "sulphur", pan, {
        tag: "melt-pan", collisionSolid: false, receiveShadow: true,
      });
    }

    /* --- THE MELT EDGE ---

       The snowpack's cut face where it has been undermined by the
       warm ground: a ring of rotten, overhanging snow standing 0.4
       to 1.1 m above the bare pan, dirty on its underside where the
       steam has been at it.

       This is the one piece of geometry in the station that is
       allowed to be bright white, and it has to be, because the
       whole point of the edge is the CONTRAST across it. */
    {
      const pts = [];
      const n = 96;
      for (let i = 0; i <= n; i += 1) {
        const a = (i / n) * TAU;
        const r = meltR(a);
        const x = S.x + Math.cos(a) * r;
        const z = S.z + Math.sin(a) * r;
        pts.push([x, H(x, z), z]);
      }
      const edge = kit.sweepProfile(pts, (i, t) => {
        const hh = lerp(0.75, 1.70, clamp01(0.5 + 0.5 * Math.sin(i * 0.7)));
        /* u points LEFT of travel; the ring is walked anticlockwise,
           so left is INWARD. The overhang therefore leans over the
           bare pan, which is what an undermined snowpack does, and
           the sign of it is the difference between a melt edge and a
           kerb round a flower bed. */
        return [
          [-2.4, hh * 0.55], [-1.1, hh], [1.6, hh * 0.92],
          [3.6, hh * 0.30], [4.6, -0.7], [-2.4, -0.7],
        ];
      }, { capEnds: false });
      const g = kit.facet(edge);
      paintGeometry(THREE, g, SNOW_RAMP, (x, y, z) => {
        const dx = x - S.x;
        const dz = z - S.z;
        const a = Math.atan2(dz, dx);
        const over = Math.hypot(dx, dz) - meltR(a);
        /* Dirty and dark where the snow overhangs the warm ground,
           clean and bright a metre back from the edge. */
        return clamp01(0.86 + over * 0.10 + paintNoise.fbm(x * 0.3, z * 0.3, 2) * 0.12);
      }, { jitter: 0.05 });
      batch.add("fumarole", "slab", g, { tag: "melt-edge", collisionSolid: true });
    }

    /* --- SINTER TERRACES ---

       Shallow rimmed pools stepping downhill inside the melt ring.
       The rims are what make them read as terraces rather than as
       stains, and each one sits a little lower than the last so the
       set reads as a flight.

       They are placed on the DOWNHILL half of the ring, which is
       where a terrace forms: water leaves a vent, runs down, and
       drops its mineral where it slows. */
    const rims = [];
    for (let t = 0; t < 8; t += 1) {
      const k = t / 7;
      const a = down + (k - 0.5) * 1.5;
      const d = lerp(16, MELT_R * 0.86, Math.pow(k, 0.6)) * rng.range(0.85, 1.1);
      const cx = S.x + Math.cos(a) * d + rng.jit(6);
      const cz = S.z + Math.sin(a) * d + rng.jit(6);
      const r = rng.range(8, 15);
      const rimH = rng.range(0.55, 1.15);
      const ring = kit.ringSolid([
        { y: 0, r: r * 1.05, sides: 26, phase: rng() * TAU },
        { y: rimH * 0.55, r: r * 1.02, sides: 26, phase: rng() * TAU },
        { y: rimH, r, sides: 26, phase: rng() * TAU },
        { y: rimH * 1.06, r: r * 0.90, sides: 26, phase: rng() * TAU },
      ], { capTop: true, capBottom: false });
      paintByHeight(THREE, ring, SULPHUR_RAMP, {
        min: -0.2, max: rimH * 1.2, normalWeight: 0.30, noise: 0.24,
        cavity: 0.7, jitter: 0.14,
      });
      place("fumarole", "sulphur", ring, cx, cz, {
        tag: "terrace", cap: false, bedFactor: 0.25, maxBed: 0.4,
      });
      rims.push({ x: cx, z: cz, r, y: H(cx, cz) + rimH });

      /* Vent mouths. `steam` from vfx.js's PLUME_PRESETS - many
         small sprites rather than few large ones, which is the note
         that file records after a handful of 60 px discs welded into
         one hard-edged grey wedge. */
      if (t % 2 === 0) {
        emitters.push({
          kind: "steam", x: cx + rng.jit(4), z: cz + rng.jit(4),
          y: H(cx, cz) + 0.6, scale: rng.range(0.9, 1.7),
        });
      }
    }

    /* --- MINERAL STAINING, DOWNHILL FROM EVERY RIM ---

       A ribbon leaving each pool at its lowest lip and running down
       the fall line until it dries out. Painted at the SATURATED end
       of SULPHUR_RAMP at the rim and fading to the pan's tone, and
       laid 0.1 m proud so it reads as a deposit rather than as a
       decal.

       This is the term that turns eight rings into a plumbing
       system. Without it the terraces are eight unrelated objects
       that happen to be the same colour. */
    {
      const runs = [];
      for (const rim of rims) {
        for (let b = 0; b < 2; b += 1) {
          const a = down + rng.jit(0.7);
          const pts = [];
          const len = rng.range(22, 54);
          for (let k = 0; k <= 12; k += 1) {
            const t = k / 12;
            const wob = Math.sin(t * 4.2 + b * 2.1) * len * 0.05;
            const x = rim.x + Math.cos(a) * (rim.r * 0.9 + len * t) + Math.cos(a + 1.57) * wob;
            const z = rim.z + Math.sin(a) * (rim.r * 0.9 + len * t) + Math.sin(a + 1.57) * wob;
            pts.push([x, H(x, z) + 0.10, z]);
          }
          runs.push({ pts, len });
        }
      }
      const stains = [];
      for (const { pts } of runs) {
        stains.push(kit.sweepProfile(pts, (i, t) => {
          /* Spreading as it goes and thinning as it dries: a stain is
             a delta, not a pipe. */
          const w = lerp(1.6, 5.4, clamp01(t)) ;
          const th = lerp(0.24, 0.03, clamp01(t));
          return [[-w, th], [w, th], [w * 1.05, -0.45], [-w * 1.05, -0.45]];
        }, { capEnds: true }));
      }
      if (stains.length) {
        const g = mergeGeometries(THREE, stains);
        paintGeometry(THREE, g, SULPHUR_RAMP, (x, y, z) => {
          let best = 1;
          for (const rim of rims) {
            best = Math.min(best, clamp01(Math.hypot(x - rim.x, z - rim.z) / 60));
          }
          /* Hottest at the source. The ramp's top end - the pale
             sinter crust - is reserved for where the flow has almost
             stopped, which is the far end of every run. */
          return clamp01(0.44 + best * 0.52 + paintNoise.fbm(x * 0.13, z * 0.13, 2) * 0.14);
        }, { jitter: 0.14 });
        batch.add("fumarole", "sulphur", g, {
          tag: "staining", collisionSolid: false, noCollide: true,
        });
      }
    }

    /* --- WET BLACK BASALT ---

       Unrimed, and that is the tell: this is the only station on the
       mountain where `rimeProp` is deliberately NOT used. Everything
       else here ices on its WNW face; these blocks do not, because
       the ground under them is above freezing, and a viewer who has
       walked the rest of the level reads that difference before they
       read the colour. */
    for (let i = 0; i < 54; i += 1) {
      const a = rng() * TAU;
      const r = rng.range(4, MELT_R * 1.10);
      const x = S.x + Math.cos(a) * r;
      const z = S.z + Math.sin(a) * r;
      const s = rng.range(0.5, 2.8);
      const g = kit.crag(rng, {
        height: s * rng.range(0.5, 1.3), radius: s, layers: 4,
        sides: rng.int(5, 7), lean: rng.range(0, 0.4), sink: 0.4,
      });
      paintByHeight(THREE, g, SULPHUR_RAMP, {
        min: -s * 0.4, max: s * 1.5, normalWeight: 0.34, noise: 0.3,
        cavity: 0.55, jitter: 0.2,
      });
      /* Inside the melt ring the blocks stand on bare rock, so no
         cap; outside it they are half buried like everything else. */
      const inside = r < meltR(a) * 0.95;
      place("fumarole", inside ? "basaltWet" : "sulphur", g, x, z, {
        tag: inside ? "basalt" : "rubble", cap: !inside, bedFactor: inside ? 0.15 : 0.6,
      });
    }

    /* THREE VENT LIGHTS, and they are the last three the level has.

       The twelve-point-light cap is real (world.js:4955) and the
       parvis's nine braziers have spent nine of it. These are the
       other three, and they go here rather than anywhere else
       because a fumarole is the only warm light BELOW 400 m - it is
       what makes the one warm frame warm from inside rather than
       from a colour grade.

       Every one carries `userData.spec` and `userData.baseIntensity`.
       vfx.js's flicker loop reads both with no guard at all and
       takes the first frame down without them; world.js sets them at
       world.js:4965-4966 and that contract is written down nowhere
       else, so it is restated at both sites in this file. */
    for (let i = 0; i < 3 && i < rims.length; i += 1) {
      const rim = rims[i * 2];
      if (!rim) continue;
      const spec = {
        colour: "#ff9a44", intensity: 1.15, distance: 34,
        x: rim.x, y: rim.y + 1.1, z: rim.z, flicker: 0.55,
      };
      const light = new THREE.PointLight(
        new THREE.Color(spec.colour), spec.intensity, spec.distance, 2
      );
      light.position.set(spec.x, spec.y, spec.z);
      light.userData.spec = spec;
      light.userData.baseIntensity = spec.intensity;
      /* Scene-parented at build like every other light in the game:
         a light that JOINS the scene later recompiles every lit
         program in it, a measured 198 ms freeze. */
      root.add(light);
      lightObjects.push(light);
      emitters.push({ kind: "heat", x: rim.x, y: rim.y + 0.5, z: rim.z, scale: 1.2 });
    }

    poi("fumarole", S.name, S.x, S.z);
    stationSites.push({ id: "fumarole", x: S.x, z: S.z, padR: S.padR, padY: S.padY });
    fumaroleField = { x: S.x, z: S.z, r: MELT_R, y: H(S.x, S.z) };
    await progress("Venting the Fumarole Steps");
  }

  /* ------------------------------------------------------------
     STATION: THE FROZEN CASCADE  (N, 209m)

     Silhouette: a vertical white organ pipe. Backlit at alpenglow
     it is the best single frame in the level.

     THE FIRST DRAFT HAD NO WATERFALL IN IT, only pipes. Three
     `columnarIce` bands 96-128 m tall were translated to
     `H(cx, cz) + 6` - and `columnarIce` builds UPWARD from y = 0,
     so the curtain grew out of flat snow like a stand of bamboo and
     stood taller than the mountain's own shoulder. A waterfall is
     not a shape, it is a RELATION: something falls off something,
     and if the thing it falls off is not in frame there is no
     waterfall, only ice.

     So the cirque is built first and the curtain is hung off it.
     The headwall is found by walking uphill from the pad until the
     terrain has risen 90 m, which is where a real cirque's lip is,
     and the pipes hang DOWN from that line to the arena floor.
     ------------------------------------------------------------ */

  async function buildCascade() {
    const S = STATIONS.cascade;
    const rng = makeRng(0xca5cade);

    /* The station's own bearing, as a plain xz angle. Uphill is
       toward the origin, so the cirque wraps the INBOARD side of
       the pad and the fall pours outward, away from the peak. */
    const bear = Math.atan2(S.z, S.x);
    const padR = Math.hypot(S.x, S.z);

    /* THE LIP, measured. March inboard along the bearing until the
       ground has climbed 88 m above the pad. On a re-authored
       profile that radius moves and the whole station moves with
       it, which is the point: a hardcoded lip radius is a curtain
       hanging in mid-air the first time the mountain changes. */
    let lipR = padR - S.padR;
    let lipY = S.padY;
    for (let r = padR - S.padR; r > 120; r -= 4) {
      const y = H(Math.cos(bear) * r, Math.sin(bear) * r);
      if (y >= S.padY + 88) { lipR = r; lipY = y; break; }
      lipR = r; lipY = y;
    }
    const FALL = Math.max(48, lipY - S.padY + 8);

    /* --- THE CIRQUE AMPHITHEATRE ---

       An arc of cliff crags wrapping the back of the arena, tallest
       on the axis and stepping down at both horns. They are RIMED,
       heavily: this wall faces outward from the peak on the north
       side, so it never sees a 7-degree SSE sun at all, and without
       the rime pass it is a black crescent behind a bright curtain -
       which is exactly what the first draft's headwall would have
       been if it had had one. */
    const HORNS = 13;
    const cirqueLedges = [];
    for (let i = 0; i < HORNS; i += 1) {
      const t = i / (HORNS - 1);
      const a = bear + (t - 0.5) * 1.34;
      /* The arc bulges outward at the horns, which is what makes it
         an amphitheatre rather than a wall: a cirque wraps round
         behind you when you stand in its floor. */
      const r = lipR + Math.sin(t * Math.PI) * -26;
      const hh = lerp(26, 62, Math.sin(t * Math.PI) ** 0.7) * rng.range(0.85, 1.15);
      const cragR = rng.range(20, 30);
      /* --- THREAD THE WAY IN FRONT OF THE WALL --------------------

         The road rule in `place` measures from a prop's CENTRE, which
         is right for a marker post and useless for a 26 m crag: these
         horns sat 16-28 m off the Via Sacra - clear of the 7 m
         carriageway margin by their centres - and laid their bodies
         straight across it. Two road segments stalled here, and the
         cirque is the one thing on the level that must NOT lose its
         collision to fix that: it is a cliff, and walking through it
         is worse than walking round it.

         So move the crag instead of softening it, radially, by the
         least amount that clears the way, and in whichever direction
         clears first - the arc is a curve of loose horns rather than
         a surveyed line, so a few metres in or out costs nothing. */
      let x = Math.cos(a) * r;
      let z = Math.sin(a) * r;
      /* THE CLEARANCE IS THE CRAG'S SOLID MASS, NOT ITS BOUNDING
         RADIUS. At cragR + 6 a 26 m horn has to stand 32 m clear of
         the carriageway - and the Via Sacra runs the length of this
         arc, so EVERY ONE of the thirteen was being moved, 12 to 35 m
         inward, and the amphitheatre collapsed off its own lip into
         the bowl. From the air it read as a dashed line of small dark
         lumps. A crag tapers hard: `cliff: 0.74` with seven layers
         puts its collidable mass well inside its widest ring, and the
         horns that actually blocked road nodes sat 16 to 22 m out,
         not 32. */
      const clearR = cragR * 0.80 + 5;
      /* ALONG THE ARC, NOT ACROSS IT.

         The first version of this moved a blocking horn RADIALLY, by
         the least amount that cleared the way. It cleared the way and
         it buried six of them: a cirque sits on the lip of a cliff,
         `place` seats a prop at the MINIMUM support under its
         footprint, and a 26 m crag shoved 20 m off the lip has a
         footprint hanging over the drop - so it was seated 130 to
         145 m down and what had been an amphitheatre read from the
         air as a dashed line of small dark lumps. The float ledger
         called it: eleven props with |gap| over 30 m against five on
         the baseline, six of them tagged `cirque`.

         Sliding along the arc keeps the horn at the same radius,
         which on a cirque is the same contour, so its seat barely
         moves. The road crosses the arc rather than following it, so
         a few degrees is always enough. */
      /* --- CLEARING THE WAY WITHOUT MOVING THE WALL --------------

         The Via Sacra runs the length of this arc, so some of these
         horns stand over the carriageway. The first fix moved them,
         and moving a cirque horn is the one thing you cannot do: the
         wall sits on a lip, `place` seats a prop at the MINIMUM
         support under its whole footprint, and a horn shifted even
         ten metres has its rim over the drop and is seated a hundred
         and forty metres down. Measured on the float ledger, eleven
         props with |gap| over 30 m against five on the baseline, six
         of them tagged `cirque`, and from the air the amphitheatre
         read as a dashed line of dark lumps.

         Three guards were tried - move along the arc instead of
         across it, reject a candidate whose footprint minimum drops,
         widen the sampling to the crag's real 1.3x span - and each
         one cut the number without reaching zero, because `snowCap`
         samples the geometry's own bins and no ring of `H` probes
         predicts that exactly.

         So the horns do not move. A blocking one is SHRUNK until its
         own mass clears the way, which keeps it on the footing it was
         sited on and costs a few metres of a rock that is one of
         thirteen. Below 8 m it stops shrinking and keeps its size:
         at that point it is small enough that the road rule in
         `place` will take its collision instead. */
      let cragR2 = cragR;
      while (cragR2 > 8 && nearRoad(x, z, cragR2 * 0.80 + 5)) cragR2 -= 1.0;

      const g = kit.crag(rng, {
        height: hh, radius: cragR2, layers: 7, sides: 8,
        lean: 0.14, cliff: 0.74, benches: 2, sink: 0.30,
      });
      const rimed = rimeProp(g, {
        ramp: GRANITE_RAMP, feathers: 0.30, min: -4, max: hh,
        rime: 0.95, normalWeight: 0.32, jitter: 0.07,
      });
      place("cascade", "granite", rimed, x, z, {
        tag: "cirque", maxBed: 4.0, bedFactor: 0.4, cap: i % 2 === 0,
      });
      /* A bench line across each crag's shoulder, for ice to hang
         off. Straight rather than traced: the crag's own benches are
         inside a merged hull with no published polyline, and a
         chord across the front of it lands on the face either way. */
      const bx = Math.cos(a);
      const bz = Math.sin(a);
      cirqueLedges.push([
        [x - bz * 13, H(x, z) + hh * 0.56, z + bx * 13],
        [x + bz * 13, H(x, z) + hh * 0.52, z - bx * 13],
      ]);
    }
    hangFringe("cascade", cirqueLedges, {
      spacing: 1.0, length: 3.4, lengthVary: 0.72, radius: 0.10,
      max: 30, seed: 0xc12ce, tag: "cirque-ice",
    });

    /* --- THE CURTAIN ---

       Five overlapping bands so the columns fuse across the whole
       width rather than reading as five separate falls.
       `columnarIce` guarantees fusion WITHIN one call by flooring
       the column radius above half the spacing; across calls it is
       the caller's job, hence the 30% overlap.

       Hung, not stood: the geometry runs 0..FALL upward, so it is
       translated to `lipY - FALL` and its tops meet the lip. The
       bands are also pulled 22 m OUT from the lip so the lower half
       hangs clear of the slope - a curtain plastered flat on a
       hillside is a texture, and the `cascade-backlit` frame needs
       daylight between the pipes. */
    for (let b = 0; b < 5; b += 1) {
      const t = (b + 0.5) / 5;
      const a = bear + (t - 0.5) * 0.50;
      const r = lipR + 22 + rng.jit(6);
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      /* SIX FAT PIPES, NOT THIRTEEN THIN ONES.

         At 13 columns across a 30m span each pipe is 2.3m wide
         against a 128m fall - a 55:1 aspect - and five overlapping
         bands of them cover the whole cirque wall in near-vertical
         hairs. A blind reviewer called it on two separate rounds as
         "vertical hair-like smearing, planar UVs stretched down a
         near-vertical wall", and it survived two fixes aimed at the
         terrain because it is not terrain: it is this curtain.

         Six columns over 38m is 6.3m a pipe and 20:1, which is
         about what a real ice fall runs, and the wider `broken`
         range gives the curtain the ragged bottom edge that stops
         five bands reading as one comb. The bulge comes down with
         the count - a bulbous foot is a feature of a pipe you can
         see individually, and at thirteen it was just noise. */
      const g = kit.columnarIce(rng, {
        h: FALL * rng.range(0.72, 1.08), span: 38, columns: 6,
        lean: 0.16, broken: 0.42, sides: 7, bulge: 1.7,
      });
      /* Turned so the band's span runs ACROSS the fall line. Built
         spanning local x, it would otherwise stand end-on to the
         arena and five bands would read as five posts. */
      kit.transform(g, { rot: [0, -a + Math.PI / 2, 0] });
      g.translate(cx, lipY - FALL + 4, cz);
      batch.add("cascade", "cascadeIce", g, { tag: "curtain", collisionSolid: true });
    }

    /* Ice hanging off the lip itself, in front of the curtain's
       roots. This is the fringe that reads as the fall's crest. */
    {
      const crest = [];
      for (let i = 0; i <= 26; i += 1) {
        const a = bear + (i / 26 - 0.5) * 0.56;
        const r = lipR + 20;
        crest.push([Math.cos(a) * r, lipY + 1.5, Math.sin(a) * r]);
      }
      hangFringe("cascade", [crest], {
        spacing: 0.9, length: 4.5, lengthVary: 0.8, radius: 0.13,
        max: 120, seed: 0xc2e57, tag: "crest-ice",
      });
    }

    /* --- THE PLUNGE BASIN ---

       Where all that water ended up: a shattered apron of ice
       blocks at the foot, densest on the fall line and thinning
       outward, with the biggest blocks nearest the impact because
       that is where they landed rather than where they slid to. */
    for (let i = 0; i < 62; i += 1) {
      const k = Math.pow(rng(), 0.7);
      const a = bear + rng.jit(0.42);
      const r = lipR + 34 + k * 96;
      const x = Math.cos(a) * r + rng.jit(18);
      const z = Math.sin(a) * r + rng.jit(18);
      const s = lerp(7.5, 1.6, k) * rng.range(0.65, 1.35);
      const g = kit.shard(rng, {
        height: s * rng.range(1.0, 2.4), radius: s * 0.55,
        sides: rng.int(4, 6), sharpness: 0.66, lean: rng.range(0.2, 0.9),
      });
      paintByHeight(THREE, g, GLACIER_RAMP, {
        min: -s * 0.3, max: s * 2.0, normalWeight: 0.4, noise: 0.16, jitter: 0.07,
      });
      place("cascade", "glacierIce", g, x, z, { tag: "apron", cap: i % 3 === 0 });
    }

    /* THE BACKLIGHT. `cascade-backlit` is the frame this station
       exists for, and translucency in this engine is a light SHAFT
       through the ice rather than a transmission term - the ice
       materials are opaque `MeshStandardMaterial`s and the contract
       forbids adding a transmissive one to a fill-bound frame.

       A shaft costs no point light (vfx.js:1174 diverts `kind:
       "shaft"` into `buildShafts`) and it is aimed DOWN the fall
       line, away from the peak, so at a 7-degree SSE sun it rakes
       out through the gaps between the pipes rather than lighting
       the face of them. Gain is deliberately low: an additive cone
       shell is brightest at its silhouette, and pushed hard it stops
       reading as light and starts reading as a drawn shape. */
    emitters.push({
      kind: "shaft",
      x: Math.cos(bear) * (lipR + 8),
      y: lipY - FALL * 0.30,
      z: Math.sin(bear) * (lipR + 8),
      dir: [Math.cos(bear) * 0.5, -0.84, Math.sin(bear) * 0.5],
      length: FALL * 1.15, radius: 15, colour: "#bfe6f2", gain: 0.55,
    });

    poi("cascade", S.name, S.x, S.z);
    poi("cascade-lip", "The Cascade's Lip", Math.cos(bear) * lipR, Math.sin(bear) * lipR);
    stationSites.push({ id: "cascade", x: S.x, z: S.z, padR: S.padR, padY: S.padY });
    cascadeLip = { r: lipR, y: lipY, bear, fall: FALL };
    await progress("Stopping the Frozen Cascade");
  }

  /* ------------------------------------------------------------
     STATION: THE BELL TERRACE  (W, 241m)

     Silhouette: a broken comb of masonry on a cliff edge. The
     level's best sunset vantage and its only ruin.

     TWO THINGS DECIDE THIS STATION AND BOTH ARE ABOUT WHERE THE
     WEATHER COMES FROM.

     1. The comb has to stand ON the lip, not in the middle of the
        pad. A ruin sited at the arena centre is a ruin with ground
        behind it, and the silhouette the layout asks for is a
        silhouette against SKY. The lip is found by walking the pad
        rim rather than assumed, because the terrain profile is
        being re-authored and a hardcoded offset would quietly move
        the whole priory inland.

     2. The masonry is RIMED, and that is not decoration - it is
        the fix for the defect this frame had. The sun is at
        compass 158 (SSE) and 7 degrees up; the Bell Terrace faces
        west. Every wall here is therefore backlit, taking fill
        only, and with the fill cut to a third in round 1 the whole
        priory measured under sRGB 24 - a black blob where the
        level's best sunset frame should be. Rime is the brightest
        material on the mountain and it grows on the WNW faces,
        which is where the light is not. The art direction asked
        for "rime on the windward masonry only" as a material note;
        it turns out to be the lighting answer as well.
     ------------------------------------------------------------ */

  async function buildBellTerrace() {
    const S = STATIONS.bell;
    const rng = makeRng(0xbe11);

    /* THE LIP. Outward from the peak is the direction the ground
       falls away, so the priory's frontage is an arc of the pad rim
       centred on that bearing. Measured rather than assumed: the
       arc is walked at 4 m and each node is dropped to the real
       ground, so a re-profiled mountain moves the parapet with it.

       `outAngle` is a plain xz bearing (cos -> x, sin -> z), NOT
       the compass-flavoured atan2(x, z) the rest of this file uses
       for sun and wind. Mixing the two is how the first pass put
       the campanile row across the arena instead of along the
       cliff. */
    const outAngle = Math.atan2(S.z - 0, S.x - 0);
    const LIP_R = S.padR - 7;
    const ARC = 1.05;                       // +/- 60 degrees of frontage
    const lip = [];
    const lipSteps = Math.max(12, Math.round((2 * ARC * LIP_R) / 4.5));
    for (let i = 0; i <= lipSteps; i += 1) {
      const a = outAngle - ARC + (i / lipSteps) * ARC * 2;
      const x = S.x + Math.cos(a) * LIP_R;
      const z = S.z + Math.sin(a) * LIP_R;
      lip.push([x, H(x, z), z]);
    }

    /* --- the cliff parapet, and the ice under its coping ---
       A parapet is what makes exposure readable: without one the
       eye reads the lip as the edge of a snowfield. `groundAt` is
       handed the real sampler so the wall follows the ground it
       stands on instead of stepping off it at the ends. */
    {
      const wall = kit.parapet(lip, {
        h: 1.15, w: 0.52, spacing: 1.25, ruin: 0.34, embed: 0.22,
        seed: rng.int(1, 1e6), groundAt: H,
      });
      batch.add("bell", "granite", rimeProp(wall, {
        ramp: GRANITE_RAMP, feathers: 0.24,
        min: S.padY - 1.2, max: S.padY + 1.6,
        rime: 1.0, threshold: 0.04, power: 1.05, bias: 0.14,
        normalWeight: 0.30, jitter: 0.06,
      }), { tag: "cliff-parapet", collisionSolid: true });

      /* Hung off the outboard face, half a metre out from the
         centreline the wall was built along, and long: this is the
         one fringe in the level with a real drop under it and
         nothing to cut it short. */
      const outward = lip.map((p) => {
        const a = Math.atan2(p[2] - S.z, p[0] - S.x);
        return [p[0] + Math.cos(a) * 0.30, p[1] + 1.02, p[2] + Math.sin(a) * 0.30];
      });
      hangFringe("bell", [outward], {
        spacing: 0.9, length: 0.85, lengthVary: 0.72, radius: 0.055,
        max: 180, seed: 0xbe11ce, tag: "parapet-ice",
      });
    }

    /* --- the campanile: five frames in a row along the lip ---

       Ruin rises along the row from north to south - the north end
       has stood in the wind four centuries longer - and the frames
       stand INSIDE the parapet by a bay's width so the comb reads
       against sky with the parapet's coping under it.

       `bells: true` on the first three only. Nine bells is the
       layout's number and the fallen one below is the ninth; the
       two southern frames are empty headstocks, which is what says
       the priory was stripped before it was abandoned. */
    const bellMouths = [];
    for (let i = 0; i < 5; i += 1) {
      const t = (i + 0.5) / 5;
      const a = outAngle - ARC * 0.74 + t * ARC * 1.48;
      const r = LIP_R - 7.5;
      const x = S.x + Math.cos(a) * r;
      const z = S.z + Math.sin(a) * r;
      const h = 11.5 - i * 0.9;
      const g = kit.bellFrame(rng, {
        bays: 3, bayW: 4.4, h, postR: 0.52,
        ruin: 0.06 + i * 0.20, bells: i < 3, bellD: 1.55,
        paint: false, facet: false,
      });
      const stone = g.geo;
      const bronze = g.extras && g.extras.bronze;
      /* Where `place` actually seated the stone. The bells, the ropes
         and the mouth rings all hang off the frame, so they take the
         frame's seat rather than the raw ground height - the two
         differ by the bedding depth, up to 1.6 m here, which on a
         bell hung four metres up is the difference between hanging
         in its cage and hanging through the lintel. */
      let frameSeat = null;
      if (stone && stone.attributes) {
        /* TURNED FIRST, RIMED SECOND, AND THAT ORDER IS THE WHOLE
           POINT OF THE PASS.

           `rimeProp` resolves the exposure against SUMMIT_WIND in the
           geometry's OWN frame. Rime it and then yaw it and the ice
           goes round with the stone - so the pale faces end up
           wherever the rotation put them, which for a row of frames
           on an arc is a different bearing for every one of them.
           summit-structures records the same rule for the cathedral
           ("THE BUILDING MUST NOT BE ROTATED") and it has the same
           symptom here: nothing fails, and the mountain quietly stops
           looking like it has weather.

           Measured: with the rime baked before the yaw, this frame's
           masonry rendered at sRGB 20-30 - a black comb against a
           peach sky - because the rimed faces had been turned away
           from the only direction the camera can shoot this station
           from. */
        kit.transform(stone, { rot: [0, -a, 0] });
        const rimed = rimeProp(stone, {
          ramp: GRANITE_RAMP, feathers: 0.26, min: -0.6, max: h * 1.05,
          rime: 1.0, threshold: 0.04, power: 1.05, bias: 0.14,
          normalWeight: 0.36, jitter: 0.06,
        });
        frameSeat = place("bell", "granite", rimed, x, z, { tag: "campanile", maxBed: 1.6 });
      }
      if (bronze && bronze.attributes) {
        paintByHeight(THREE, bronze, BELL_RAMP, {
          min: h - 0.55 - 1.55 * 1.35, max: h - 0.30,
          normalWeight: 0.46, noise: 0.14, cavity: 0.55, jitter: 0.05,
        });
        kit.transform(bronze, { rot: [0, -a, 0] });
        bronze.translate(x, seatOf(frameSeat, x, z), z);
        batch.add("bell", "bronze", bronze, { tag: "bells", collisionSolid: true });
      }
      /* The bell mouths, brought into world space so ice can hang
         off their rims. `mouths` comes back in the frame's own local
         coordinates, so it has to take the same yaw the frame took -
         and it has to take it BEFORE the translate, in the same
         order, or the rings drift off the bells by the sine of the
         angle, which on a 7 m span is metres. */
      for (const m of (g.extras && g.extras.mouths) || []) {
        const ca = Math.cos(-a);
        const sa = Math.sin(-a);
        bellMouths.push({
          x: x + m[0] * ca + m[2] * sa,
          y: seatOf(frameSeat, x, z) + m[1],
          z: z - m[0] * sa + m[2] * ca,
          r: 1.55 * 0.5,
        });
      }
      /* BELL-ROPE STUMPS. A frozen bronze bell is a picture; a
         frozen bell with four inches of rotted rope still on the
         wheel is somebody's job that stopped. Two or three per
         frame, hanging from the head beam, most of them broken off
         short - a full rope reaching the floor would read as a
         working belfry, which is the opposite of what this is. */
      /* HUNG FROM THE BAYS THAT STILL HAVE A HEAD BEAM, and that is
         the whole of the fix.

         The stumps were placed at three evenly-spaced local x's
         regardless of what the frame had done - and `bellFrame`
         breaks its posts at random (`ruin` rises 0.10, 0.32, 0.54
         along the row), so a bay whose post snapped short has no
         head beam and the rope hung from nothing. Two blind
         reviewers, on two different rounds, independently picked
         this out as the worst thing in the Bell Terrace frame:
         "three orphaned black strokes floating in the sky, attached
         to nothing" and "three black slivers levitating in the empty
         sky left of the colonnade - unparented geometry or a failed
         LOD". They were the same three ropes.

         `extras.mouths` is the frame's own list of the bays that
         survived - it is only pushed inside the `if (!broken)`
         branch - so hanging from it is hanging from something by
         construction, and it cannot drift out of sync if the ruin
         factors are ever re-tuned. */
      const stumps = [];
      const bays = (g.extras && g.extras.mouths) || [];
      for (const bay of bays) {
        if (rng.chance(0.25)) continue;
        const lx = bay[0];
        const len = rng.range(0.6, 2.6);
        const pts = [];
        for (let k = 0; k <= 5; k += 1) {
          const kt = k / 5;
          pts.push([
            lx + Math.sin(kt * 2.2) * len * 0.10 * kt,
            h - 0.5 - kt * len,
            Math.cos(kt * 1.7) * len * 0.08 * kt,
          ]);
        }
        stumps.push(kit.tube(pts, 0.045, 4, { taper: 0.35 }));
      }
      if (stumps.length) {
        const rope = paintRimed(mergeGeometries(THREE, stumps), BARK_RAMP, {
          min: h - 3.4, max: h, rime: 0.5, normalWeight: 0.2, jitter: 0.12,
        });
        kit.transform(rope, { rot: [0, -a, 0] });
        rope.translate(x, seatOf(frameSeat, x, z), z);
        batch.add("bell", "bark", rope, { tag: "ropes", collisionSolid: false, noCollide: true });
      }
    }

    /* Ice rings round the three hung bells' mouths. A bell that has
       stood open to the weather for four hundred years is where the
       longest icicles in a belfry are, and it is a close-up detail
       the `bell-terrace-drop` frame is taken from below to see. */
    if (bellMouths.length) {
      const rings = bellMouths.map((m) => {
        const pts = [];
        for (let k = 0; k <= 14; k += 1) {
          const a = (k / 14) * TAU;
          pts.push([m.x + Math.cos(a) * m.r, m.y, m.z + Math.sin(a) * m.r]);
        }
        return pts;
      });
      hangFringe("bell", rings, {
        spacing: 0.24, length: 1.1, lengthVary: 0.75, radius: 0.05,
        max: 40, seed: 0xbe1115, tag: "bell-ice",
      });
    }

    /* --- THE PRIORY: a cloister range of cells, and the refectory ---

       A campanile on its own is a folly. What makes it a priory is
       that somebody lived here, and the cheapest true statement of
       that is a range of identical small rooms with one door each,
       sharing party walls, plus one room that is bigger than all of
       them - which is the refectory, and which is always the second
       building in a monastery after the church.

       Roofless, because a roof at 241 m in a 31 m/s wind is the
       first thing to go and because an open plan reads as a ruin
       from above, which is how this station is mostly seen. Walls
       are broken to different heights along the range for the same
       reason the campanile's posts are: a level break is demolition,
       a ragged one is weather. */
    const rangeAngle = outAngle + Math.PI / 2;    // along the frontage
    const inward = outAngle + Math.PI;            // back toward the peak
    {
      const CELL_W = 5.2;
      const CELL_D = 6.4;
      const CELL_H = 3.6;
      const T = 0.5;
      const cells = 7;
      const parts = [];
      const wall = (w, h, d, x0, y0, z0) => {
        const g = kit.slab(w, h, d, 0.06);
        g.translate(x0, y0, z0);
        parts.push(g);
      };
      for (let i = 0; i < cells; i += 1) {
        const cx = (i - (cells - 1) / 2) * CELL_W;
        /* Height falls away toward the ends of the range, with a
           per-cell wobble. Two cells are taken right down to their
           footings - the range has to have holes in it or it is a
           terrace of sheds. */
        const fall = 1 - 0.55 * Math.pow(Math.abs(i - (cells - 1) / 2) / ((cells - 1) / 2), 1.7);
        let hh = CELL_H * fall * rng.range(0.78, 1.06);
        if (i === 1 || i === 5) hh = CELL_H * rng.range(0.16, 0.30);
        // Party walls, shared: one wall per cell plus a closing one.
        wall(T, hh, CELL_D, cx - CELL_W / 2, 0, 0);
        if (i === cells - 1) wall(T, hh * 0.9, CELL_D, cx + CELL_W / 2, 0, 0);
        // Back wall, continuous.
        wall(CELL_W, hh * 1.02, T, cx, 0, -CELL_D / 2);
        /* Front wall in two jambs with a door between them. A cell
           with no opening is a bin; the door is the whole reason the
           range reads as lodging. */
        const doorW = 1.1;
        const jamb = (CELL_W - doorW) / 2;
        for (const s of [-1, 1]) {
          wall(jamb, hh * rng.range(0.7, 1.0), T, cx + s * (doorW + jamb) / 2, 0, CELL_D / 2);
        }
        // Lintel over the door, on the cells that still have one.
        if (hh > 2.2 && rng.chance(0.7)) {
          wall(doorW + 0.5, 0.34, T * 1.3, cx, 2.05, CELL_D / 2);
        }
      }
      let range = mergeGeometries(THREE, parts);
      // Turned first, rimed second - see the campanile above.
      kit.transform(range, { rot: [0, -rangeAngle + Math.PI / 2, 0] });
      range = rimeProp(range, {
        ramp: GRANITE_RAMP, feathers: 0.22, min: -0.5, max: CELL_H + 0.6,
        rime: 1.0, threshold: 0.04, power: 1.05, bias: 0.14,
        normalWeight: 0.34, jitter: 0.06,
      });
      const rx = S.x + Math.cos(inward) * 34 + Math.cos(rangeAngle) * 14;
      const rz = S.z + Math.sin(inward) * 34 + Math.sin(rangeAngle) * 14;
      place("bell", "granite", range, rx, rz, { tag: "cells", maxBed: 1.4, bedFactor: 0.5 });
      poi("bell-cells", "The Priory Cells", rx, rz);
    }

    /* The refectory. One room, 21 x 9, with a gable end that is the
       only piece of this station still standing above the campanile
       - which is what makes the comb silhouette have a second tooth
       at a different height instead of five of the same. */
    {
      const W = 9.4;
      const L = 21;
      const HH = 6.2;
      const T = 0.62;
      const parts = [];
      // Long walls, with three window openings each.
      for (const s of [-1, 1]) {
        const segs = 7;
        for (let i = 0; i < segs; i += 1) {
          const isWindow = i === 1 || i === 3 || i === 5;
          const segL = L / segs;
          const zz = (i - (segs - 1) / 2) * segL;
          if (isWindow) {
            // Sill below, head above, and open between.
            parts.push(kit.slab(T, 1.5, segL, 0.05).translate(s * W / 2, 0, zz));
            parts.push(kit.slab(T, HH - 4.1, segL, 0.05).translate(s * W / 2, 4.1, zz));
          } else {
            parts.push(kit.slab(T, HH * (i === 6 ? 0.55 : 1), segL, 0.05).translate(s * W / 2, 0, zz));
          }
        }
      }
      /* The gable, as a real triangular profile rather than a wall
         with a pointed hole. `extrudeZ` measures the profile's signed
         area and flips a clockwise one, so the wall cannot come out
         inside-out - which is the failure structures.js records for
         the Vault-Cathedral's nave roof. */
      const gable = kit.extrudeZ([
        [-W / 2 - T / 2, 0], [W / 2 + T / 2, 0],
        [W / 2 + T / 2, HH], [0, HH + 4.4], [-W / 2 - T / 2, HH],
      ], T);
      gable.translate(0, 0, -L / 2);
      parts.push(gable);
      // The far gable is down to its footings.
      parts.push(kit.slab(W + T, 1.1, T, 0.05).translate(0, 0, L / 2));
      let ref = mergeGeometries(THREE, parts);
      // Turned first, rimed second - see the campanile above.
      kit.transform(ref, { rot: [0, -rangeAngle + Math.PI / 2, 0] });
      ref = rimeProp(ref, {
        ramp: GRANITE_RAMP, feathers: 0.24, min: -0.6, max: HH + 4.4,
        rime: 1.0, threshold: 0.04, power: 1.05, bias: 0.14,
        normalWeight: 0.34, jitter: 0.06,
      });
      const fx = S.x + Math.cos(inward) * 40 + Math.cos(rangeAngle) * -30;
      const fz = S.z + Math.sin(inward) * 40 + Math.sin(rangeAngle) * -30;
      place("bell", "granite", ref, fx, fz, { tag: "refectory", maxBed: 1.6, bedFactor: 0.5 });
      poi("bell-refectory", "The Refectory", fx, fz);
    }

    /* The cloister arcade linking the two, mostly gone: six bays of
       pointed arch, four still standing. */
    for (let i = 0; i < 6; i += 1) {
      if (i === 1 || i === 4) continue;         // two bays collapsed
      const d = (i - 2.5) * 5.6;
      const x = S.x + Math.cos(inward) * 21 + Math.cos(rangeAngle) * d;
      const z = S.z + Math.sin(inward) * 21 + Math.sin(rangeAngle) * d;
      const g = kit.gothicArch({ width: 4.6, height: 7.4, depth: 1.5, thickness: 0.62, rise: 1.05 });
      // Turned first, rimed second - see the campanile above.
      kit.transform(g, { rot: [0, -rangeAngle + Math.PI / 2, 0] });
      const rimed = rimeProp(g, {
        ramp: GRANITE_RAMP, feathers: 0.20, min: -0.4, max: 7.6,
        rime: 1.0, threshold: 0.04, power: 1.05, bias: 0.14,
        normalWeight: 0.34, jitter: 0.05,
      });
      place("bell", "granite", rimed, x, z, { tag: "cloister", maxBed: 1.2 });
    }

    /* The fallen bell, through the floor and lying on its side at
       the terrace's foot. One object, and it is the station's
       close-up: the ninth bell, and the reason there are only eight
       in the frames above. */
    {
      const fallen = kit.ringSolid([
        { y: 0, r: 2.05, sides: 16, phase: 0 },
        { y: 0.45, r: 2.0, sides: 16, phase: 0 },
        { y: 1.9, r: 1.42, sides: 16, phase: 0 },
        { y: 2.7, r: 0.62, sides: 16, phase: 0 },
        { y: 3.0, r: 0.30, sides: 16, phase: 0 },
      ], { capTop: true, capBottom: false });
      /* PAINTED BEFORE IT IS LAID DOWN. A surface of revolution
         painted after being tipped on its side gets concentric
         stripes across its skirt - the same lesson Vesper's fallen
         bell records at world.js:2478 - because the ramp reads the
         world y of a vertex, and after the rotation that axis runs
         across the bell instead of along it. */
      paintByHeight(THREE, fallen, BELL_RAMP, {
        min: 0, max: 3.0, normalWeight: 0.44, noise: 0.14, cavity: 0.6, jitter: 0.05,
      });
      kit.transform(fallen, { rot: [1.42, 0.6, 0.12] });
      const fbx = S.x + Math.cos(outAngle) * (LIP_R + 16);
      const fbz = S.z + Math.sin(outAngle) * (LIP_R + 16);
      place("bell", "bronze", fallen, fbx, fbz, { tag: "fallen-bell", maxBed: 1.0 });
      poi("bell-fallen", "The Fallen Bell", fbx, fbz);
    }

    poi("bell", S.name, S.x, S.z);
    stationSites.push({ id: "bell", x: S.x, z: S.z, padR: S.padR, padY: S.padY });
    await progress("Hanging the Bell Terrace");
  }

  /* ------------------------------------------------------------
     STATION: THE SUMMIT
     The Cathedral of the Ninth Ascent, 452m.

     The building itself belongs to `summit-structures.js`. This
     function sites it: the parvis and its parapet, the stylobate
     the forty steps climb, the icicle fringes hung off the
     building's own published eaves and ledges, and the nine
     braziers - which are the only warm light above 400 m and the
     reason you can tell from the basecamp gate that someone is
     still up here.

     It is DELIBERATELY SMALL. Vesper's Vault-Cathedral is a ruin
     lying open, 132m of nave you walk into. This is a sealed
     high-altitude reliquary chapel, 54m long, and the awe is
     supposed to come from WHERE IT IS rather than how big it is.
     Building a bigger one here would make the mountain smaller.
     ------------------------------------------------------------ */

  async function buildSummitStation() {
    const S = STATIONS.summit;
    const rng = makeRng(0x9a5ce17);
    const Y = S.padY;

    /* --- the parvis: a levelled ring with a parapet --- */
    const ringPts = [];
    for (let i = 0; i <= 64; i += 1) {
      const a = (i / 64) * TAU;
      const r = S.padR - 3.0;
      ringPts.push([Math.cos(a) * r, Y, Math.sin(a) * r]);
    }
    const rail = kit.parapet(ringPts, {
      h: 1.05, w: 0.5, spacing: 1.3, ruin: 0.06, embed: 0.18,
      seed: 0x9a11, groundAt: () => Y,
    });
    /* Rimed like everything else that stands up here, and this is
       the parapet that proves the rule: it is a ring, so every
       bearing is present in one object, and after the pass the WNW
       arc is pale and the SSE arc is warm stone. If the rime ever
       goes uniform round the ring, the wind vector has been lost. */
    batch.add("summit", "granite", rimeProp(rail, {
      ramp: GRANITE_RAMP, feathers: 0.20, min: Y - 0.4, max: Y + 1.3,
      rime: 1.0, threshold: 0.04, power: 1.05, bias: 0.14,
      normalWeight: 0.30, jitter: 0.05,
    }), { tag: "parapet", collisionSolid: true });

    /* An icicle fringe under the parapet's coping, on the outboard
       side only. It is the one thing that tells you the parapet has
       a drop behind it rather than more parvis - visible in every
       `summit-parvis` and `summit-look-back` frame, and it costs
       under 900 triangles at 2.6 m spacing. */
    {
      /* Hung off the OUTER FACE of the coping, which is 0.25 m out
         from the centreline the parapet was built along (`w: 0.5`),
         and from the top of the wall rather than from inside it.
         The first attempt offset the ring by 3.5% of its radius -
         2.6 m on a 75 m ring - and the icicles hung in clear air
         well outside the wall, reading as a row of blue tick marks
         floating over the drop. An icicle has to touch the thing it
         grew off or it is a decal. */
      const face = (S.padR - 3.0 + 0.27) / (S.padR - 3.0);
      hangFringe("summit", [ringPts.map((p) => [p[0] * face, Y + 1.0, p[2] * face])], {
        spacing: 2.4, length: 0.62, lengthVary: 0.7, radius: 0.048,
        max: 220, seed: 0x9a11ce, tag: "parapet-ice",
      });
    }

    /* --- THE CATHEDRAL OF THE NINTH ASCENT ---

       Built by `summit-structures.js`'s `cathedral()`, which owns
       every dimension: 54m long, 17m wide, eaves at 13.5m, a 58
       degree roof and a 62m crossing spire, cruciform on a four-bay
       nave with a real interior. What was here before was correct
       MASSING and nothing else - two crossed boxes and a cone - and
       it is gone.

       IT MUST NOT BE ROTATED. The building is authored in world
       axes because its rime is resolved against SUMMIT_WIND at
       build time: `rimeFeathers` displaces the WNW geometry and the
       paint blends RIME_RAMP over the same exposure term. A rotated
       copy has its rime on the sheltered face, and there is no
       visible symptom at all except that the mountain quietly stops
       looking like it has weather. `opts.wind` exists for a caller
       that genuinely needs to turn it; this one does not.

       Everything comes back at y = 0 and is lifted to the parvis by
       one translate per bin. `extras.bins` restates the collision
       and shadow flags in code, and they are not interchangeable:
       the stone MUST be `collisionSolid` because most of a rose's
       tracery and a good deal of the vault is triangles under
       collide.js's half-metre clutter filter, and the glass must
       NOT be, because a collidable ice pane is a window you can
       neither see out of nor walk past. */
    const cath = kit.cathedral(rng, {});
    const CX = cath.extras;

    /* THE PODIUM, and why there is one at all.

       The building publishes `doorY = 0` and the finishing brief
       asks for the layout's forty steps to land their top tread on
       it. Those two facts together need somewhere for forty risers
       to go, and the parvis is a disc levelled dead flat at 452 m -
       so a flight measured DOWN from the threshold digs into its own
       floor. The first pass did exactly that (`y = Y - 8.6*(1-t)`)
       and the treads were buried; the flight read as a stack of
       paving slabs lying on the parvis in front of the doors.

       A stylobate is the answer the building type already has. Forty
       shallow ceremonial risers at 145 mm come to 5.8 m, which is a
       plinth a 13.5 m-eaves chapel can carry, and it does three
       things at once: it gives the steps their rise, it lifts the
       cathedral's base clear of the flat so the building has a
       BOTTOM edge to read against from the parvis and from the
       basecamp gate 900 m away, and it puts the threshold above the
       drift line, which is why real high-altitude chapels are built
       on one.

       145 mm over a 660 mm going is a 22% grade. That is walkable by
       the player's own rule (`WALK_SLOPE_LIMIT` is 1.7, i.e. 170%)
       with an enormous margin, and it is what a pilgrim stair is:
       shallow enough to climb without looking down, which is the
       point of making someone walk up it. */
    const PODIUM = 5.8;
    /* THE FLIGHT SPANS GRADE TO THRESHOLD, and the threshold is the
       pad, not the podium's waist - so it is PODIUM plus the pad's
       own 0.34. Left at PODIUM/40 the whole flight sat 34 cm high
       once the building moved onto the pad, and the first tread at
       the bottom became a 0.61 m step up off the snow. */
    const FLIGHT_RISE = PODIUM + 0.34;
    const STEP_RISE = FLIGHT_RISE / 40;
    /* THE BUILDING STANDS ON THE PAD, NOT ON THE PODIUM'S WAIST.

       The set-back band above tops out at PODIUM + 0.34 and covers
       the whole footprint, so THAT is the surface the chapel sits
       on. Seated at PODIUM the building was 34 cm low: its floor
       flags - authored to stand "5 cm proud of the pad" - were 29 cm
       UNDER it and never visible in the level, its walls began below
       it, and the great flight landed 34 cm short so the last thing
       the processional way did was ask for a knee-high step.

       Everything cathedral-side derives from this: shell, interior,
       glass, bronze, the drift, the treads and the stringer. Moving
       the datum moves them together, which is the whole reason the
       building publishes one. */
    const BASE_Y = Y + PODIUM + 0.34;
    {
      /* Extruded from the building's OWN plan rather than from a
         circle or a rectangle. `extras.footprint` is the 12-point
         cruciform at the wall face, so a scaled copy of it is a
         plinth that follows the transepts - and a plinth that does
         not follow the transepts is a box with a cross standing on
         it, which is the single most common way this reads wrong. */
      const foot = (CX.footprint || []).map((p) => [p[0] * 1.10, p[1] * 1.08]);
      if (foot.length >= 3) {
        let plinth = kit.polyExtrudeY(foot, -0.8, PODIUM);
        /* Two set-backs rather than one face: a 5.8 m blank wall at
           the foot of a building is a retaining wall. The upper band
           is inset so the podium reads as courses. */
        /* THE PAD IS AT PODIUM + 0.34 AND THE FLOOR SITS ON IT.

           This band was briefly topped out flush at PODIUM to stop
           it burying the chapel's floor, and that was the wrong half
           of the problem: it left the whole parvis 34 cm below the
           level the player is walked at, so you climbed the great
           flight and then floated over the paving.

           The interior's own comment had it right all along - "Top
           face 5 cm proud of the pad" - and the pad is THIS, at
           PODIUM + 0.34. The flags were laid at +0.05, five
           centimetres proud of the building's y = 0, which is 34 cm
           UNDER the pad they were meant to sit on. Fixing the flags
           is the fix; see their translate. */
        /* Kept: the set-back is about the podium's FACE.

           The set-back is about the podium's FACE - "a 5.8 m blank
           wall at the foot of a building is a retaining wall" - so
           the band only ever needed to be inset, not taller. Carried
           to PODIUM + 0.34 it is a full inset EXTRUSION, which means
           that above the building's own y = 0 it becomes a solid
           plate spanning the entire footprint: a false floor 34 cm
           over the real one, burying the bottom of every wall and
           the whole of the polished black floor the interior section
           builds. Photographed from the crossing, the nave's floor
           was a flat pale granite plane - the podium, seen from
           above - and the black stone under it was never visible in
           the level at all. Topped out at PODIUM the band still
           reads as two courses from outside, which is all it was
           for. */
        const cap = kit.polyExtrudeY(
          (CX.footprint || []).map((p) => [p[0] * 1.045, p[1] * 1.035]),
          PODIUM - 0.55, PODIUM + 0.34,
        );
        plinth = mergeGeometries(THREE, [plinth, cap]);
        plinth = rimeProp(plinth, {
          ramp: GRANITE_RAMP, feathers: 0.16, min: -0.8, max: PODIUM + 0.34,
          rime: 0.85, threshold: 0.05, bias: 0.12, normalWeight: 0.34, jitter: 0.05,
        });
        plinth.translate(0, Y, 0);
        batch.add("summit", "granite", plinth, { tag: "podium", collisionSolid: true });
        /* The walkable top of that plinth, in world space.

           PODIUM + 0.34 is the level the parvis and the chapel floor
           have always been walked at, and it stays that way: the
           porch frontispiece carries a piece of shell an even metre
           above the building's y = 0, which a player standing at
           +0.34 clears and a player standing at +0.05 walks into.
           Dropping the footing to the building's own zero made the
           cathedral unenterable again, three metres short of the
           doors. So the FLOOR comes up to meet this instead - see
           the interior's flag translate - rather than this coming
           down to meet the floor. */
        summitPodium = { poly: foot, topY: BASE_Y + 0.05 };
      }
    }

    for (const g of [cath.stone, cath.interior, cath.glass, cath.bronze, CX.drift]) {
      if (g && g.attributes && g.attributes.position) g.translate(0, BASE_Y, 0);
    }
    batch.add("summit", "granite", cath.stone, { tag: "chapel", collisionSolid: true });
    /* The inside, on its own material - see summit-art's chapelStone.
       Still solid: the piers and the wall shafts are what stop the
       player walking out through the aisle. */
    if (cath.interior) {
      batch.add("summit", "chapelStone", cath.interior,
        { tag: "chapel-interior", collisionSolid: true });
    }
    /* The ice glazing goes to `emissive`, which is UNLIT. That is the
       whole point of glazing a rose with ice rather than glass: it
       transmits rather than reflects, and a lit surface on the south
       front under a 7-degree key renders as a grey disc. `castShadow`
       is off for the same reason - an unlit pane casting a shadow
       puts a black disc on the floor exactly where the art
       direction's coloured pool is supposed to land. */
    if (cath.glass) {
      batch.add("summit", "emissive", cath.glass, {
        tag: "ice", collisionSolid: false, noCollide: true, castShadow: false,
      });
    }
    /* `collisionSolid: false`, WHICH THE BUILDER'S OWN `bins` TABLE
       ASKS FOR and this call was not passing.

       The bronze slot is the two door leaves, the reliquary casket,
       the sanctuary lamp and the spire cross - and the leaves are
       modelled SWUNG OPEN, so their lowest cross-rail hangs in the
       doorway a metre above the chapel floor. Binned solid by the
       batcher's default it is a knee-high bar across the entrance:
       measured, the player stopped dead on it at z = 28.5, and the
       only reason the level ever seemed to let anyone in was that
       the floor used to sit 34 cm higher than the building it
       belonged to, which put the rail inside the 0.82 m step. */
    if (cath.bronze) {
      batch.add("summit", "bronze", cath.bronze,
        { tag: "cath-bronze", collisionSolid: false, noCollide: true });
    }
    if (CX.drift) {
      batch.add("summit", "powder", CX.drift, {
        tag: "drift", collisionSolid: false, noCollide: true,
      });
    }
    /* The interior's two emitters, published by the building and
       lifted to the parvis here. Neither costs a point light - the
       nine braziers below have spent nine of the level's twelve and
       the fumarole wants the other three. `shaft` is diverted into
       `buildShafts` by vfx.js:1174; `fire` is a PLUME_PRESETS kind. */
    for (const e of CX.emitters || []) {
      emitters.push({ ...e, y: e.y + BASE_Y });
    }

    /* --- ICICLE FRINGES, off the building's REAL edges ---

       `extras.eaves` is nine roof drip-edge polylines and
       `extras.ledges` is twenty-five secondary ledges, both handed
       back in world coordinates by the builder that cut them. They
       are not hung inside the cathedral because the density is the
       WORLD's call and it is a real cost: at the structure probe's
       settings these thirty-four runs came to 50,120 triangles,
       nearly as much as the whole building.

       So they are hung at two densities. The eaves are what you
       stand under on the parvis and get a proper curtain; the
       ledges are the three course rings (150 m+ each), the four
       gable rake copings, the tower cornice and fourteen buttress
       set-offs, and at parvis viewing distance those are a tone
       along an edge rather than a row of objects - so they are
       sub-sampled to every second run at 1.9 m spacing and half the
       length. Measured cost of the two calls together is under
       10k triangles against the 50k the naive version cost.

       EXPOSURE IS THE WIND, not a constant. An icicle grows where
       meltwater runs and freezes, and on this mountain the lee side
       is where the snow sits and the windward side is scoured bare,
       so the long fringes hang downwind. That is also the second
       restatement of the wind bearing on this building, after the
       rime, and the two agreeing is what sells it. */
    const eaveExposure = (x, y, z) => {
      const d = Math.hypot(x, z) || 1;
      return 0.42 + 0.58 * clamp01((x / d) * DOWNWIND[0] + (z / d) * DOWNWIND[1] + 0.55);
    };
    const eaveRuns = (CX.eaves || []).map((run) => run.map((p) => [p[0], p[1] + BASE_Y, p[2]]));
    const ledgeRuns = everyNth(CX.ledges || [], 3)
      .map((run) => run.map((p) => [p[0], p[1] + BASE_Y, p[2]]));
    hangFringe("summit", eaveRuns, {
      spacing: 0.52, length: 1.35, lengthVary: 0.68, radius: 0.062,
      max: 220, lean: 0.14, seed: 0xea7e5, tag: "eave-ice", exposure: eaveExposure,
    });
    hangFringe("summit", ledgeRuns, {
      spacing: 2.8, length: 0.62, lengthVary: 0.55, radius: 0.045,
      max: 52, lean: 0.14, seed: 0x1ed6e, tag: "ledge-ice", exposure: eaveExposure,
    });

    /* --- THE FORTY STEPS, sited against the building's real porch ---

       They were authored against the OLD massing - `z = L/2 + 6`,
       from a nave whose front wall was at z = 27 - and after the
       cathedral landed they drove straight through the portal: the
       top four treads stood inside the porch and the flight climbed
       out of the doorway. Visible in `front.png` in the structures
       probe and in `summit-parvis` here.

       So every number is read off `extras`. The flight starts at
       the frontispiece's own outer face (`porchAABB.max[2]`), it is
       centred on the door and wider than its clear opening, and the
       top tread lands at `doorY` - which is the threshold the door
       leaves were measured against, not an assumed floor level. */
    const PORCH_Z = CX.porchAABB.max[2];
    const STEP_N = 40;
    const STEP_GO = 0.66;
    /* Wider than the doorway by a comfortable margin on both sides.
       `door.clear` is MEASURED off the leaf swing angles by the
       builder rather than asserted, so it is the honest width of the
       opening; a flight the same width as the clear opening reads as
       a ramp into a slot. */
    const STEP_W = Math.max(CX.door.width + 6.4, 10.4);
    const stepParts = [];
    for (let i = 0; i < STEP_N; i += 1) {
      /* Counted DOWN from the threshold rather than up from the
         parvis. The one number that has to be exact is the top one -
         a flight whose last tread is 60 mm proud of its own doorway
         is a trip you can see from across the parvis - and counting
         down pins it by construction. */
      const s = kit.slab(STEP_W - i * 0.06, STEP_RISE + 0.10, STEP_GO + 0.09, 0.03);
      s.translate(0, CX.doorY - (i + 1) * STEP_RISE - 0.10, PORCH_Z + 0.5 + i * STEP_GO);
      stepParts.push(s);
    }
    /* Two cheek walls. Forty free-standing treads on an open parvis
       are a stack of paving slabs; the cheeks are what make it a
       stair, and they are also what stops the flight reading as a
       ramp when the drift fills the risers. */
    for (const sgn of [-1, 1]) {
      const zA = PORCH_Z + 0.3;
      const zB = PORCH_Z + 0.5 + STEP_N * STEP_GO;
      const top = CX.doorY + 0.55;
      const bot = CX.doorY - FLIGHT_RISE;
      /* `ribbonSolid(topPts, botPts, depth)` builds in (x, y) and
         extrudes along z, so the RUN axis goes in as the first
         component and the finished ribbon is turned a quarter turn
         about y to lie along the level's z. Getting the sign of that
         rotation wrong swaps the two cheeks, which is invisible on a
         symmetrical flight and wrong the moment the treads taper -
         and they do taper, by 60 mm a step. */
      const cheek = kit.ribbonSolid(
        [[zA, top], [zB, bot + 0.62]],
        [[zA, bot - 0.9], [zB, bot - 0.9]],
        0.62,
      );
      kit.transform(cheek, { rot: [0, -Math.PI / 2, 0] });
      cheek.translate(sgn * (STEP_W / 2 + 0.24), 0, 0);
      stepParts.push(cheek);
    }
    /* --- THE STRINGER, AND WHY THE STAIRS DID NOT WORK -----------

       Every tread here is added with collision on, and not one of
       them is in the collision raster. `collide.js` discards any
       triangle whose top stands less than 0.75 m above the ground it
       covers - "a 4cm floor slab is a surface, not a wall", which is
       correct, and which a 145 mm ceremonial riser fails forty times
       over.

       The result is the flight reads perfectly and does nothing: the
       player walks at parvis level straight through the treads and
       stops against the 5.8 m podium. A player reported exactly that
       - "the stairs on the cathedral is not working and you can not
       enter the cathedral".

       A real stair has a solid mass under its treads, and that mass
       is what a rasteriser can see. This is that mass: a wedge from
       the parvis up to the threshold, inset behind the tread noses so
       the steps still read as steps. Its top face is the 22% ramp the
       flight already describes, so the player climbs it at the same
       grade they appear to be climbing. */
    {
      const runLen = 40 * STEP_GO;
      const z0 = PORCH_Z + 0.5;
      const z1 = z0 + runLen;
      const yTop = CX.doorY - 0.10;
      const yBot = CX.doorY - FLIGHT_RISE - 0.10;
      const hw = (STEP_W - 0.34) / 2;
      const pos = [];
      const idx = [];
      const push = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
      /* Six corners: a wedge, closed. */
      const a = push(-hw, yTop, z0), b2 = push(hw, yTop, z0);
      const c = push(-hw, yBot, z1), d = push(hw, yBot, z1);
      const e = push(-hw, yBot - 1.2, z0), f = push(hw, yBot - 1.2, z0);
      const tri = (i, j, k) => idx.push(i, j, k);
      tri(a, c, b2); tri(b2, c, d);           // the ramp
      tri(a, e, c); tri(c, e, e);             // left side (degenerate guard below)
      tri(b2, d, f); tri(d, f, f);
      tri(a, b2, e); tri(b2, f, e);           // riser at the foot
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g2.setIndex(idx);
      g2.computeVertexNormals();
      const cleaned = cleanGeometry(THREE, g2) || g2;
      const painted = rimeProp(cleaned, {
        ramp: GRANITE_RAMP, feathers: 0.0,
        min: yBot - 1.2, max: yTop,
        rime: 0.30, threshold: 0.14, normalWeight: 0.34, jitter: 0.05,
      });
      painted.translate(0, BASE_Y, 0);
      /* The stringer is scenery, not an obstacle. The player's own
         walkability test reads `groundY`, which carries terrain and
         authored surfaces and never consults a solid's top face - so
         a stringer in the obstacle raster is a 5.8 m wall you cannot
         climb no matter how gentle its ramp looks. Hand the ramp to
         `walkSurfaceAt` (the podium below does the same) and keep the
         geometry out of the raster entirely. */
      batch.add("summit", "granite", painted, { tag: "stair-stringer", collisionSolid: false, noCollide: true });
      summitStair = { hw, z0, z1, yTop: yTop + BASE_Y, yBot: yBot + BASE_Y };
    }

    let steps = mergeGeometries(THREE, stepParts);
    steps = rimeProp(steps, {
      ramp: GRANITE_RAMP, feathers: 0.09,
      min: CX.doorY - PODIUM - 1.0, max: CX.doorY + 1.0,
      rime: 0.40, threshold: 0.10, bias: 0.16, normalWeight: 0.46, jitter: 0.05,
    });
    steps.translate(0, BASE_Y, 0);
    batch.add("summit", "granite", steps, { tag: "steps", collisionSolid: true });

    /* ============================================================
       THE GREAT CROSS OF THE NINTH ASCENT

       One monument, on the west shoulder, taller than the building
       it stands beside.

       WHY IT IS ALLOWED TO BE BIGGER THAN THE CATHEDRAL, when this
       function's own header says building a bigger chapel would make
       the mountain smaller. Those are not the same claim. A larger
       BUILDING competes with the peak for mass and wins, because
       mass is what a mountain is made of; the eye compares volumes
       and the summit loses. A cross is a LINE. It has no volume to
       speak of - eighty-two metres of it is a thirty-metre-square
       footing and two crossed spars - so it does not take bulk off
       the mountain, it puts a vertical accent on it, which is
       exactly what a peak already is. It is also the whole point:
       the order's mark has to be the thing you see from the valley
       floor, at 452m, 4.6km out, before the chapel behind it has
       resolved into anything but a lump.

       THE SIZE IS DERIVED, NOT PICKED. The cathedral's crossing
       spire tops out at 520.2m - measured, not authored here - which
       is 68.2m above the parvis. Eighty-two metres puts the cross
       fourteen metres over it: enough that the two never read as the
       same height from any bearing, not so much that the building
       becomes its plinth.

       THE FOOTING IS THE CONSTRAINT AND IT IS MEASURED. The model's
       base is square in plan at 0.187 of its height each way, so an
       82m cross stands on a 30.7m square. That does not fit on the
       cliff shoulder outside the parapet - the ground there falls
       17m across thirty metres, which is a footing with half of it
       in the air - so it stands on the flat of the parvis, hard
       against the west parapet, with the drop starting five metres
       behind it. Turned a quarter so the arms run north-south: the
       arms reach 21.8m and pointed east they would be inside the
       chapel's transept.
       ============================================================ */
    const GREAT = {
      /* x IS SET BY THE PARAPET, not by taste. The footing is 15.35m
         half-width and the arms reach 21.8m, so the far ground
         corner sits at hypot(|x| + 15.35, 21.8) from the pad centre
         and the parapet's inner face is at 74.75. At -54 that corner
         is 72.7 - two metres of daylight - and the monument's
         outboard face still stands 5.6m short of the wall with the
         drop starting five metres beyond it. At -58, which this
         started at, the corner was 0.15m inside the parapet: it
         would have rendered as a monument growing out of a wall and
         nothing would have failed. */
      x: -54, z: 0,
      height: 82,
      /* Arms north-south. See above - and it also presents the wheel
         face to the great flight and to the basecamp gate, which are
         the two places anyone looks at it from. */
      yaw: Math.PI / 2,
    };
    /* The shrine sits in the cross's WIND SHADOW, and that is why it
       is on this side rather than the other. SUMMIT_WIND travels
       toward (0.927, 0.375); a candle on the windward face of an
       eighty-metre monument at 31 m/s is not a candle. */
    const SHRINE = {
      x: GREAT.x + SUMMIT_WIND.x * 26,
      z: GREAT.z + SUMMIT_WIND.z * 26,
    };
    /* The shrine is authored with local +X pointing AT the cross,
       which - because SHRINE is GREAT plus the wind vector - is also
       exactly WINDWARD. Every lean and every run-off in the block
       below is therefore toward local -X, and that is not a
       coincidence to be rediscovered later: the cross is the
       windbreak, so downwind is away from it. */
    const SHRINE_FACE = Math.atan2(GREAT.z - SHRINE.z, GREAT.x - SHRINE.x);
    const shrineLocal = (ox, oz) => [
      SHRINE.x + Math.cos(SHRINE_FACE) * ox - Math.sin(SHRINE_FACE) * oz,
      SHRINE.z + Math.sin(SHRINE_FACE) * ox + Math.cos(SHRINE_FACE) * oz,
    ];
    /* OFF THE DAIS, not on it. Sited at the platform's downwind
       corner: standing on the shrine it hid the altar behind its own
       flame sprite from every approach, and a brazier bedded 30cm
       into a stone platform is a bowl growing out of the floor. */
    const SHRINE_BRAZIER = shrineLocal(-8.4, 7.0);

    /* --- the nine braziers ---
       THE ONLY WARM LIGHT ABOVE 400m, and the reason you can tell
       from the basecamp gate that someone is still up there.

       NINE LIGHTS AND NO MORE. world.js caps the level at twelve
       point lights, and the fumarole vents want the other three.
       Each brazier is a real light AND an emitter; nothing else on
       this mountain gets one.

       ONE OF THE NINE HAS MOVED. Brazier 4 of the ring sits at
       (-66, 0), which the great cross's footing now occupies to
       within a metre - so rather than delete it and leave the ring
       nine-eighths lit, or add a tenth light and break a budget this
       file states twice, it is re-sited at the foot of the cross.
       That is also the answer to "how is the shrine lit": it is lit
       by the brazier the community moved to it, which is what would
       have happened. The ring keeps its count; the parvis keeps its
       twelve. */
    const MOVED_BRAZIER = 4;
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * TAU + 0.35;
      const r = S.padR - 12;
      const x = i === MOVED_BRAZIER ? SHRINE_BRAZIER[0] : Math.cos(a) * r;
      const z = i === MOVED_BRAZIER ? SHRINE_BRAZIER[1] : Math.sin(a) * r;

      const bowl = kit.ringSolid([
        { y: 0, r: 0.34, sides: 8, phase: 0 },
        { y: 1.5, r: 0.28, sides: 8, phase: 0 },
        { y: 1.85, r: 0.86, sides: 8, phase: 0 },
        { y: 2.35, r: 0.98, sides: 8, phase: 0 },
      ], { capTop: false, capBottom: true });
      paintByHeight(THREE, bowl, BELL_RAMP, { lo: 0.1, hi: 0.95, jitter: 0.05 });
      bowl.translate(x, Y, z);
      batch.add("summit", "bronze", bowl, { tag: "brazier", collisionSolid: true });

      /* A LIGHT CARRIES ITS SPEC. vfx.js walks `world.lights` and
         reads `light.userData.spec.flicker` and
         `light.userData.baseIntensity` with no guard at all - a
         light without them takes the first frame down. world.js
         sets both at world.js:4965-4966 and that contract is not
         written anywhere else, so it is restated here.

         `flicker` is what makes a flame a flame: nine steady point
         lights on a summit read as electric. */
      const spec = {
        colour: "#ffb257", intensity: 2.6, distance: 46,
        x, y: Y + 2.6, z, flicker: 1.0,
      };
      const light = new THREE.PointLight(new THREE.Color(spec.colour), spec.intensity, spec.distance, 2);
      light.position.set(spec.x, spec.y, spec.z);
      light.userData.spec = spec;
      light.userData.baseIntensity = spec.intensity;
      /* Scene-parented at build, exactly like every other light in
         the game. A light that JOINS the scene later recompiles
         every lit program in it - a measured 198ms freeze. */
      root.add(light);
      lightObjects.push(light);
      emitters.push({ kind: "fire", x, y: Y + 2.4, z, scale: 0.9 });
    }

    /* --- the monument and the shrine at its foot ---------------- */
    {
      await crossAssetReady;
      const srng = makeRng(0x9c2055);

      placeWheelCross({
        key: "summit-great-cross",
        name: "summit-great-cross",
        station: "summit",
        tag: "great-cross",
        bin: "summit-cross",
        x: GREAT.x, z: GREAT.z,
        yaw: GREAT.yaw,
        tiltX: 0, tiltZ: 0,
        height: GREAT.height,
        variant: "great",
        /* Bedded barely at all. The parvis is a levelled pad that
           the summit wind keeps scoured; the monument stands on the
           rock the pad is cut into, not in a drift. */
        bedFactor: 0.35, maxBed: 0.9,
        /* THE COLLAR IS SIZED SEPARATELY FROM THE FOOTING, and it
           has to be. `snowCap` runs its lee tail out to 2.2 footprint
           radii, so the real 15.4m footing would grow a drift skirt
           fifty metres across on a flat pad - which is precisely the
           "flat untextured white hexagon, an obvious unshipped
           plane" that this file's own notes record losing a frame
           to. The seat is unchanged either way: the pad is dead
           level, so measuring the support over a 9.5m disc and over
           a 15.4m one gives the same number. */
        footR: 9.5,
      });

      /* ----------------------------------------------------------
         THE SHRINE

         The evidence that anyone still climbs up here. It is the
         one place on the mountain with wax on the ground, and it
         reads at three ranges: the brazier and the flame glow from
         the basecamp gate, the flag run and the dais from the
         parvis, and the individual guttered stubs from two metres.

         Everything is authored in the shrine's own local frame with
         y = 0 at the parvis and +X pointing AT the cross, then
         turned and placed once - the same order the stations use,
         and the reason the candles end up in rows facing the
         monument rather than facing north.
         ---------------------------------------------------------- */
      const toCross = SHRINE_FACE;
      const stone = [];
      const bronze = [];
      const waxG = [];
      const flameG = [];

      /* The dais: two swept courses, the upper one short of the
         lower so it has a tread to stand on. Every level in this
         block is derived from these four numbers rather than typed
         in twice - the first draft had the altar table floating
         19cm inside the altar block and the candles inside the
         table, because six y values were written out by hand. */
      const COURSE_0 = 0.42;
      const COURSE_1 = 0.34;
      const DAIS_0 = COURSE_0 - 0.14;                 // lower tread
      const DAIS_1 = DAIS_0 + COURSE_1;               // upper tread
      const ALTAR_TOP = DAIS_1 + 0.95;
      const TABLE_TOP = ALTAR_TOP + 0.18;
      stone.push(kit.slab(11.0, COURSE_0, 15.0, 0.07).translate(0, -0.14, 0));
      stone.push(kit.slab(7.4, COURSE_1, 10.6, 0.06).translate(-0.6, DAIS_0, 0));

      /* The altar, at the cross-facing edge, with its back to the
         monument so an offering is laid facing it. */
      stone.push(kit.slab(1.50, 0.95, 3.40, 0.06).translate(2.35, DAIS_1, 0));
      stone.push(kit.slab(1.95, 0.18, 3.90, 0.04).translate(2.35, ALTAR_TOP, 0));

      /* Nine candle stands, one for each ascent, in an arc that
         opens toward the cross. Nine is the level's number and it is
         the count the braziers on the ring already use. */
      const addCluster = (cx, cy, cz, count, spread) => {
        for (let k = 0; k < count; k += 1) {
          const a2 = srng() * TAU;
          const rr = Math.pow(srng(), 0.6) * spread;
          const kx = cx + Math.cos(a2) * rr;
          const kz = cz + Math.sin(a2) * rr;
          const ch = srng.range(0.16, 0.46);
          const cr = srng.range(0.035, 0.062);
          const stub = kit.prism({ h: ch, rBottom: cr * 1.15, rTop: cr, sides: 5 });
          /* Guttered, not moulded. A candle that has burned in a
             31 m/s wind leans downwind and runs down that side; a
             row of upright cylinders reads as a fence of pegs. */
          kit.transform(stub, { rot: [srng.jit(0.10), 0, 0.10 + srng.jit(0.10)] });
          stub.translate(kx, cy, kz);
          waxG.push(stub);
          const pool = kit.prism({ h: 0.035, rBottom: cr * 2.6, rTop: cr * 1.7, sides: 6 });
          // Run-off pools downwind, which in this frame is local -X.
          pool.translate(kx - cr * 1.2, cy, kz);
          waxG.push(pool);
          const fl = kit.prism({ h: srng.range(0.10, 0.19), rBottom: cr * 0.9, rTop: 0.008, sides: 5 });
          /* The flame leans with the wind too, and it is the only
             part of the shrine that is UNLIT - see the ice glazing
             above for why an emissive here and a lit surface there
             are not interchangeable. */
          kit.transform(fl, { rot: [0, 0, 0.34] });
          fl.translate(kx, cy + ch, kz);
          flameG.push(fl);
        }
      };

      /* A RANK IN FRONT OF THE ALTAR, not a ring around it. The
         first pass put the arc's centre ON the altar block, so five
         of the nine stands stood inside it. They belong between the
         altar and whoever is facing it, bowed very slightly so the
         row is not a fence. */
      for (let i = 0; i < 9; i += 1) {
        const t = (i / 8) - 0.5;
        const px = 0.10 - (1 - Math.cos(t * 1.6)) * 0.9;
        const pz = t * 7.2;
        const ph = srng.range(0.72, 1.06);
        stone.push(kit.prism({ h: ph, rBottom: 0.30, rTop: 0.25, sides: 6 })
          .translate(px, DAIS_1, pz));
        const bowl = kit.ringSolid([
          { y: 0, r: 0.24, sides: 8 },
          { y: 0.16, r: 0.40, sides: 8, phase: 0.2 },
          { y: 0.30, r: 0.44, sides: 8, phase: 0.3 },
        ], { capTop: false, capBottom: true });
        bowl.translate(px, DAIS_1 + ph, pz);
        bronze.push(bowl);
        addCluster(px, DAIS_1 + ph + 0.16, pz, 4 + srng.int(0, 3), 0.26);
      }

      // Two censers on the altar table, and the offerings on it.
      for (const sgn of [-1, 1]) {
        const c = kit.ringSolid([
          { y: 0, r: 0.16, sides: 6 },
          { y: 0.22, r: 0.30, sides: 6, phase: 0.25 },
          { y: 0.34, r: 0.26, sides: 6, phase: 0.4 },
        ], { capTop: false, capBottom: true });
        c.translate(2.35, TABLE_TOP, sgn * 1.30);
        bronze.push(c);
      }
      addCluster(2.35, TABLE_TOP, 0, 11, 0.95);

      // Guttered stubs left on the steps by whoever could not reach
      // a stand, which is what actually happens at a shrine.
      addCluster(-1.2, DAIS_1, 4.4, 7, 1.0);
      addCluster(-1.2, DAIS_1, -4.4, 6, 1.0);
      addCluster(-3.4, DAIS_0, 0, 6, 1.6);
      addCluster(0.4, DAIS_0, 6.4, 5, 1.2);
      addCluster(0.4, DAIS_0, -6.4, 5, 1.2);

      /* PAINTED BEFORE THE TURN, merged before the turn, and seated
         once. `paintByHeight` reads a WORLD normal, so a surface
         painted after it has been rotated has its facing term baked
         for the wrong bearing - the same rule Vesper's fallen bell
         and this file's cloister arcade both record.

         Only the stone goes through `place`, because only the stone
         has a footprint worth bedding and drifting. The bronze, the
         wax and the flames are laid on the seat it comes back with:
         four merged geometries pinned to one number, so nothing in
         the shrine can float independently of the dais it stands
         on. */
      const shrineY = (() => {
        const merged = [];
        /* RIMED, over the object's OWN bounding box - which is what
           `paintRimed` does when `min`/`max` are left off, and the
           reason they are left off. The first pass handed a 1.9m
           dais an absolute 0..1.6 band via `paintByHeight`, which
           put every horizontal tread - the surfaces anyone actually
           sees - in the bottom fifth of the ramp, and the whole
           shrine rendered as a black rectangle on a white pad.
           `normalWeight` is up at 0.40 for the same reason it is on
           the cathedral's west front: under a 7-degree key, FACING
           is what separates the treads from the risers, and height
           over a two-metre object separates nothing. */
        const sg = rimeProp(kit.merge(stone), {
          ramp: GRANITE_RAMP, feathers: 0.10,
          rime: 0.85, threshold: 0.06, bias: 0.16,
          normalWeight: 0.40, jitter: 0.08,
        });
        if (bronze.length) {
          const bg = kit.merge(bronze);
          paintByHeight(THREE, bg, BELL_RAMP, { lo: 0.15, hi: 0.95, jitter: 0.07 });
          merged.push([bg, "bronze", { tag: "shrine-bronze" }]);
        }
        if (waxG.length) {
          const wg = kit.merge(waxG);
          paintFlat(THREE, wg, "#efe2c4", 0.10);
          merged.push([wg, "bone", { tag: "shrine-wax" }]);
        }
        if (flameG.length) {
          const fg = kit.merge(flameG);
          paintFlat(THREE, fg, "#ffb04c", 0.16);
          merged.push([fg, "emissive", {
            tag: "shrine-flame", castShadow: false, receiveShadow: false,
          }]);
        }

        kit.transform(sg, { rot: [0, -toCross, 0] });
        /* `load: 0.26`, and the dais is the reason the knob exists to
           be turned down. `snowCap` runs its lee rise at the full
           ambient depth, which on an 11x15m platform came out as a
           metre-high skirt that buried the lower course and every
           candle on it - measured, and it is exactly the "flat
           untextured white hexagon" this file's powder note records
           losing a frame to. A quarter load leaves a scoured moat on
           the windward side and a thin tail on the lee, which is
           what a swept, tended platform in a 31 m/s wind looks
           like, and the stone still reads. */
        const extras = place("summit-shrine", "granite", sg, SHRINE.x, SHRINE.z, {
          tag: "shrine", bedFactor: 0.12, maxBed: 0.25, capBins: 14,
          load: 0.26, collisionSolid: false, noCollide: true,
        });
        const seat = seatOf(extras, SHRINE.x, SHRINE.z);
        for (const [geo, mat, opts] of merged) {
          kit.transform(geo, { rot: [0, -toCross, 0] });
          geo.translate(SHRINE.x, seat, SHRINE.z);
          batch.add("summit-shrine", mat, geo,
            { collisionSolid: false, noCollide: true, ...opts });
        }
        return seat;
      })();

      /* Votive cairns, on the open pad flanking the monument where
         they are read against the sky rather than against the dais.

         SITED, NOT SCATTERED, and this is the one place in the block
         where that matters. A radial scatter around the shrine puts
         cairns downwind of it - which is straight at the chapel's
         west wall, sixteen metres away - and a cairn a metre off a
         cathedral is a rock that fell off it. Every site here clears
         the footing in x, the chapel in x, and the parapet in r. */
      for (const [cx, cz] of [[-46, 26], [-52, 33], [-44, -25], [-51, -32], [-36, -18]]) {
        const c = kit.cairn(srng, {
          h: srng.range(1.1, 1.9), r: srng.range(0.42, 0.66), layers: 6,
        });
        paintByHeight(THREE, c, GRANITE_RAMP, { lo: 0.1, hi: 0.9, jitter: 0.10 });
        place("summit-shrine", "granite", c, cx, cz, {
          tag: "shrine-cairn", bedFactor: 0.5, maxBed: 0.6, capBins: 10,
          collisionSolid: false, noCollide: true,
        });
      }

      /* Two flag runs, off the monument's shaft to a post on either
         flank. They are the only moving thing up here and they are
         what says the place is TENDED rather than abandoned - the
         same job the Via Sacra's runs do, at the end of the road.

         The high anchor is deliberately a few metres INSIDE the
         shaft. A cord that begins in open air beside a monument
         reads as a bug; one that emerges from it reads as tied to
         it, and nothing can see the two metres in between. */
      for (const side of [1, -1]) {
        const px = -34;
        const pz = side * 30;
        const post = kit.votiveMarker(srng, { h: 3.4, r: 0.20, sides: 6 });
        const pg = post && post.geo ? post.geo : post;
        paintByHeight(THREE, pg, BARK_RAMP, { lo: 0.1, hi: 0.9, jitter: 0.10 });
        const pex = place("summit-shrine", "bark", pg, px, pz, {
          tag: "shrine-post", bedFactor: 0.5, maxBed: 0.7, capBins: 10,
          collisionSolid: false, noCollide: true,
        });
        const run = kit.prayerFlagRun([
          [GREAT.x, Y + 26, GREAT.z + side * 5],
          [px, seatOf(pex, px, pz) + 3.1, pz],
        ], { flags: 16, seed: 0x9c20f1 + side, flagW: 0.52, flagH: 0.66 });
        if (run.geo && run.geo.attributes && run.geo.attributes.position.count) {
          batch.add("summit-shrine", "iron", run.geo,
            { tag: "shrine-cord", collisionSolid: false, noCollide: true });
        }
        for (const spec of (run.extras && run.extras.flagSpecs) || []) {
          if (spec && spec.geo && spec.geo.attributes && spec.geo.attributes.wave) {
            banners.push(spec);
          }
        }
      }
      /* Two small flame emitters over the candle mass. The wax and
         its flames are static geometry - forty guttered stubs is a
         better picture than four sprites - but a shrine with no
         MOVEMENT in it is a diorama, and at two metres the eye reads
         the flicker before it reads the candles. Small scale: these
         are candles, not the brazier standing beside them. */
      for (const [ox, oz, sc] of [[2.15, 0, 0.30], [-0.4, 0, 0.34]]) {
        const [ex, ez] = shrineLocal(ox, oz);
        emitters.push({ kind: "fire", x: ex, y: shrineY + 1.35, z: ez, scale: sc });
      }

      poi("summit-cross", "The Great Cross", GREAT.x, GREAT.z);
    }

    poi("summit", S.name, 0, 0);
    poi("summit-parvis", "The Parvis", 0, S.padR - 24);
    stationSites.push({ id: "summit", x: 0, z: 0, padR: S.padR, padY: Y });
    summitBase = BASE_Y;
    await progress("Raising the Cathedral of the Ninth Ascent");
  }

  /* ------------------------------------------------------------
     ASSEMBLY
     ------------------------------------------------------------ */

  const roadStats = await buildViaSacra();
  await buildBasecamp();
  await buildTarn();
  await buildBowl();
  await buildGlacier();
  await buildRimeForest();
  await buildFumarole();
  await buildCascade();
  await buildBellTerrace();

  /* ------------------------------------------------------------
     GROUND LITTER

     THE ANSWER TO "THE BOTTOM THIRD IS BARE", and it is scatter
     rather than shader.

     Two blind reviewers called the near field of our open-ground
     frames empty, in nine frames out of twenty-four between them.
     The first instinct was to push the sastrugi term that carries
     it, and that was measured: toggling its amplitude at runtime on
     a basecamp eye-level frame, local detail in the bottom third ran
     0.67 with the term off, 1.10 as authored and 2.43 at x4, against
     2.4-4.1 for Vesper's own open-ground eye frames. So the term was
     the right carrier and under-authored - but taken to x3 the
     picture became regular parallel banding, because the finest
     train's 1.05m wavelength projects into wide horizontal bands at
     any eye-level angle and no amplitude makes a periodic function
     stop being periodic.

     Vesper does not carry its near field on ripples alone either.
     It has rock, bone litter, plate debris and drum scatter over
     every district, and that is what its bottom third is full of.
     This is the same idea in this world's vocabulary: wind-carved
     snow blocks, frost-shattered rubble and calved ice, thin
     everywhere and thicker where the ground gives a reason.

     DENSITY IS BY REASON, NOT UNIFORM. A uniform scatter over 4 km2
     is either invisible or a carpet. Litter collects where wind
     drops it and where something sheds it: in the lee of ridges
     (curvature), on the flanks under cliff bands (slope), along the
     road, and around the stations. Open flats keep a thin dusting so
     that no frame is empty, and the arena floors themselves stay
     clear - an arena is a floor.

     BATCHED BY CHUNK, not globally. One merged mesh for 4000 rocks
     spans the map and never frustum-culls; binning on a 256m grid
     keeps each bounding sphere local. That is the same rule the
     station batching follows and the same reason.
     ------------------------------------------------------------ */

  /* ================================================================
     SET PIECES

     Terrain plus sky is not a level. Asked what the desert level has
     that this one does not, a blind reviewer counted it off the
     sheets: "the desert frames average two to three authored objects
     at different distances; the snow frames average under one, and
     two of them have zero." The one snow frame that has ever won a
     pair won it on a stand of dead conifers - black verticals, a
     receding line, and long shadows off them.

     So both of these are built to do that job specifically, and
     neither is another building: repeated verticals that recede, and
     a line the eye can follow into the distance.
     ================================================================ */

  /** THE VIGIL LINE - a dead cableway climbing the mountain.
   *
   *  Ten lattice pylons on one bearing from the valley to the shoulder,
   *  with catenary cables between them and some spans down. It is the
   *  cheapest possible answer to "no lead-in line and no scale
   *  reference": a tower is a known size, ten of them receding tells
   *  you how far away the mountain is, and the cable draws the eye up
   *  the slope whether or not the player ever walks it.
   *
   *  Sited off the Via Sacra's bearing by about 17 degrees so the two
   *  read as separate things from the arrival frames rather than as
   *  one corridor.
   */
  async function buildVigilLine() {
    /* Local, because the module's own `polar` is a `const` declared a
       couple of hundred lines below this and the world build reaches
       here first - the same temporal dead zone that killed PAD_FEATHER
       when its initialiser called a function declared under it. */
    const pol = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
    const rng = makeRng(0x71617e);
    const bs = STATIONS.basecamp;
    const a0 = Math.atan2(bs.z, bs.x) + 0.30;
    const N_PYLON = 10;
    const tops = [];

    for (let i = 0; i < N_PYLON; i += 1) {
      const t = i / (N_PYLON - 1);
      const r = lerp(742, 258, t);
      const a = a0 + Math.sin(t * 2.1) * 0.035;      // the line is not ruler-straight
      const [x, z] = pol(a, r);
      const gy = H(x, z);
      const n = N(x, z);
      const slope = Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI;

      /* Taller low down where the span has further to reach over the
         valley floor, shorter as the ground rises to meet the line. */
      const h = lerp(17.5, 10.5, t) * rng.range(0.92, 1.08);
      const legR = h * 0.115;

      /* Four splayed legs and three crossarms. A lattice tower read at
         200m is a silhouette of exactly this: a taper and a rhythm of
         horizontals. Anything finer is triangles nobody resolves. */
      const parts = [];
      for (let k = 0; k < 4; k += 1) {
        const la = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const leg = kit.prism({ h, rBottom: 0.30, rTop: 0.17, sides: 4 });
        /* `prism` spans y = 0..h - its base IS the origin, like
           `slab`. Lifting a leg by h*0.5 put its feet half a tower up:
           every pylon on the line stood with the lowest thing on it
           being the first crossarm, at 0.34h. The bedding then seated
           THAT on the ground, so the whole lattice hung 3-5 m clear of
           dead-flat snow (0.2 m of relief under the worst one) and a
           player photographed the crossarm floating over the legs. */
        kit.transform(leg, {
          pos: [Math.cos(la) * legR * 0.5, 0, Math.sin(la) * legR * 0.5],
          rot: [Math.cos(la) * 0.085, 0, -Math.sin(la) * 0.085],
        });
        parts.push(leg);
      }
      for (let k = 0; k < 3; k += 1) {
        const ay = h * (0.34 + k * 0.27);
        const w = legR * lerp(1.5, 0.9, k / 2);
        const arm = kit.slab(w * 2, 0.26, 0.26);
        kit.transform(arm, { pos: [0, ay, 0], rot: [0, (k % 2) * 0.78, 0] });
        parts.push(arm);
        const arm2 = kit.slab(0.26, 0.26, w * 2);
        kit.transform(arm2, { pos: [0, ay, 0], rot: [0, (k % 2) * 0.78, 0] });
        parts.push(arm2);
      }
      /* The sheave head - the one piece of silhouette that says this
         carried something rather than being a pylon for wires. */
      /* slab() is POSITIONAL - slab(w, h, d, bevel). Passing it an
         options object makes every dimension undefined and the whole
         geometry NaN, which three reports as a NaN bounding sphere
         and the level boots to a blank screen. */
      const head = kit.slab(legR * 2.6, 0.7, 0.5);
      kit.transform(head, { pos: [0, h + 0.3, 0] });
      parts.push(head);

      let geo = kit.merge(parts);
      /* Leaning: the line is derelict, and a tower off plumb is worth
         more than a tower with more triangles. The two that lean hard
         are the two the cable is down between. */
      const lean = (i === 4 || i === 5) ? rng.range(0.10, 0.20) : rng.range(0, 0.05);
      kit.transform(geo, { rot: [rng.jit(lean), rng() * 0.4, rng.jit(lean)] });
      geo = paintRimed(geo, BELL_RAMP, {
        rime: 0.72, threshold: 0.08, normalWeight: 0.34, jitter: 0.10,
        min: 0, max: h + 1,
      });

      place("vigil-line", "iron", geo, x, z, {
        tag: "vigil", bedFactor: 0.5, maxBed: 1.2,
        cap: true, capBins: 18, collisionSolid: true,
      });
      tops.push({ x, z, y: gy + h, slope });
    }

    /* ---- the cables ------------------------------------------------
       A catenary, not a straight line, and the sag is what sells the
       weight of the thing. Two spans are down: the cable leaves the
       uphill tower, falls, and ends. */
    for (let i = 0; i < tops.length - 1; i += 1) {
      const a = tops[i];
      const b = tops[i + 1];
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      const broken = (i === 4);
      const SEG = 26;
      const last = broken ? Math.round(SEG * 0.55) : SEG;
      for (const off of [-0.9, 0.9]) {         // a haul rope and a track rope
        const pts = [];
        for (let k = 0; k <= last; k += 1) {
          const t = k / SEG;
          const px = lerp(a.x, b.x, t);
          const pz = lerp(a.z, b.z, t);
          /* Perpendicular offset so the two ropes are not coincident. */
          const dx = (b.x - a.x) / span;
          const dz = (b.z - a.z) / span;
          const sagT = broken
            ? t * t * 5.4                       // a free end falls away
            : 4.0 * t * (1 - t);
          const py = lerp(a.y, b.y, t) - sagT * span * 0.028 - (broken ? 0 : 0);
          pts.push([px + dz * off, py, pz - dx * off]);
        }
        const rope = kit.sweepProfile(pts, () => ([
          [-0.075, -0.075], [0.075, -0.075], [0.075, 0.075], [-0.075, 0.075],
        ]), { capEnds: true });
        paintByHeight(THREE, rope, BELL_RAMP, { lo: 0.2, hi: 0.9, jitter: 0.06 });
        batch.add("vigil-line", "iron", rope, { tag: "vigil-cable", noCollide: true });
      }
    }
    poi("vigil-line", "The Vigil Line", tops[3].x, tops[3].z);
    await progress("Stringing the Vigil Line");
    return { pylons: tops.length };
  }

  /** THE DROWNED PROCESSION - a column of pilgrims the drift took.
   *
   *  Forty figures on a ridge, walking toward the peak, bedded deep
   *  enough that the drift is at their chests and the line of heads is
   *  what you read from a distance. The Tarn already does this trick
   *  with nine figures in ice; this is the long-range version of it,
   *  and it exists because a RECEDING LINE OF EQUAL OBJECTS is the
   *  single strongest scale cue a landscape can carry.
   */
  async function buildProcession() {
    const pol = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
    const rng = makeRng(0x9a0ce55);
    const bell = STATIONS.bell;
    const a0 = Math.atan2(bell.z, bell.x) - 0.42;
    const COUNT = 40;
    let placed = 0;

    for (let i = 0; i < COUNT; i += 1) {
      const t = i / (COUNT - 1);
      const r = lerp(690, 330, t);
      /* A slow lateral wander, plus per-figure jitter: a column of
         people is not a surveyed line and a perfectly straight one
         reads as a fence. */
      const a = a0 + Math.sin(t * 3.3) * 0.045 + rng.jit(0.008);
      const [x, z] = pol(a, r);
      const n = N(x, z);
      if (Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI > 34) continue;

      const h = rng.range(5.4, 7.0);
      const g = kit.statue(rng, {
        h, style: rng.chance(0.5) ? "orant" : "sword",
        plinth: false, broken: rng.range(0, 0.22),
      });
      let geo = g && g.geo ? g.geo : g;
      /* Facing the climb. */
      kit.transform(geo, { rot: [0, -a + Math.PI * 0.5 + rng.jit(0.35), 0] });
      geo = rimeProp(geo, {
        ramp: GRANITE_RAMP, feathers: 0.16, min: 0, max: h,
        rime: 0.86, normalWeight: 0.32, jitter: 0.06,
      });

      place("procession", "granite", geo, x, z, {
        tag: "procession",
        /* Bedded to the chest. This is the whole read, and it is done
           with the bedding rather than by translating the figure down,
           so the drift collar still builds at the real snow line and
           rises against the windward side of each one. */
        bedFactor: 0.95, maxBed: h * rng.range(0.44, 0.62),
        cap: true, capBins: 18, collisionSolid: true, load: 1.25,
      });
      placed += 1;
      if ((placed & 7) === 0) await new Promise((r2) => setTimeout(r2, 0));
    }
    poi("procession", "The Drowned Procession",
      ...pol(a0, 470));
    await progress("Burying the procession");
    return { placed };
  }

  /* ================================================================
     MID-GROUND MASSES

     The gap this fills was measured, not guessed. `buildGroundLitter`
     below places 4200 pieces and 84% of them are between 0.28m and
     1.25m; the biggest is 4.2m. The next thing up in scale is the
     cathedral. So between four metres and a landmark there was
     NOTHING, and that band is exactly the mid-ground - the part of a
     frame that carries depth.

     Four consecutive blind reviews said so in different words: "no
     foreground element, no framing mass, no leading line", "a horizon
     line with a centred figure", "the camera cannot find a shot where
     there is nothing", and finally, asked directly what the other
     level had that this one did not, "set dressing worth framing...
     there is no snow equivalent of the ribcage, the crashed machine,
     or the obelisk field - nor any seracs, crevasses, cornices,
     wind-scoured rock".

     The kit already had all of it. `kit.serac` was called twice in
     the whole world and `kit.pressureRidge` once. This is a placement
     pass, not new geometry.

     Two rules that make it read as landscape rather than as scatter:

       CLUSTERS, NOT SINGLETONS. A lone 12m block in open snow is an
       object; five of them with a size hierarchy are a PLACE, and the
       eye reads the group as one silhouette from far away and as
       depth from inside it. Every anchor brings 2-5 companions.

       DENSEST BETWEEN THE STATIONS. Litter is gated AWAY from pads
       because a fight floor must be clear. That left the ground
       between stations - which is most of the map and all of the
       travel - as the emptiest part of the level. This weights the
       opposite way: nothing inside a pad, peak density in the gaps.
     ================================================================ */
  async function buildOpenGroundMasses() {
    const rng = makeRng(0x5e4ac1);
    const CELL = 256;
    /* A CAP, not a target. The loop below stops when every walkable
       viewpoint can see something in its own mid-ground band, and
       only falls back on this if the ground will not take that many
       clusters. Measured before it was raised: 78 anchors left 11.7%
       of viewpoints with an empty band. */
    const TARGET = 260;                   // anchors; each brings a cluster
    let anchors = 0;
    let pieces = 0;
    let tries = 0;

    /* --- COVERAGE, NOT DENSITY -------------------------------------

       Two placement rules have already been tried here and both were
       density rules: scatter weighted AWAY from the stations (which
       filled the far gaps, where no camera stands), then scatter
       weighted INTO the 20-200m ring around each pad (better, but
       still a probability - it can and did leave whole bearings
       empty). A blind round counting causes put roughly 70% of this
       level's lost frames on bare ground and named the failure
       exactly: the dressing "landed in places, not as a
       distribution".

       A probability cannot promise coverage. This can: sample the
       walkable ground on a grid, count how much readable mass each
       viewpoint can already see in its own mid-ground band, and then
       place each cluster where it does the most good - always at the
       hungriest viewpoint left. The result is a guarantee rather than
       an expectation, and `summit-qa` can measure the same quantity
       the placer optimised.

       40-120m is the band. Nearer than 40 and it is foreground;
       further than 120 and on this level it is usually the mountain
       itself, which every frame already has. */
    const VP_STEP = 72;
    const BAND_IN = 40;
    const BAND_OUT = 120;
    const viewpoints = [];
    for (let vx = -MAP_HALF + 120; vx <= MAP_HALF - 120; vx += VP_STEP) {
      for (let vz = -MAP_HALF + 120; vz <= MAP_HALF - 120; vz += VP_STEP) {
        if (Math.hypot(vx, vz) > MAP_HALF - 120) continue;
        const vn = N(vx, vz);
        if (Math.acos(clamp(vn[1], -1, 1)) * 180 / Math.PI > 38) continue;
        viewpoints.push({ x: vx, z: vz, seen: 0 });
      }
    }
    /* Seeded with what the level already builds: a station's own
       dressing is readable mass, and so are the two set pieces. */
    const seeds = STATION_ORDER.map((id) => ({ x: STATIONS[id].x, z: STATIONS[id].z }));
    for (const v of viewpoints) {
      for (const sd of seeds) {
        const d = Math.hypot(v.x - sd.x, v.z - sd.z);
        if (d >= BAND_IN && d <= BAND_OUT) v.seen += 1;
      }
    }
    const credit = (cx, cz) => {
      for (const v of viewpoints) {
        const d = Math.hypot(v.x - cx, v.z - cz);
        if (d >= BAND_IN && d <= BAND_OUT) v.seen += 1;
      }
    };
    /** The hungriest viewpoint left, with a little noise so the
     *  result is not a lattice. */
    const hungriest = () => {
      let best = null;
      for (const v of viewpoints) {
        const score = v.seen + rng() * 0.9;
        if (!best || score < best.score) best = { v, score };
      }
      return best && best.v;
    };

    while (anchors < TARGET && tries < TARGET * 60) {
      tries += 1;
      const vp = hungriest();
      if (!vp) break;
      /* Somewhere in that viewpoint's own band, on a free bearing. */
      const ba = rng() * Math.PI * 2;
      const bd = BAND_IN + rng() * (BAND_OUT - BAND_IN);
      const ax = vp.x + Math.cos(ba) * bd;
      const az = vp.z + Math.sin(ba) * bd;
      const ar = Math.hypot(ax, az);
      if (ar > MAP_HALF - 120 || ar < 110) continue;

      /* Clear of every pad, and preferring the gaps between them. */
      let nearest = 1e9;
      for (const id of STATION_ORDER) {
        const st = STATIONS[id];
        const d = Math.hypot(ax - st.x, az - st.z);
        if (d < st.padR * 1.15) { nearest = -1; break; }
        nearest = Math.min(nearest, d - st.padR);
      }
      if (nearest < 0) continue;
      /* The margin has to cover the OBJECT'S OWN RADIUS, not just
         its centre: a 15m crag sited 16m from the road still stands
         in it, which is what the first pass at this did. Clusters
         spread to 44m and members reach 15m radius. */
      if (nearRoad(ax, az, 30)) continue;
      /* --- AND THE MID-GROUND IS MEASURED FROM WHERE THE CAMERA IS -

         The first version of this weighted density by `nearest / 260`
         - densest FAR from a station, on the reasoning that the pads
         already have dressing and the gaps between them are the
         emptiest part of the map. That is true of the map and useless
         for the picture, because every camera in the game stands at a
         station. It put the new mass exactly where nothing looks, and
         the review after it still counted half the frames as running
         empty ground to the skyline.

         Mid-ground is 20-200m FROM A VIEWER. So the weight now peaks
         across that band measured from the pad edge and falls away
         both sides: nothing on the fight floor, most of it in the
         ring you actually see over the parapet, and a thinner scatter
         beyond so the gaps are not bare either. */
      /* No probability gate any more - the site was CHOSEN, not
         sampled. All that is left to reject is ground a cluster
         cannot stand on, below. */

      const an = N(ax, az);
      const aSlope = Math.acos(clamp(an[1], -1, 1)) * 180 / Math.PI;
      if (aSlope > 34) continue;          // it would not stand
      const ay = H(ax, az);
      const surf = field.surfaceAt(ax, az);
      const icy = clamp01(surf.blueIce + surf.blackIce) > 0.35 || ay > 250;

      const members = 3 + rng.int(0, 3);
      const spread = rng.range(16, 44);
      for (let m = 0; m < members; m += 1) {
        const a = rng() * Math.PI * 2;
        const rr = m === 0 ? 0 : spread * Math.sqrt(rng());
        const x = ax + Math.cos(a) * rr;
        const z = az + Math.sin(a) * rr;
        if (Math.hypot(x, z) > MAP_HALF - 60) continue;
        if (nearRoad(x, z, 28)) continue;
        const n = N(x, z);
        if (Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI > 40) continue;

        /* A size hierarchy inside the cluster. The anchor is the big
           one; the rest fall away, which is what gives a group a
           readable silhouette instead of a row of equals. */
        const drop = m === 0 ? 1 : rng.range(0.34, 0.78);
        let geo;
        let mat;
        if (icy) {
          const h = rng.range(7, 19) * drop;
          geo = kit.serac(rng, {
            h, w: h * rng.range(0.55, 0.95), d: h * rng.range(0.45, 0.85),
            topple: rng.range(0.08, 0.30), fractures: rng.int(1, 3),
            sink: 0.26, calved: rng.int(2, 4),
            toppleAngle: a + rng.jit(0.7),
          });
          mat = "glacierIce";
        } else {
          const size = rng.range(5.5, 15) * drop;
          geo = kit.crag(rng, {
            height: size * rng.range(0.7, 1.5), radius: size,
            layers: 5, sides: rng.int(6, 9),
            lean: rng.range(0, 0.55), sink: 0.38,
          });
          kit.transform(geo, { rot: [0, rng() * Math.PI * 2, 0] });
          geo = paintRimed(geo, ay > 190 ? GRANITE_RAMP : SCREE_RAMP, {
            rime: 0.5, threshold: 0.10, normalWeight: 0.34, jitter: 0.12,
          });
          mat = ay > 190 ? "granite" : "scree";
        }

        const bin = `mass-${Math.floor((x + MAP_HALF) / CELL)}-${Math.floor((z + MAP_HALF) / CELL)}`;
        place(bin, mat, geo, x, z, {
          tag: "mass",
          /* These DO all get a cap. A 12m block whose foot is a hard
             line against the snow is the "sticker prop" every review
             named, and at this scale the contact is most of the read. */
          bedFactor: 0.62, maxBed: 2.6,
          cap: true, capBins: 20, collisionSolid: true,
        });
        pieces += 1;
      }

      /* A pressure ridge through the flatter ice clusters - a line
         reads differently from a group of blocks, and the level had
         exactly one of them. */
      if (icy && aSlope < 16 && rng.chance(0.45)) {
        const ridge = kit.pressureRidge(rng, {
          length: rng.range(22, 46), height: rng.range(1.8, 3.6),
          plates: 16, thickness: 0.36, tilt: 1.0, embed: 0.5, rubble: 12,
        });
        kit.transform(ridge, { rot: [0, rng() * Math.PI * 2, 0] });
        const bin = `mass-${Math.floor((ax + MAP_HALF) / CELL)}-${Math.floor((az + MAP_HALF) / CELL)}`;
        place(bin, "glacierIce", ridge, ax, az, {
          tag: "mass", bedFactor: 0.7, maxBed: 1.6, cap: true, capBins: 14,
        });
        pieces += 1;
      }

      credit(ax, az);
      anchors += 1;
      /* Done when the guarantee holds: no walkable viewpoint has an
         empty 40-120m band. Checked here rather than in the loop
         condition so it costs one sweep per placement, not two. */
      let anyEmpty = false;
      for (const v of viewpoints) { if (v.seen === 0) { anyEmpty = true; break; } }
      if (!anyEmpty) break;
      await new Promise((r2) => setTimeout(r2, 0));
    }

    /* What the placer achieved, in the same units summit-qa measures. */
    let empty = 0;
    let worst = 1e9;
    for (const v of viewpoints) { if (v.seen === 0) empty += 1; worst = Math.min(worst, v.seen); }
    await progress("Setting the mid-ground");
    return {
      anchors, pieces, tries,
      viewpoints: viewpoints.length,
      emptyBand: empty,
      emptyPct: Number((100 * empty / Math.max(1, viewpoints.length)).toFixed(1)),
      worstSeen: worst,
    };
  }

  /* ================================================================
     ROUTE MARKERS — the human trace

     Composition is the one axis this level is still clearly behind on
     (2.96 against 3.92), and a reviewer scoring both levels pointed at
     the reason from inside the set: "pair-11 is the one snow frame
     carrying authored human traces - survey poles, avalanche fencing,
     strung cable - and it is also one of the three best snow frames".
     Its diagnosis of the losses was blunter: "four are lost purely to
     emptiness, not to shading - no shader fixes an empty frame."

     A line of poles is the cheapest composition device there is. It
     gives repeated verticals at a known height (scale), a line the eye
     follows (a lead-in), thin dark silhouettes against snow (value),
     and the thing a wilderness most conspicuously lacks in every one
     of these frames - evidence that someone came this way before.

     Sited on the coverage rule the other two passes use, but on
     ROUTES rather than points: a run walks from one place toward
     another, following the ground, so it reads as a way rather than
     as a scatter of sticks.
     ================================================================ */
  async function buildRouteMarkers() {
    const rng = makeRng(0x40b7e5);
    const CELL = 256;
    const VP_STEP = 68;
    const SEE_IN = 12;
    const SEE_OUT = 150;

    const viewpoints = [];
    for (let vx = -MAP_HALF + 130; vx <= MAP_HALF - 130; vx += VP_STEP) {
      for (let vz = -MAP_HALF + 130; vz <= MAP_HALF - 130; vz += VP_STEP) {
        if (Math.hypot(vx, vz) > MAP_HALF - 130) continue;
        const n = N(vx, vz);
        if (Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI > 32) continue;
        viewpoints.push({ x: vx, z: vz, seen: 0 });
      }
    }
    const credit = (cx, cz) => {
      for (const v of viewpoints) {
        const d = Math.hypot(v.x - cx, v.z - cz);
        if (d >= SEE_IN && d <= SEE_OUT) v.seen += 1;
      }
    };
    const hungriest = () => {
      let best = null;
      for (const v of viewpoints) {
        const sc = v.seen + rng() * 0.8;
        if (!best || sc < best.sc) best = { v, sc };
      }
      return best && best.v;
    };

    let runs = 0;
    let poles = 0;
    let tries = 0;
    const CAP = 130;
    while (runs < CAP && tries < CAP * 25) {
      tries += 1;
      const vp = hungriest();
      if (!vp) break;

      /* A run heads for the peak, roughly - that is where everything
         on this mountain is going - with a wander so it is a path and
         not a radius. */
      const toPeak = Math.atan2(-vp.x, -vp.z);
      const head = toPeak + rng.jit(0.9);
      const count = 5 + rng.int(0, 7);
      const gap = rng.range(11, 22);
      const pts = [];
      let ok = true;
      for (let i = 0; i < count; i += 1) {
        const a = head + Math.sin(i * 0.7 + rng() * 0.2) * 0.22;
        const x = vp.x + Math.sin(a) * gap * i;
        const z = vp.z + Math.cos(a) * gap * i;
        if (Math.hypot(x, z) > MAP_HALF - 90) { ok = false; break; }
        const n = N(x, z);
        if (Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI > 36) { ok = false; break; }
        let onPad = false;
        for (const id of STATION_ORDER) {
          const st = STATIONS[id];
          if (Math.hypot(x - st.x, z - st.z) < st.padR * 0.34) { onPad = true; break; }
        }
        if (onPad) { ok = false; break; }
        /* Markers mark a route; they do not stand in one. */
        if (nearRoad(x, z, 8)) { ok = false; break; }
        pts.push([x, z]);
      }
      if (!ok || pts.length < 4) continue;

      for (let i = 0; i < pts.length; i += 1) {
        const [x, z] = pts[i];
        const h = rng.range(2.4, 3.4);
        let g = kit.votiveMarker(rng, { h, r: 0.16, sides: 5 });
        g = g && g.geo ? g.geo : g;
        kit.transform(g, { rot: [rng.jit(0.06), rng() * Math.PI * 2, rng.jit(0.06)] });
        g = paintRimed(g, BARK_RAMP, {
          rime: 0.72, threshold: 0.06, normalWeight: 0.32, jitter: 0.10,
          min: 0, max: h,
        });
        const bin = `route-${Math.floor((x + MAP_HALF) / CELL)}-${Math.floor((z + MAP_HALF) / CELL)}`;
        place(bin, "bark", g, x, z, {
          tag: "route", bedFactor: 0.6, maxBed: 0.9,
          cap: true, capBins: 10, collisionSolid: false,
        });
        poles += 1;
      }

      /* Cable between consecutive poles on about half the runs - a
         line the eye can follow rather than a row of dots. */
      if (rng.chance(0.55)) {
        for (let i = 0; i < pts.length - 1; i += 1) {
          const [ax, az] = pts[i];
          const [bx, bz] = pts[i + 1];
          const a = [ax, H(ax, az) + 2.5, az];
          const b = [bx, H(bx, bz) + 2.5, bz];
          const run2 = kit.prayerFlagRun([a, b], {
            flags: rng.chance(0.30) ? 6 : 0, seed: rng.int(1, 1e6),
          });
          if (run2.geo && run2.geo.attributes && run2.geo.attributes.position.count) {
            batch.add("route-cord", "iron", run2.geo,
              { tag: "route-cord", collisionSolid: false });
          }
          for (const spec of (run2.extras && run2.extras.flagSpecs) || []) {
            if (spec && spec.geo && spec.geo.attributes && spec.geo.attributes.wave) {
              banners.push(spec);
            }
          }
        }
      }

      for (const [x, z] of pts) credit(x, z);
      runs += 1;
      let anyEmpty = false;
      for (const v of viewpoints) { if (v.seen === 0) { anyEmpty = true; break; } }
      if (!anyEmpty) break;
      await new Promise((r2) => setTimeout(r2, 0));
    }

    let empty = 0;
    for (const v of viewpoints) if (v.seen === 0) empty += 1;
    await progress("Marking the routes");
    return {
      runs, poles, tries, viewpoints: viewpoints.length, emptyView: empty,
      emptyPct: Number((100 * empty / Math.max(1, viewpoints.length)).toFixed(1)),
    };
  }

  /* ================================================================
     NEAR-FIELD ANCHORS

     Two axes carry this level's entire deficit against the desert,
     and a reviewer scoring both on seven axes found they are the same
     wound: composition 2.5 against 3.8, value structure 2.7 against
     4.0, while material response and atmosphere are already AHEAD.
     Its words: "no true black in 9 of 12 frames and no nearest object
     in 6 of them; those are the same wound... the two snow frames
     that won on merit are precisely the two that have near dark
     masses."

     A dark mass inside ten metres does both jobs at once. It is the
     nearest thing in frame, so the composition has a foreground; and
     it is bare wind-scoured rock at a fraction of snow's albedo, so
     the histogram finally has a bottom. Neither is achievable by
     grading a level whose every surface is 0.85 albedo.

     Placed on the same coverage rule the mid-ground pass uses - walk
     the viewpoints, find the ones with nothing near them, put
     something there - but in the 6-26m band rather than 40-120m, and
     small enough (1.5-5m) never to block the shot it is framing.
     ================================================================ */
  async function buildNearAnchors() {
    const rng = makeRng(0x2ea4c7);
    const CELL = 256;
    const NEAR_IN = 6;
    const NEAR_OUT = 26;
    /* --- THE GRID MUST BE FINER THAN THE BAND IT COVERS ----------

       88m viewpoints covering a 6-26m band leaves most of the ground
       between them uncovered: the placer reported 0% empty and the
       frames still had nothing in the near field, because a camera
       standing 40m from the nearest viewpoint sees none of its
       anchors. The mid-ground pass got away with a 72m grid because
       its band is 40-120m and overlaps itself; this one does not.

       26m is the band's outer edge, so a grid at 24m guarantees every
       point on the walkable map is inside some viewpoint's band. */
    const VP_STEP = 24;
    const viewpoints = [];
    for (let vx = -MAP_HALF + 120; vx <= MAP_HALF - 120; vx += VP_STEP) {
      for (let vz = -MAP_HALF + 120; vz <= MAP_HALF - 120; vz += VP_STEP) {
        if (Math.hypot(vx, vz) > MAP_HALF - 120) continue;
        const n = N(vx, vz);
        if (Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI > 30) continue;
        /* Nothing on a fight floor. */
        let onPad = false;
        for (const id of STATION_ORDER) {
          const st = STATIONS[id];
          /* 0.28, not 0.5. A pad is 95-190m across, so half of it is
             a 95m exclusion - and the eye-level cameras stand INSIDE
             that, which is why the first version reported 0% of
             viewpoints uncovered and the frames still had nothing in
             the near field. 0.28 is the fight core the litter pass
             already uses; outside it a knee-high rock cannot block a
             charge and is the only foreground these shots have. */
          if (Math.hypot(vx - st.x, vz - st.z) < st.padR * 0.28) { onPad = true; break; }
        }
        if (onPad) continue;
        viewpoints.push({ x: vx, z: vz, seen: 0 });
      }
    }
    const credit = (cx, cz) => {
      for (const v of viewpoints) {
        const d = Math.hypot(v.x - cx, v.z - cz);
        if (d >= NEAR_IN && d <= NEAR_OUT) v.seen += 1;
      }
    };
    const hungriest = () => {
      let best = null;
      for (const v of viewpoints) {
        const sc = v.seen + rng() * 0.7;
        if (!best || sc < best.sc) best = { v, sc };
      }
      return best && best.v;
    };

    let placed = 0;
    let tries = 0;
    const CAP = 2600;
    while (placed < CAP && tries < CAP * 40) {
      tries += 1;
      const vp = hungriest();
      if (!vp) break;
      const a = rng() * Math.PI * 2;
      const d = NEAR_IN + rng() * (NEAR_OUT - NEAR_IN);
      const x = vp.x + Math.cos(a) * d;
      const z = vp.z + Math.sin(a) * d;
      if (Math.hypot(x, z) > MAP_HALF - 60) continue;
      /* Never on the processional way or a station approach. */
      if (nearRoad(x, z, 12)) continue;
      const n = N(x, z);
      if (Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI > 38) continue;
      let onPad = false;
      for (const id of STATION_ORDER) {
        const st = STATIONS[id];
        if (Math.hypot(x - st.x, z - st.z) < st.padR * 0.28) { onPad = true; break; }
      }
      if (onPad) continue;

      /* A wind-scoured fin, not a boulder: tall for its footprint so
         it reads as a silhouette from low down, and thin enough that
         it never becomes the subject. */
      const h = rng.range(1.6, 4.8);
      let geo = kit.crag(rng, {
        height: h, radius: h * rng.range(0.24, 0.46),
        layers: 4, sides: rng.int(5, 7),
        lean: rng.range(0.05, 0.42), sink: 0.30,
      });
      kit.transform(geo, { rot: [0, rng() * Math.PI * 2, 0] });
      /* GRANITE, and dark on purpose. The whole point of this pass is
         a value below snow's, so it is never painted with the scree
         ramp's lighter end. */
      geo = paintRimed(geo, GRANITE_RAMP, {
        rime: 0.30, threshold: 0.16, normalWeight: 0.30, jitter: 0.10,
        min: 0, max: h,
      });

      const bin = `anchor-${Math.floor((x + MAP_HALF) / CELL)}-${Math.floor((z + MAP_HALF) / CELL)}`;
      place(bin, "granite", geo, x, z, {
        tag: "anchor",
        bedFactor: 0.66, maxBed: 1.3,
        cap: true, capBins: 14, collisionSolid: true,
      });
      credit(x, z);
      placed += 1;
      let anyEmpty = false;
      for (const v of viewpoints) { if (v.seen === 0) { anyEmpty = true; break; } }
      if (!anyEmpty) break;
      if ((placed & 15) === 0) await new Promise((r2) => setTimeout(r2, 0));
    }

    let empty = 0;
    for (const v of viewpoints) if (v.seen === 0) empty += 1;
    await progress("Setting the near field");
    return {
      placed, tries, viewpoints: viewpoints.length, emptyNear: empty,
      emptyPct: Number((100 * empty / Math.max(1, viewpoints.length)).toFixed(1)),
    };
  }

  async function buildGroundLitter() {
    const rng = makeRng(0x11e7e7);
    const TARGET = 4200;
    const CELL = 256;
    let placed = 0;
    let tries = 0;

    while (placed < TARGET && tries < TARGET * 14) {
      tries += 1;
      const x = (rng() * 2 - 1) * (MAP_HALF - 30);
      const z = (rng() * 2 - 1) * (MAP_HALF - 30);
      const r = Math.hypot(x, z);
      if (r > MAP_HALF - 30) continue;

      /* A FIGHT FLOOR IS CLEAR; A CAMP IS NOT.

         The first version excluded a full pad radius around all nine
         stations, and since a pad is 95-190m across that removed
         litter from precisely the ground the player stands on. The
         basecamp eye-level frame came back as bare as before the
         pass existed, because every stone was over a hundred metres
         away.

         So the clear zone is the inner 45% of a pad - the part a
         fight actually uses - and beyond that only the SMALL pieces
         are allowed, which cannot block a shot or trip a charge but
         do fill the bottom third of a frame. The Basecamp is exempt
         entirely: nothing is fought there, and a landing camp with
         nothing lying about is not a camp. */
      let clear = 0;
      let smallOnly = false;
      for (const id of STATION_ORDER) {
        if (id === "basecamp") continue;
        const st = STATIONS[id];
        const d = Math.hypot(x - st.x, z - st.z);
        if (d < st.padR * 0.45) { clear = 1; break; }
        if (d < st.padR * 1.02) smallOnly = true;
      }
      if (clear) continue;

      const n = N(x, z);
      const slope = Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI;
      if (slope > 46) continue;                    // it would have slid off

      const y = H(x, z);
      const curv = field.curvatureAt(x, z);
      /* Concave ground collects; convex ground is swept. */
      const collect = clamp01(0.30 + curv * 1.9);
      /* Below the cloud deck the ground is rubble-strewn moraine; the
         high snowfields are clean. */
      const low = 1 - sstep(120, 380, y);
      const chance = clamp01(0.10 + collect * 0.55 + low * 0.30);
      if (rng() > chance) continue;

      /* The big pieces carry collision, so they get the same rule,
         plus their own 4.2m reach. */
      if (nearRoad(x, z, 11)) continue;
      const big = !smallOnly && rng.chance(0.16);
      const size = big ? rng.range(1.5, 4.2) : rng.range(0.28, 1.25);
      /* Three substances, chosen by where the sample is rather than
         at random, so the litter tells you what ground you are on. */
      const icy = y > 180 && rng.chance(0.45);
      const geo = icy
        ? kit.shard(rng, {
          height: size * rng.range(0.8, 1.7), radius: size * 0.55,
          sides: rng.int(4, 6), sharpness: 0.68, lean: rng.range(0.2, 0.9),
        })
        : kit.crag(rng, {
          height: size * rng.range(0.5, 1.15), radius: size,
          layers: 4, sides: rng.int(5, 8), lean: rng.range(0, 0.5), sink: 0.42,
        });
      if (!icy) paintByHeight(THREE, geo, low > 0.5 ? SCREE_RAMP : GRANITE_RAMP,
        { lo: 0.10, hi: 0.88, jitter: 0.10 });

      const bin = `litter-${Math.floor((x + MAP_HALF) / CELL)}-${Math.floor((z + MAP_HALF) / CELL)}`;
      place(bin, icy ? "glacierIce" : (low > 0.5 ? "scree" : "granite"), geo, x, z, {
        tag: "litter",
        /* Bedded deep and capped only occasionally. A field of 4000
           drift collars is 4000 extra meshes' worth of triangles for
           a skirt nobody sees on a 40cm stone; the big ones get one
           because at 4m the contact is the whole read. */
        bedFactor: 0.78, maxBed: big ? 1.4 : 0.55,
        cap: big, capBins: 12, collisionSolid: big,
      });
      placed += 1;
      if ((placed & 511) === 0) await new Promise((r2) => setTimeout(r2, 0));
    }

    await progress("Scattering the ground");
    return { placed, tries };
  }

  /* ================================================================
     THE WAY OF CROSSES

     The wheel-cross is the order's mark and it is the same object on
     both worlds - see the loader at the head of this file. Vesper
     carries it seventeen times across the Gilded Reach, once at
     forty-four metres on the lip of the Matriarch's pan, and now
     along the cathedral's processional. Kenosis carries it the way a
     pilgrim route carries one: at the stations, and at intervals
     along the road between them.

     THREE RULES, and each of them is a place this could go wrong.

     1. NOT ON THE ROAD. `place` disarms collision for anything
        within 7m of the carriageway, which would leave a monument
        you walk through. So the placer rejects a site inside 11m and
        finds another rather than accepting a ghost.

     2. NOT ON A FIGHT FLOOR. The station crosses stand at 0.86 of
        the pad radius - the rim, where the ground is still flat and
        a charging boss is not. The litter and anchor passes use
        0.28 of the pad for the same reason and this is the outside
        of the same rule.

     3. SIZED BY WHERE IT IS. A wayside cross is 6-9m and a station
        cross is 13-16m, which is the difference between a marker and
        a monument, and it is the whole reason nine of them read as
        the stations of a route rather than as more scatter. The
        parvis pair is 17m and no larger: the cathedral behind them
        is 62m to the crossing spire and anything that competes with
        it flattens the one frame this level is built around.
     ================================================================ */
  async function buildWayCrosses() {
    await crossAssetReady;
    if (!crossAsset) return { stations: 0, wayside: 0, parvis: 0, rejected: 0 };
    const rng = makeRng(0x5c0551);
    let rejected = 0;

    /** True if a cross may stand here at all. */
    const siteOk = (x, z, clear) => {
      if (Math.hypot(x, z) > MAP_HALF - 80) return false;
      if (nearRoad(x, z, clear)) return false;
      const n = N(x, z);
      if (Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI > 30) return false;
      for (const id of STATION_ORDER) {
        const st = STATIONS[id];
        if (Math.hypot(x - st.x, z - st.z) < st.padR * 0.34) return false;
      }
      return true;
    };

    /* --- the eight lower stations ------------------------------- */
    let stations = 0;
    for (const id of STATION_ORDER) {
      if (id === "summit") continue;          // the parvis pair, below
      const S = STATIONS[id];
      /* The bearing the pilgrim leaves by - toward the peak - swung
         off the spur so the monument is beside the way out rather
         than standing in it. Both hands are tried, then the ring is
         walked, so a station whose spur happens to leave on the
         chosen side still gets its cross. */
      const toPeak = Math.atan2(-S.x, -S.z);
      const rim = S.padR * 0.86;
      let sited = null;
      const swings = [0.85, -0.85, 1.5, -1.5, 2.2, -2.2, 2.9, -2.9, 0.3, -0.3];
      for (const swing of swings) {
        const a2 = toPeak + swing;
        const x = S.x + Math.sin(a2) * rim;
        const z = S.z + Math.cos(a2) * rim;
        if (!siteOk(x, z, 11)) { rejected += 1; continue; }
        sited = { x, z, a2 };
        break;
      }
      if (!sited) continue;
      placeWheelCross({
        key: `waycross-station-${id}`,
        name: `${id}-choir-wheel`,
        station: id,
        tag: "waycross-station",
        bin: `waycross-${id}`,
        x: sited.x, z: sited.z,
        /* Faced back at the pad, so it is presented to whoever is
           standing at the station rather than seen edge-on. */
        yaw: sited.a2 + Math.PI,
        tiltX: rng.jit(0.025),
        tiltZ: rng.jit(0.025),
        height: rng.range(13.0, 16.0),
        variant: "station",
      });
      stations += 1;
      poi(`${id}-cross`, "A Wheel-Cross", sited.x, sited.z);
    }

    await progress("Raising the crosses");

    /* NOTHING AT THE FOOT OF THE GREAT FLIGHT.

       A pair of 17m crosses stood here and they were wrong twice
       over: they flanked the one approach the level is composed
       around, so every frame up the stair had a monument in each
       corner of it, and at seventeen metres against a 68m building
       they read as furniture rather than as the order's mark. The
       summit's cross is now a single 82m one on the cliff shoulder,
       built with the station in `buildSummitStation` because it
       shares that function's datum. */

    /* --- the road between them ---------------------------------- */
    const WAYSIDE = 14;
    let wayside = 0;
    for (let i = 0; i < WAYSIDE; i += 1) {
      const t = (i + 0.5) / WAYSIDE;
      const p = viaSacraPointAt(t);
      /* Alternating hands, so the eye reads a sequence rather than a
         fence. `forward` is (sin yaw, cos yaw) in this project's
         convention, so the right hand is (cos yaw, -sin yaw). */
      let sited = null;
      for (const hand of (i % 2 ? [1, -1] : [-1, 1])) {
        for (const off of [13, 17, 22, 28]) {
          const x = p.x + Math.cos(p.yaw) * off * hand;
          const z = p.z - Math.sin(p.yaw) * off * hand;
          if (!siteOk(x, z, 11)) { rejected += 1; continue; }
          sited = { x, z, hand };
          break;
        }
        if (sited) break;
      }
      if (!sited) continue;
      /* Faced across the road at the traveller. The wheel is close
         to symmetric front to back, so a half-turn error here costs
         nothing; being edge-on to the way would cost the read. */
      const face = Math.atan2(-sited.hand * Math.cos(p.yaw), sited.hand * Math.sin(p.yaw));
      /* Taller low down, where the air is thick and the ground is
         moraine, and stubbier as the route climbs into the wind.
         Also the honest reason: a 9m monument on the summit cone is
         in frame with a 62m cathedral. */
      const climb = clamp01(p.y / 452);
      placeWheelCross({
        key: `waycross-way-${i}`,
        name: `via-sacra-choir-wheel-${i}`,
        station: "waycross",
        tag: "waycross-way",
        bin: `waycross-way-${Math.floor(i / 4)}`,
        x: sited.x, z: sited.z,
        yaw: face + rng.jit(0.12),
        tiltX: rng.jit(0.05),
        tiltZ: rng.jit(0.05),
        height: lerp(9.0, 6.2, climb) * rng.range(0.94, 1.08),
        variant: "wayside",
      });
      wayside += 1;
    }

    await progress("Marking the way");
    return { stations, wayside, rejected };
  }

  await buildSummitStation();
  const vigilStats = await buildVigilLine();
  const processionStats = await buildProcession();
  const massStats = await buildOpenGroundMasses();
  const anchorStats = await buildNearAnchors();
  const routeStats = await buildRouteMarkers();
  const crossStats = await buildWayCrosses();
  const litterStats = await buildGroundLitter();

  meshes = batch.flush().concat(authoredMeshes);
  await progress("Setting the stones against you");

  /* ------------------------------------------------------------
     BEAUTY SHOTS

     The fourteen camera stations from the layout's section 6.

     EVERY ONE IS COMPUTED OFF THE REAL GROUND AND OFF THE STATIONS'
     OWN PUBLISHED GEOMETRY, never hardcoded - which is how Vesper
     ended up with a camera inside a plaza statue and inside its
     fallen bell, neither of which trips any image metric, because a
     camera buried in masonry sits in the normal range on every
     histogram.

     The station re-siting and the finishing pass invalidated most
     of the first set, and the two failures are worth recording
     because they are the two failure modes of a computed pose:

       - `summit-look-back` was `[0, padY + 12, -34]` looking at
         [280, 60, 640]. After the cathedral landed, 62% of that
         frame was the building's unlit north wall at 7.04 m. Its
         measured luma and sigma were BYTE-IDENTICAL across a veiled
         build, a cleared build and a no-cloud control - a pose whose
         numbers do not move when the entire sky changes is not
         photographing the sky. It is now on the parvis's south rim,
         outside the cathedral's footprint, looking down the fall
         line at the stations.

       - `cascade-backlit` was sited 132 m out from the pad centre,
         which after the curtain was hung off its real headwall put
         the camera 0.39 m inside the ice. Every pose that frames an
         object built in this pass is now derived from the thing it
         frames, not from the station's naming coordinate.

     Two shared helpers do the work. `eye` puts a camera at a height
     above the real ground; `look` builds the record. Nothing below
     computes a Y by hand.
     ------------------------------------------------------------ */

  const eye = (x, z, h = 1.7) => [x, H(x, z) + h, z];
  const S = STATIONS;

  /** Polar helper: a world point at radius `r` on xz bearing `a`. */
  const polar = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];

  /* THE BISECTOR OF THE WIND AND THE SUN, and it is the most useful
     number in this block.

     Kenosis's wind comes from compass 292 (WNW) and its sun sits at
     compass 158 (SSE), 134 degrees apart. That is deliberate - it is
     what makes the rime and the key land on different faces and give
     the mountain two readings - but it means a face cannot be both
     fully rimed and fully lit, and a camera aimed at either extreme
     photographs one of them in the dark.

     Measured on `rime-forest-graze`: sited straight upwind, the
     stand's rimed faces have N.L = -0.70, forty-four degrees past
     their own terminator, and a hundred and twenty trees carrying
     15,017 triangles of bright rime rendered as pure black
     silhouettes. Sited straight downwind they are lit and there is
     no rime on them to see.

     Halfway between is the answer: a face pointing along
     `WINDWARD + sunward` has a wind exposure of 0.39 and an N.L of
     0.39, so it is genuinely rimed AND genuinely lit. In engine axes
     the sun at compass 158 points toward (0.375, 0.927), so the
     bisector is (-0.707, +0.707): west and south. Every station whose
     subject is a rimed surface is shot from that quarter. */
  const SUNWARD = [0.3746, 0.9272];
  const RIME_VIEW = (() => {
    const vx = WINDWARD[0] + SUNWARD[0];
    const vz = WINDWARD[1] + SUNWARD[1];
    const L = Math.hypot(vx, vz) || 1;
    return [vx / L, vz / L];
  })();
  /** A point on the Via Sacra, with its real ground height. */
  const roadAt = (t) => {
    const n = VIA_SACRA_PATH.length - 1;
    const i = clamp(Math.round(clamp01(t) * n), 0, n);
    const p = VIA_SACRA_PATH[i];
    return [p[0], H(p[0], p[1]), p[1]];
  };

  /* --- the arrival frame ---
     The level's first image: the whole mountain between the two
     basecamp buttresses, with the camp in the near ground for
     scale. Pulled BACK from the gate rather than sited on it - the
     camp was built ahead and to the left of the spawn, and from the
     gate itself it is behind the camera. */
  const arrivalPos = eye(BASECAMP.x + 10, BASECAMP.z + 96, 11);

  /* --- the Via Sacra ---
     Three levels of road in one frame needs a camera OUTSIDE the
     spiral looking across it, high enough that the near leg does not
     hide the far one. Sited off a mid-height road point, pushed out
     radially and lifted; the target is a point a third of a turn
     further up, which is what puts the road's own curvature across
     the frame instead of along it. */
  /* Sited over the SOUTH-EAST flank, which is the lit one: the sun
     is at compass 158 and points toward +Z, so from anywhere north
     or west of the peak the mountain is a black mass and the road on
     it cannot be seen at all. The first version was sited off a
     mid-road point without regard to bearing, drew the lit face of
     the peak beautifully and had no road in it.

     The camera is high and the target is up-slope on the same
     bearing, which is what stacks three legs of the spiral one above
     another instead of laying them end to end. */
  const roadOutA = 0.62;                      // xz bearing, SE quadrant
  const roadOut = polar(roadOutA, 690);
  const roadHi = (() => { const [x, z] = polar(roadOutA + 0.30, 250); return [x, H(x, z), z]; })();

  /* --- the parvis ---
     Outside the parapet on the south, looking up at the front. The
     camera height is measured off the REAL ground there rather than
     off `padY`, because outside the pad rim the mountain has already
     started to fall away and a fixed `padY + 7` floats. */
  const parvisPos = [0, S.summit.padY + 6.5, S.summit.padR - 8];

  /* --- looking back ---
     On the parvis's south rim, clear of the cathedral's own
     footprint (the building is 17 m wide and its front wall is at
     z = 29.65, so z = +58 is 28 m clear of the porch) and above the
     parapet coping. Aimed down the fall line at the basecamp, which
     puts the Via Sacra, the Bowl, the Tarn and the cloud sea in one
     frame. */
  const lookBackPos = [11, S.summit.padY + 2.6, S.summit.padR - 4.5];

  /* --- the inversion ---
     Standing IN the deck, which is at 120 m. Found by walking
     outward along the Tarn's bearing until the ground passes 118 m,
     so it stays in the deck when the profile is re-authored. */
  const inversionAt = (() => {
    /* ABOVE the deck, not inside it. Standing at h <= 118 puts the
       camera in the cloud, and a camera in cloud photographs cloud:
       the frame came back 76% under 15% luma with no horizon, no
       subject and nothing to read, and a blind reviewer called it a
       blank grey slab. The inversion is a thing you look ACROSS -
       the sheet below, the peak above it - so the camera now stands
       on the first ground between 150m and 230m, which is clear air
       just over the deck top at 120m. */
    const a = Math.atan2(S.tarn.z, S.tarn.x) + 0.42;
    for (let r = 940; r > 380; r -= 6) {
      const [x, z] = polar(a, r);
      const h = H(x, z);
      if (h >= 150 && h <= 230) return eye(x, z, 3.2);
    }
    const [fx, fz] = polar(a, 700);
    return eye(fx, fz, 3.2);
  })();

  /* --- the crevasse lip ---
     `CREVASSES[0]` is `tongue-1`. The camera stands ON the lip - one
     span out from the centreline, which is where the cornice this
     pass built is - and looks along the slot rather than across it,
     because a hole photographed across its width is a line and a
     hole photographed along its length is a hole. */
  const crev = CREVASSES[0];
  const crevEye = (() => {
    if (!crev) return { pos: eye(-520, -420, 2.1), target: [-520, 60, -420] };
    const dx = crev.bx - crev.ax;
    const dz = crev.bz - crev.az;
    const L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L;
    const nz = dx / L;
    const off = crev.half + crev.span - 4;
    const px = lerp(crev.ax, crev.bx, 0.14) + nx * off;
    const pz = lerp(crev.az, crev.bz, 0.14) + nz * off;
    return {
      pos: eye(px, pz, 1.85),
      target: [
        lerp(crev.ax, crev.bx, 0.72) + nx * off * 0.15,
        H(crev.cx, crev.cz) - crev.depth * 0.65,
        lerp(crev.az, crev.bz, 0.72) + nz * off * 0.15,
      ],
    };
  })();

  /* --- the cascade, backlit ---
     The sun is at compass 158 (SSE), which in engine axes points
     toward +Z. The Cascade is due north of the summit, so a camera
     placed OUTBOARD of the curtain looking back inboard is looking
     south - into the sun - with the ice between. That is the whole
     shot, and it only works from outboard: from any other bearing
     the curtain is front-lit and opaque.

     Sited off `cascadeLip`, which the builder measured, rather than
     off the station coordinate that put the first version 0.39 m
     inside the ice. */
  const cascadeShot = (() => {
    if (!cascadeLip) {
      return { pos: eye(S.cascade.x, S.cascade.z + 150, 6), target: [S.cascade.x, S.cascade.padY + 40, S.cascade.z] };
    }
    /* Back far enough that the cirque, the curtain and the plunge
       basin are all in frame - a waterfall is a relation between
       three things - and swung 24 degrees off the fall line so the
       SSE key rakes across the pipes' flanks instead of hitting the
       curtain edge-on. Dead on the axis the whole face is at N.L < 0
       and the frame is a black comb against a bright sky. */
    const { r, y, bear, fall } = cascadeLip;
    const [cx, cz] = polar(bear + 0.42, r + 300);
    const [tx, tz] = polar(bear, r + 34);
    return {
      pos: eye(cx, cz, 34),
      target: [tx, y - fall * 0.30, tz],
    };
  })();

  /* --- the Bell Terrace, at the edge ---
     Standing on the lip inside the parapet, looking ALONG the
     frontage so the campanile row is a row rather than a single
     frame end-on, with the drop opening on the right. Eye level,
     because the whole claim of this station is exposure and a
     floating camera cannot make that claim. */
  const bellShot = (() => {
    const outA = Math.atan2(S.bell.z - 0, S.bell.x - 0);
    const along = outA + Math.PI / 2;
    /* Standing on the lip at the SOUTH end of the frontage, looking
       north along the row with the drop opening on the left. That
       bearing is the compromise the whole station is built around:
       the priory's outward (west) faces are the rimed ones and its
       inward (east) faces are the lit ones, so a camera at either
       end of the row sees both at a rake, and a camera square-on to
       the frontage sees only one of them. Eye level, because the
       claim of this station is exposure and a floating camera cannot
       make that claim. */
    const px = S.bell.x + Math.cos(outA) * (S.bell.padR - 22) + Math.cos(along) * 66;
    const pz = S.bell.z + Math.sin(outA) * (S.bell.padR - 22) + Math.sin(along) * 66;
    const tx = S.bell.x + Math.cos(outA) * (S.bell.padR - 14) + Math.cos(along) * -18;
    const tz = S.bell.z + Math.sin(outA) * (S.bell.padR - 14) + Math.sin(along) * -18;
    return { pos: eye(px, pz, 1.7), target: [tx, H(tx, tz) + 8.5, tz] };
  })();

  /* --- the rime forest, grazing ---
     The camera has to be UPWIND of the stand, because the rime is on
     the windward faces and everything else is bark. WNW of the
     centre looking ESE puts the feathers square to the lens with the
     SSE sun raking across them, which is what "grazing light across
     rime feathers" means and what the first pose (sited 96 m east,
     looking at the lee side) could not deliver. */
  const rimeShot = (() => {
    const px = S.rime.x + RIME_VIEW[0] * (S.rime.padR + 30);
    const pz = S.rime.z + RIME_VIEW[1] * (S.rime.padR + 30);
    const tx = S.rime.x - RIME_VIEW[0] * 48;
    const tz = S.rime.z - RIME_VIEW[1] * 48;
    return { pos: eye(px, pz, 2.4), target: [tx, H(tx, tz) + 11, tz] };
  })();

  /* --- sastrugi, grazing ---
     Wind slab is carved ALONG the wind, so the ridges are only
     visible when the light rakes across their grain and the camera
     looks down them. The wind travels ESE; the sun is SSE; so the
     camera looks downwind from a low height with the key coming in
     from the side. 1.35 m is deliberately below eye level - this is
     the texture test and it is measured at the height a prone figure
     sees the snow from. */
  const sastrugiShot = (() => {
    /* Looking down the grain with the sun on the shoulder, not in
       the lens. Sighted straight downwind the key sits within 22
       degrees of the view axis, and the frame came back at luma 180
       with 94% of its pixels clipped - a white field with a white
       sun in it, which measures as bright and reads as nothing. The
       run is offset 55 degrees off the wind so the ripples still run
       away from the camera and the light still rakes across them. */
    const a = Math.atan2(DOWNWIND[1], DOWNWIND[0]) - 0.96;
    const px = S.bowl.x - Math.cos(a) * 140;
    const pz = S.bowl.z - Math.sin(a) * 140;
    const tx = S.bowl.x + Math.cos(a) * 220;
    const tz = S.bowl.z + Math.sin(a) * 220;
    return { pos: eye(px, pz, 1.35), target: [tx, H(tx, tz) + 4.0, tz] };
  })();

  /* --- the tarn, as a mirror ---
     Low and CLOSE to the ice, because a mirror is a grazing-angle
     effect: from 150 m away at 3.4 m the lake is a dark band eight
     pixels tall and reflects nothing, which is what the first pose
     photographed. 1.5 m above the ice at its own rim, looking across
     the full width toward the bright south-west horizon, puts the
     sky in it. */
  const tarnShot = (() => {
    if (!tarnIce) return { pos: eye(S.tarn.x + 150, S.tarn.z + 60, 3.4), target: [S.tarn.x, S.tarn.padY, S.tarn.z] };
    const a = Math.atan2(S.tarn.z, S.tarn.x);
    /* Just outside the shore shelf, 2.6 m up, looking across the
       full width toward the peak. Low, because a mirror is a
       grazing-angle effect and the reflection dies as the camera
       rises - but not so low that the shelf's own plates cut the
       lake off, which is what happened at 1.5 m on the rim itself. */
    const px = tarnIce.x - Math.cos(a) * (tarnIce.r + 34);
    const pz = tarnIce.z - Math.sin(a) * (tarnIce.r + 34);
    return {
      pos: [px, tarnIce.y + 2.6, pz],
      target: [
        tarnIce.x + Math.cos(a) * tarnIce.r * 1.9,
        tarnIce.y + 26,
        tarnIce.z + Math.sin(a) * tarnIce.r * 1.9,
      ],
    };
  })();

  /* --- the one warm frame ---
     Sited ON the melt boundary rather than near the station, looking
     across it: the subject of this frame is the EDGE where the snow
     stops, and a camera that is entirely inside or entirely outside
     the ring cannot photograph an edge. Standing on the rim with the
     bare pan and its plumes filling the far half is the shot. */
  const fumaroleShot = (() => {
    if (!fumaroleField) {
      return { pos: eye(S.fumarole.x + 74, S.fumarole.z + 54, 4), target: [S.fumarole.x, S.fumarole.padY + 8, S.fumarole.z] };
    }
    /* Back outside the melt ring and lifted, so the frame contains
       SNOW as well as bare ground. Standing on the boundary itself
       put the camera inside the station's own warm tint with nothing
       cold in shot, and the whole picture came back one tan field -
       an edge needs both of its sides. */
    const a = Math.atan2(S.fumarole.z, S.fumarole.x) + 2.5;
    const px = fumaroleField.x + Math.cos(a) * (fumaroleField.r + 132);
    const pz = fumaroleField.z + Math.sin(a) * (fumaroleField.r + 132);
    return {
      pos: eye(px, pz, 16),
      target: [
        fumaroleField.x - Math.cos(a) * fumaroleField.r * 0.30,
        H(fumaroleField.x, fumaroleField.z) + 6,
        fumaroleField.z - Math.sin(a) * fumaroleField.r * 0.30,
      ],
    };
  })();

  /* --- alone in the bowl ---
     The figure in white negative space. The camera looks ACROSS the
     empty floor at the loaded headwall, so the frame is a person, a
     lot of nothing, and a crown line - which is the whole idea of
     the station in one image. */
  const bowlShot = (() => {
    const a = Math.atan2(S.bowl.z, S.bowl.x);
    const px = S.bowl.x + Math.cos(a) * (S.bowl.padR * 0.75) + Math.cos(a + 1.9) * 60;
    const pz = S.bowl.z + Math.sin(a) * (S.bowl.padR * 0.75) + Math.sin(a + 1.9) * 60;
    const [tx, tz] = polar(a, Math.hypot(S.bowl.x, S.bowl.z) - S.bowl.padR - 40);
    return { pos: eye(px, pz, 1.7), target: [tx, H(tx, tz) + 26, tz] };
  })();

  /* --- the icefall ---
     On the Tongue itself, looking DOWN the flow at the serac field
     with the moraine stripe running away underneath. Sited in tongue
     coordinates so it cannot leave the ice, and its height is taken
     off the ice surface rather than the rock 3.6 m below it. */
  const glacierShot = (() => {
    const [px, pz] = tongueXZ(0.06, 0.34);
    const [tx, tz] = tongueXZ(0.42, -0.05);
    const py = iceGroundAt(px, pz) + 14;
    return { pos: [px, py, pz], target: [tx, iceGroundAt(tx, tz) + 6, tz] };
  })();

  const beautyShots = [
    {
      id: "arrival",
      name: "The Basecamp gate, looking north",
      position: arrivalPos,
      target: [0, 392, 0],
      fov: 60,
    },
    {
      id: "via-sacra",
      name: "The Via Sacra, three levels in one frame",
      position: [roadOut[0], H(roadOut[0], roadOut[1]) + 176, roadOut[1]],
      target: [roadHi[0], roadHi[1] - 20, roadHi[2]],
      fov: 46,
    },
    {
      id: "summit-parvis",
      name: "The Cathedral of the Ninth Ascent",
      position: parvisPos,
      target: [0, summitBase + 22, 6],
      fov: 62,
    },
    {
      id: "summit-look-back",
      name: "From the parvis, looking back down",
      position: lookBackPos,
      target: [BASECAMP.x * 0.30, 176, BASECAMP.z * 0.42],
      fov: 70,
    },
    {
      id: "inversion",
      name: "Standing in the cloud deck",
      position: inversionAt,
      target: [0, 250, 0],
      fov: 62,
    },
    {
      id: "crevasse-edge",
      name: "The lip of a real hole",
      /* RE-FRAMED. The first version stood 34m off the slot at eye
         height and pointed into it, and a blind reviewer called the
         result "an accidental crop of a snowbank, no subject, no
         horizon - this is not a frame". A hole is not a subject; the
         EDGE of a hole with the mountain beyond it is. So the camera
         backs off along the slot's own axis, stands high enough to
         see both lips, and puts the summit in the top third - the
         crevasse now leads the eye rather than filling the frame. */
      position: (() => {
        const c = CREVASSES[0];
        if (!c) return eye(-520, -420, 14);
        const tx = c.bx - c.ax;
        const tz = c.bz - c.az;
        const inv = 1 / (Math.hypot(tx, tz) || 1);
        const px = c.cx + tx * inv * (c.halfLength + 46);
        const pz = c.cz + tz * inv * (c.halfLength + 46);
        return [px, H(px, pz) + 11, pz];
      })(),
      target: CREVASSES[0]
        ? [CREVASSES[0].cx * 0.45, 300, CREVASSES[0].cz * 0.45]
        : [0, 300, 0],
      fov: 56,
    },
    {
      id: "cascade-backlit",
      name: "The Frozen Cascade, lit from behind",
      position: cascadeShot.pos,
      target: cascadeShot.target,
      fov: 46,
    },
    {
      id: "bell-terrace-drop",
      name: "The Bell Terrace, at the edge",
      position: bellShot.pos,
      target: bellShot.target,
      fov: 58,
    },
    {
      id: "rime-forest-graze",
      name: "Grazing light across the rime",
      position: rimeShot.pos,
      target: rimeShot.target,
      fov: 46,
    },
    {
      id: "sastrugi-graze",
      name: "Wind slab at a grazing angle",
      position: sastrugiShot.pos,
      target: sastrugiShot.target,
      fov: 40,
    },
    {
      id: "tarn-mirror",
      name: "Sky in the black ice",
      /* RE-FRAMED. It was a long flat look across the lake into
         haze - "washed pink haze, no key, no focal point". The lake
         IS the subject and its subject is what stands in it, so the
         camera drops to the ice, shortens the throw, and puts the
         drowned procession between it and the mountain. Low and
         close is also what makes black ice read: the darker the
         grazing angle, the more sky it returns. */
      position: [S.tarn.x + 96, S.tarn.padY + 3.1, S.tarn.z + 78],
      target: [S.tarn.x - 40, S.tarn.padY + 9, S.tarn.z - 46],
      fov: 46,
    },
    {
      id: "fumarole-plume",
      name: "The one warm frame",
      position: fumaroleShot.pos,
      target: fumaroleShot.target,
      fov: 52,
    },
    {
      id: "bowl-scale",
      name: "Alone in the Avalanche Bowl",
      position: bowlShot.pos,
      target: bowlShot.target,
      fov: 58,
    },
    {
      id: "glacier-serac",
      name: "The Glacier Tongue's icefall",
      position: glacierShot.pos,
      target: glacierShot.target,
      fov: 52,
    },
  ];

  /* A LAST-RESORT CLEARANCE GUARD.

     Every pose above is derived from geometry that this build just
     placed, so any one of them can be walked into by a later change
     to the thing it frames - which is exactly what happened to
     `cascade-backlit` inside this session, and the symptom was a
     dark frame with a good histogram. The audit gate asserts camera
     clearance, and this is the cheap belt to its braces: if a camera
     has ended up under the ground it is lifted to stand on it.

     It cannot fix a camera inside a building and does not pretend
     to; the gate is what catches that. */
  for (const shot of beautyShots) {
    const g = H(shot.position[0], shot.position[2]);
    if (shot.position[1] < g + 1.4) shot.position[1] = g + 1.6;
  }

  /* ------------------------------------------------------------
     THE AUTHORED WALK SURFACE

     There is exactly one, and it is the Glacier Tongue's ice sheet.

     The Via Sacra is NOT one, and that is the more important half.
     Vesper needs a walk surface because its causeway is a mesh laid
     over the dunes and the player has to stand on the paving rather
     than on the sand under it. Kenosis's road is CUT INTO THE HEIGHT
     FIELD by summit-terrain, so `heightAt` already is the road, and
     answering here would put a second, disagreeing surface in front
     of `collide.js`'s `Math.max`.

     The ice is the exception because it is the one thing on this
     mountain that is genuinely 3.6 m of solid material standing on
     top of the ground, over 430 m of it. Rasterised as an obstacle
     it is a wall round the whole NW flank; ignored entirely it is a
     sheet the player wades through to the knee. `collide.js:518`'s
     `road-surface-` prefix takes the mesh out of the obstacle
     raster and this function puts the same surface back as support -
     both reading `iceSurfaceAt`, so there is no second copy to
     drift.

     Off the tongue it returns -Infinity, which means "terrain
     decides" and is the correct answer rather than an unfinished
     one.
     ------------------------------------------------------------ */
  /** The snow bridge's deck height at (x, z), or -Infinity off it.
   *  The same midpoint, axes and sag the mesh was swept along - the
   *  bridge is a rectangle in its own frame, so this is two dot
   *  products and the catenary. */
  function bridgeSurfaceAt(x, z) {
    const b = snowBridge;
    if (!b) return -Infinity;
    const dx = x - b.mx;
    const dz = z - b.mz;
    const across = dx * b.nx + dz * b.nz;      // along the span
    if (Math.abs(across) > b.reach) return -Infinity;
    const along = dx * b.tx + dz * b.tz;       // along the crevasse
    if (Math.abs(along) > b.halfW * 0.9) return -Infinity;
    const t = across / b.reach;
    return b.endY - (1 - t * t) * b.sag + 0.15;
  }

  /** Point-in-polygon against the podium's own 12-point cruciform,
   *  so the transepts are floor and the re-entrant corners are not. */
  function podiumSurfaceAt(x, z) {
    if (!summitPodium) return -Infinity;
    const poly = summitPodium.poly;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const xi = poly[i][0];
      const zi = poly[i][1];
      const xj = poly[j][0];
      const zj = poly[j][1];
      if ((zi > z) !== (zj > z)
        && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside ? summitPodium.topY : -Infinity;
  }

  /** The great flight's ramp, as a walk surface. */
  function stairSurfaceAt(x, z) {
    const S = summitStair;
    /* Run the landing 2 m past the top tread, held flat at the
       threshold height. The stringer stops where the porch begins and
       the podium's own polygon starts a metre further in, which left a
       1 m hole at the very door: the walk surface fell away to the
       parvis 6 m below and the climb ended one stride short. */
    if (!S || Math.abs(x) > S.hw || z < S.z0 - 2 || z > S.z1) return -Infinity;
    const t = clamp01((z - S.z0) / (S.z1 - S.z0));
    return S.yTop + (S.yBot - S.yTop) * t;
  }

  /** The drift floor, read off the 1 m grid the collars rasterised
   *  into. The four-cell max keeps the player on the crown of a drift
   *  rather than dropping a foot into the gap between two samples. */
  function driftSurfaceAt(x, z) {
    if (driftFloor.size === 0) return -Infinity;
    const fx = x / DRIFT_CELL;
    const fz = z / DRIFT_CELL;
    const gx = Math.floor(fx);
    const gz = Math.floor(fz);
    /* The 2x2 has to STRADDLE the point. Taking (gx, gx-1) regardless
       of where in the cell the point sits biases every lookup one
       cell toward -X/-Z, which drops a foot off the crown of a drift
       on the half of it that faces the other way. */
    const ox = (fx - gx) >= 0.5 ? 1 : -1;
    const oz = (fz - gz) >= 0.5 ? 1 : -1;
    let best = -Infinity;
    for (let i = 0; i <= 1; i += 1) {
      for (let j = 0; j <= 1; j += 1) {
        const v = driftFloor.get(driftKey(gx + i * ox, gz + j * oz));
        if (v !== undefined && v > best) best = v;
      }
    }
    return best;
  }

  const walkSurfaceAt = (x, z) => Math.max(
    iceSurfaceAt(x, z), bridgeSurfaceAt(x, z),
    podiumSurfaceAt(x, z), stairSurfaceAt(x, z), driftSurfaceAt(x, z)
  );
  /* `collide.js:893` asks for the highest authored surface anywhere
     inside a disc, for the flight solver's capsule footprint. Nine
     samples on a 3x3 lattice over the disc: the ice sheet has no
     feature narrower than its own 18 m lateral margin, so a finer
     probe cannot find anything the corners miss, and this is called
     per frame while flying. */
  /* --- A DRIFT HAS TO BE CLIMBABLE AS WELL AS SOLID ---------------

     The cell max takes the highest vertex in each square metre, and a
     collar's inner edge - where it banks against the prop it drifted
     against - is its steepest part. That put 2-3 m steps between
     adjacent cells, and a step the player cannot take is a wall
     whether it is made of granite or of snow: the traversal harness
     lost the Glacier Tongue to one on the spur at -196,-382.

     So the floor is relaxed until no cell stands more than DRIFT_RISE
     above any of its four neighbours, counting a neighbour with no
     drift in it as bare terrain. Heights only ever come down and are
     floored at the ground, so it converges and can never dig a hole.
     The player sinks a little into the steep inner lip of a big bank,
     which is what walking through deep snow looks like anyway. */
  const DRIFT_RISE = 1.0;
  (() => {
    const keys = Array.from(driftFloor.keys());
    for (let pass = 0; pass < 8; pass += 1) {
      let changed = 0;
      for (let n = 0; n < keys.length; n += 1) {
        const k = keys[n];
        const gz = (k % 8192) - 2048;
        const gx = Math.floor(k / 8192) - 2048;
        const here = driftFloor.get(k);
        let allowed = Infinity;
        for (let d = 0; d < 4; d += 1) {
          const nx = gx + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const nz = gz + (d === 2 ? 1 : d === 3 ? -1 : 0);
          const nk = driftKey(nx, nz);
          const nv = driftFloor.get(nk);
          const base = nv === undefined ? driftGroundAt(nx, nz, nk) : nv;
          if (base + DRIFT_RISE < allowed) allowed = base + DRIFT_RISE;
        }
        const floorY = driftGroundAt(gx, gz, k);
        const want = Math.max(floorY, Math.min(here, allowed));
        if (want < here - 1e-4) { driftFloor.set(k, want); changed += 1; }
      }
      if (!changed) break;
    }
  })();

  const walkSurfaceMaxInCircle = (x, z, r) => {
    let best = -Infinity;
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        const y = walkSurfaceAt(x + i * r * 0.7, z + j * r * 0.7);
        if (y > best) best = y;
      }
    }
    return best;
  };

  return {
    group: root,
    meshes,
    lights: lightObjects,
    emitters,
    banners,
    pois,
    beautyShots,
    stationSites,
    getBeautyShots: () => beautyShots,
    walkSurfaceAt,
    walkSurfaceMaxInCircle,
    floatLedger,
    roadStats,
    litter: litterStats,
    masses: massStats,
    anchors: anchorStats,
    routes: routeStats,
    vigil: vigilStats,
    procession: processionStats,
    crosses: crossStats,
    authoredLandmarks,
    stats() {
      let tris = 0;
      for (const m of meshes) {
        const g = m.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
      return {
        meshes: meshes.length,
        triangles: Math.round(tris),
        lights: lightObjects.length,
        emitters: emitters.length,
        stations: stationSites.length,
        pois: pois.length,
      };
    },
  };
}
