#!/usr/bin/env node
/* ============================================================
   BLACKSAND - does a SMALL caster reach the frame?

   The round-11 blind art director ranked this first, at high
   confidence in the symptom:

     "Small and mid-size props are missing from the shadow pass
      entirely. The clearest case: two dead scrub bushes in full sun,
      on open sand, casting nothing."

   Prior measurement says the caster set is complete: castShadow is
   true on shrub, thorn, deadbrush, tussock, reed and crop, and none of
   them has an LOD that could fall back to a non-casting impostor
   inside the shadow distance. Both cannot be true of the same image,
   so one of three things is happening:

     1. the flag is set and the shadow is nonetheless absent from the
        depth pass (an instancing, alpha or texel-footprint fault);
     2. the shadow is in the depth pass and lands under the caster's
        own silhouette, where no eye-height camera can see it;
     3. the reviewer is wrong.

   This separates them, and the separation is the whole design.

   THE A/B. Toggling sun.castShadow answers a different question - it
   removes terrain self-shadowing, every other caster in frame and the
   object's own self-shading all at once. What is being asked here is
   whether THIS OBJECT is in the caster set, so the toggle is the
   target's own mesh flag with the sun left alone. Everything that
   moves between the two captures is then attributable to one object.
   sun.castShadow is reported beside it as the headline the brief asks
   for, and the gap between the two numbers is itself informative.

   THE STATIONS. Four cameras per target, and they exist to tell fault
   1 from fault 2:

     cross   eye height, perpendicular to the sun's ground azimuth.
             The shadow runs across the frame - the most visible an
             eye-height camera can make it.
     down    eye height, sun behind the camera. The shadow points
             directly away and hides behind its own caster. This is
             the framing a player walking away from the sun gets, and
             it is where a small caster's shadow is least visible.
     anti    eye height, looking into the sun. The shadow runs toward
             the camera and is foreshortened under the object.
     top     twelve metres up, looking straight down. The shadow
             CANNOT hide from here. If a caster moves pixels at `top`
             and moves none at `cross`, the shadow exists and the
             reviewer is reading the image correctly.

   EXPOSURE IS PINNED. The auto-exposure meter reacts to the frame's
   own luminance, so removing shadows brightens the frame, which moves
   the exposure, which moves EVERY pixel. A/B with the meter live and
   the answer is a few percent of nothing wearing the shape of a
   result. It is settled with the meter on, read back, then frozen.

   Usage:
     node scripts/blacksand-caster-probe.mjs
     node scripts/blacksand-caster-probe.mjs --kind deadbrush --sites 4
     node scripts/blacksand-caster-probe.mjs --kind crate,post
     node scripts/blacksand-caster-probe.mjs --sun            (also A/B the sun)
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) args[k] = true;
      else { args[k] = n; i += 1; }
    } else args._.push(t);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 47600 + (process.pid % 2000));
const BASE = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE}/games/blacksand.html?qa=1&quality=${args.quality || "ultra"}`;
const WIDTH = Number(args.width || 1280);
const HEIGHT = Number(args.height || 720);
const SITES = Number(args.sites || 3);
const TOD = Number(args.tod || 11.2);
const RANGE = Number(args.range || 6);
const COLS = Number(args.cols || 150);
const KINDS = String(args.kind && args.kind !== true ? args.kind : "deadbrush,crate,post")
  .split(",").map((s) => s.trim()).filter(Boolean);

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const res = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* The route pattern is a REGEX, not a glob: boot.js pins every module
   as `render.js?v=<BUILD>` and a Playwright glob stops matching the
   moment a query string appears. The interception is asserted after
   boot, because a route that silently never fires prints a clean table
   of identical numbers that reads exactly like a disproved hypothesis. */
const MODULE_RE = /\/assets\/js\/blacksand\/[a-z0-9_-]+\.js(\?|$)/i;

async function installRewrite(page, edits) {
  const seen = new Set();
  if (!edits || !edits.length) return () => seen;
  await page.route(MODULE_RE, async (route) => {
    const url = new URL(route.request().url());
    const file = path.basename(url.pathname);
    const mine = edits.filter((e) => e.file === file);
    if (!mine.length) return route.fallback();
    let body = await readFile(path.join(root, "assets/js/blacksand", file), "utf8");
    for (const e of mine) {
      if (body.indexOf(e.from) < 0) {
        throw new Error(`rewrite anchor not found in ${file}: ${JSON.stringify(e.from)}`);
      }
      body = body.split(e.from).join(e.to);
    }
    seen.add(file);
    return route.fulfill({ status: 200, contentType: "text/javascript", body });
  });
  return () => seen;
}

/* The candidate mechanism, expressed as the smallest possible edit.
 *
 * The PCSS blocker search is a Vogel spiral of BS_PCSS_SEARCH taps over
 * a disc of BS_PCSS_MAX texels, and `bsF` starts at 0.5 - so the
 * innermost tap sits at sqrt(0.5/12) * 26 = 5.3 texels from the sample
 * point, and NOTHING samples the point itself. Starting bsF at zero
 * makes tap 0 land at radius zero, which is the plain "is there an
 * occluder directly along this sun ray" test. */
const CENTRE_TAP = [{
  file: "render.js",
  from: "float bsF = float( bsI ) + 0.5;",
  to: "float bsF = float( bsI );",
}];

/* Named receiver-side variants, for bisecting a size-dependent
   dropout. Each is the smallest edit that removes ONE candidate. */
const EDITS = {
  centre: CENTRE_TAP,
  // normalBias offsets the shadow LOOKUP along the receiver's normal,
  // in metres. It erodes a shadow from its edges inward by roughly
  // bias/tan(elevation), which is a fixed distance - so it costs a
  // three-metre shadow a few percent and a sixty-centimetre one most
  // of what it has.
  nobias: [{
    file: "render.js",
    from: "light.shadow.normalBias = clamp(texelWorld * 1.75, 0.02, 0.7);",
    to: "light.shadow.normalBias = clamp(texelWorld * 0.05, 0.005, 0.7);",
  }],
  // The blocker search disc. 26 texels is 1.28m at the near cascade,
  // sampled by 12 taps whose innermost sits 26cm out - and finding no
  // blocker returns FULLY LIT.
  search3: [{
    file: "render.js",
    from: "vec2 bsSearch = bsTexel * float( BS_PCSS_MAX );",
    to: "vec2 bsSearch = bsTexel * 3.0;",
  }],
  /* Bypass the whole PCSS block with a single point test - the plain
     "is there an occluder along this sun ray" question, no blocker
     search, no penumbra estimate, no early-out to fully lit. If a small
     caster's shadow arrives under this and not under the shipped
     filter, the filter is the fault; if it does not arrive either, the
     fault is downstream of the shadow lookup entirely. */
  /* Pin the filter radius at its floor. If a small caster's shadow
     comes back, the PENUMBRA ESTIMATE is what is spreading it into the
     lit ground around it; if it does not, the fault is the blocker
     search's early-out to fully lit. */
  width: [{
    file: "render.js",
    from: "( shadowCoord.z - bsAvg ) * shadowRadius, 0.55, float( BS_PCSS_MAX ) );",
    to: "( shadowCoord.z - bsAvg ) * 0.0, 0.55, float( BS_PCSS_MAX ) );",
  }],
  // Grime off, for the wall-base profile.
  nogrime: [{
    file: "structures.js",
    from: "const GRIME_FLOOR = 0.78;",
    to: "const GRIME_FLOOR = 1.0;",
  }],
  centrewidth: [
    { file: "render.js", from: "float bsF = float( bsI ) + 0.5;", to: "float bsF = float( bsI );" },
    {
      file: "render.js",
      from: "( shadowCoord.z - bsAvg ) * shadowRadius, 0.55, float( BS_PCSS_MAX ) );",
      to: "( shadowCoord.z - bsAvg ) * 0.0, 0.55, float( BS_PCSS_MAX ) );",
    },
  ],
  point: [{
    file: "render.js",
    from: "if ( bsDepthCount < 0.5 ) {",
    to: "if ( true ) { shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ); }"
      + " else if ( bsDepthCount < 0.5 ) {",
  }],
  // Both of the above, to see whether they are one fault or two.
  both: [
    {
      file: "render.js",
      from: "light.shadow.normalBias = clamp(texelWorld * 1.75, 0.02, 0.7);",
      to: "light.shadow.normalBias = clamp(texelWorld * 0.05, 0.005, 0.7);",
    },
    {
      file: "render.js",
      from: "vec2 bsSearch = bsTexel * float( BS_PCSS_MAX );",
      to: "vec2 bsSearch = bsTexel * 3.0;",
    },
    { file: "render.js", from: "float bsF = float( bsI ) + 0.5;", to: "float bsF = float( bsI );" },
  ],
};

/* ------------------------------------------------------------------
   Page-side rig.
   ------------------------------------------------------------------ */
function installRig() {
  const T = window.__BS;
  const THREE = T.THREE;
  const W = window;

  W.__CP = {
    _dir: new THREE.Vector3(),
    _shot: null,

    sun() { return T.ctx.sky.sunDirection.clone().normalize(); },

    /** Is this point in full sun, offset along `n` to clear its own surface? */
    sunlit(point, n) {
      const physics = T.ctx.physics;
      const p = point.clone().addScaledVector(n, 0.06);
      return !physics.raycast(p, W.__CP.sun(), 500, {
        layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
      }).hit;
    },

    /**
     * Open ground, flat, sunlit, with nothing solid inside `clear`.
     *
     * The clearance test is what makes the A/B attributable: if a wall
     * or a vehicle is inside the frame, toggling a merged mesh's
     * caster flag moves pixels that have nothing to do with the object
     * under test.
     */
    openAt(x, z, clear, self = 0) {
      const physics = T.ctx.physics;
      const terrain = T.ctx.terrain;
      const h = terrain.heightAt(x, z);
      let lo = h; let hi = h;
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2.2, 2.2], [-2.2, -2.2]]) {
        const y = terrain.heightAt(x + dx, z + dz);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      if (hi - lo > 0.5) return null;
      const p = new THREE.Vector3(x, h + 0.2, z);
      if (physics.raycast(p, W.__CP.sun(), 500, {
        layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
      }).hit) return null;
      const mask = physics.LAYER.STATIC | physics.LAYER.VEHICLE | physics.LAYER.DYNAMIC;
      for (let a = 0; a < 16; a += 1) {
        const th = (a / 16) * Math.PI * 2;
        const d = new THREE.Vector3(Math.cos(th), 0.04, Math.sin(th)).normalize();
        const hit = physics.raycast(p, d, clear, { layer: mask });
        // `self` skips the target's own collider, which a ray started
        // at its centre hits first every time - the reason the first
        // pass of this scan reported zero crates in the whole map.
        if (hit.hit && hit.distance > self) return null;
      }
      return h;
    },

    /**
     * Foliage instances of one species, read off the InstancedMesh
     * itself rather than through samplePositions().
     *
     * The mesh is the only place the TRUE world height of an instance
     * is available - scale, yScale and the geometry's own bounding box
     * all multiply together - and the height is the whole question
     * here, because it sets how far the shadow reaches out from under
     * the plant.
     */
    findFoliage(species, want, clear) {
      const mesh = T.ctx.render.scene.getObjectByName(`foliage-${species}`);
      if (!mesh || !mesh.isInstancedMesh) return [];
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const m = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      const out = [];
      const total = mesh.instanceMatrix.count;
      // Deterministic stride, not a random draw: the same instances
      // must be picked on every run or an A/B is comparing plants.
      const step = Math.max(1, Math.floor(total / 400));
      for (let i = 0; i < total && out.length < want * 4; i += step) {
        mesh.getMatrixAt(i, m);
        m.decompose(pos, quat, scl);
        const ground = W.__CP.openAt(pos.x, pos.z, clear);
        if (ground === null) continue;
        if (Math.abs(pos.y - ground) > 0.6) continue;
        const surf = T.ctx.physics.raycast(
          new THREE.Vector3(pos.x, ground + 20, pos.z), new THREE.Vector3(0, -1, 0), 40,
          { layer: T.ctx.physics.LAYER.TERRAIN });
        if (!surf.hit || surf.surface !== "sand") continue;
        const top = bb.max.y * scl.y;
        const radius = Math.max(Math.abs(bb.max.x), Math.abs(bb.min.x)) * scl.x;
        if (top < 0.25) continue;         // below the plausible-caster floor
        out.push({
          kind: species,
          mesh: mesh.name,
          centre: [pos.x, ground, pos.z],
          top,
          radius,
          index: i,
        });
      }
      const picked = [];
      for (const s of out) {
        if (picked.every((p) => Math.hypot(p.centre[0] - s.centre[0],
          p.centre[2] - s.centre[2]) > 60)) picked.push(s);
        if (picked.length >= want) break;
      }
      /* How far to the nearest OTHER plant of the same species. The
         caster toggle is on the whole InstancedMesh, so every sibling
         inside the disc contributes to the same number; without this
         there is no way to know whether a strong reading is one bush
         or a thicket. samplePlacements clusters seven per stand at 12m
         spread, so a genuine singleton is rare and has to be reported
         rather than assumed. */
      for (const p of picked) {
        let best = Infinity;
        for (let i = 0; i < total; i += 1) {
          mesh.getMatrixAt(i, m);
          const dx = m.elements[12] - p.centre[0];
          const dz = m.elements[14] - p.centre[2];
          const dd = Math.hypot(dx, dz);
          if (dd > 0.01 && dd < best) best = dd;
        }
        p.neighbour = best;
      }
      return picked;
    },

    /**
     * Small built props, enumerated through PHYSICS COLLIDERS.
     *
     * A mesh name names the draw call here, not the object -
     * structures.js merges by material AND cell - so hunting for a
     * crate in the scene graph returns a guard tower. A collider
     * carries the half-extents and the SURFACE the piece was placed
     * with, which is enough to name the archetype exactly.
     */
    findProps(kind, want, clear) {
      const physics = T.ctx.physics;
      const out = [];
      for (const c of physics.colliders) {
        if (!c.active) continue;
        const h = c.halfExtents;
        const foot = Math.max(h.x, h.z);
        const thin = Math.min(h.x, h.z);
        let ok = false;
        if (kind === "crate") {
          // crate()'s exact signature: a wooden box with square x/y and
          // a depth within 15% of them. Without the squareness test the
          // scan returns 0.84 x 0.20 x 0.88 planks.
          ok = c.surface === "wood" && Math.abs(h.x - h.y) <= 0.005
            && Math.max(h.x, h.y, h.z) <= 0.56 && Math.min(h.x, h.y, h.z) >= 0.28;
        } else if (kind === "post") {
          // Tall and thin: a bollard, a signpost, a fence stake. The
          // aspect test is what keeps walls and barriers out.
          ok = thin <= 0.30 && h.y >= 0.7 && h.y >= foot * 1.6 && foot <= 0.45;
        }
        if (!ok) continue;
        const base = c.center.y - h.y;
        const ground = W.__CP.openAt(c.center.x, c.center.z, clear,
          Math.hypot(h.x, h.z) + 0.25);
        if (ground === null) continue;
        if (Math.abs(base - ground) > 0.6) continue;
        if (!W.__CP.sunlit(new THREE.Vector3(c.center.x, c.center.y + h.y, c.center.z),
          new THREE.Vector3(0, 1, 0))) continue;
        out.push({
          kind,
          mesh: null,
          surface: c.surface,
          centre: [c.center.x, ground, c.center.z],
          top: (c.center.y + h.y) - ground,
          radius: Math.hypot(h.x, h.z),
          half: h.toArray(),
        });
        if (out.length >= want * 4) break;
      }
      const picked = [];
      for (const s of out) {
        if (picked.every((p) => Math.hypot(p.centre[0] - s.centre[0],
          p.centre[2] - s.centre[2]) > 40)) picked.push(s);
        if (picked.length >= want) break;
      }
      return picked;
    },

    /**
     * A ladder of plain grey cubes on open flat sand.
     *
     * The shipped props cannot answer "is there a caster size below
     * which the shadow stops arriving", because structures.js merges by
     * material AND cell: the only caster flag that exists is the one on
     * a merged bucket holding a whole town, so toggling it moves the
     * entire skyline. A cube per size, each its own mesh with its own
     * flag, isolates the variable exactly - same material, same ground,
     * same cascade, same frame, one number changing.
     *
     * Solid opaque boxes on purpose. If these cast and the bushes do
     * not, the fault is in the alpha path; if these do not cast either,
     * it is in the shadow system and has nothing to do with foliage.
     */
    buildLadder(site, sizes) {
      W.__CP.clearLadder();
      const sun = W.__CP.sun();
      const sd = new THREE.Vector3(-sun.x, 0, -sun.z).normalize();
      const perp = new THREE.Vector3(-sd.z, 0, sd.x);
      const group = new THREE.Group();
      group.name = "cp-ladder";
      const out = [];
      // Spread along the axis PERPENDICULAR to the sun so no cube can
      // stand in another's shadow whatever the elevation is.
      let offset = 0;
      sizes.forEach((s, i) => {
        offset += s * 0.5 + 2.5;
        const x = site[0] + perp.x * offset;
        const z = site[2] + perp.z * offset;
        const g = T.heightAt(x, z);
        const m = new THREE.MeshStandardMaterial({
          roughness: 0.85, metalness: 0.0, dithering: true,
        });
        m.color.setRGB(0.32, 0.32, 0.32, THREE.LinearSRGBColorSpace);
        const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), m);
        box.name = `cp-cube-${i}`;
        box.position.set(x, g + s * 0.5, z);
        box.castShadow = true;
        box.receiveShadow = true;
        box.userData.qaOpaque = false;
        group.add(box);
        out.push({
          kind: `cube-${s}m`,
          mesh: box.name,
          centre: [x, g, z],
          top: s,
          radius: s * 0.708,
        });
        offset += s * 0.5;
      });
      T.ctx.render.scene.add(group);
      W.__CP._ladder = group;
      return out;
    },

    clearLadder() {
      if (!W.__CP._ladder) return;
      T.ctx.render.scene.remove(W.__CP._ladder);
      W.__CP._ladder.traverse((o) => {
        if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
      });
      W.__CP._ladder = null;
    },

    /** Open flat sunlit sand, spread over the map. */
    findOpenSites(want, clear) {
      const physics = T.ctx.physics;
      const out = [];
      for (let x = -420; x <= 420 && out.length < want * 4; x += 27) {
        for (let z = -420; z <= 420 && out.length < want * 4; z += 27) {
          const h = W.__CP.openAt(x, z, clear);
          if (h === null) continue;
          const surf = physics.raycast(new THREE.Vector3(x, h + 25, z),
            new THREE.Vector3(0, -1, 0), 50, { layer: physics.LAYER.TERRAIN });
          if (!surf.hit || surf.surface !== "sand") continue;
          out.push([x, h, z]);
        }
      }
      const picked = [];
      for (const s of out) {
        if (picked.every((p) => Math.hypot(p[0] - s[0], p[2] - s[2]) > 150)) picked.push(s);
        if (picked.length >= want) break;
      }
      return picked;
    },

    /**
     * Luminance up a sunlit wall, as a function of height above the
     * ground the wall stands on.
     *
     * The round-11 critic: "the wall base has a band that is BRIGHTER
     * than the wall above it", confidence high. applyGroundGrime is a
     * multiply by GRIME_FLOOR + (1-GRIME_FLOOR)*smoothstep over the
     * bottom 1.6m, clamped, applied once per merged bucket - so it is
     * monotone in [0.78, 1] and cannot brighten anything. Either the
     * band comes from somewhere else or the reviewer is reading a
     * different feature as a band.
     *
     * Pixels are classified by PHYSICS SURFACE and their height is
     * measured against terrain.heightAt at their own xz - the same
     * quantity applyGroundGrime uses - so the profile is directly
     * comparable to the curve the code claims to draw.
     */
    async wallProfile(cols, bands, edge) {
      const cam = T.ctx.render.camera;
      const physics = T.ctx.physics;
      const terrain = T.ctx.terrain;
      const sun = W.__CP.sun();
      const img = W.__CP.grab();
      const px = img.data;
      const out = bands.map(() => []);
      const hits = [];
      const ROWS = Math.max(2, Math.round((cols * img.h) / img.w));
      const MASONRY = new Set(["concrete", "blockwall", "plaster"]);
      for (let iy = 0; iy < ROWS; iy += 1) {
        for (let ix = 0; ix < cols; ix += 1) {
          const ndcX = ((ix + 0.5) / cols) * 2 - 1;
          const ndcY = 1 - ((iy + 0.5) / ROWS) * 2;
          const dir = W.__CP._dir.set(ndcX, ndcY, 0.5).unproject(cam)
            .sub(cam.position).normalize();
          const ph = physics.raycast(cam.position, dir, 45, {
            layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
          });
          if (!ph.hit || ph.terrain || !MASONRY.has(ph.surface)) continue;
          if (Math.abs(ph.normal.y) > 0.25) continue;        // a face, not a coping
          if (ph.normal.dot(sun) < 0.25) continue;           // sunlit faces only
          const above = ph.point.clone().addScaledVector(ph.normal, 0.06);
          if (physics.raycast(above, sun, 300, {
            layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
          }).hit) continue;
          /* Height above the ground, measured two ways, because the
             first one can lie.
             `terrain` is what applyGroundGrime uses, so it is the one
             the profile has to be stated in. But a physics collider is
             an oriented box that need not agree with the mesh drawn
             inside it, and a ray grazing the bottom of a wall's box
             returns a wall hit for a pixel that renders the sunlit sand
             behind it. That contaminates exactly the band under test
             with the brightest surface in the game, so any sample
             within `edge` of the collider's own base is dropped. */
          const h = ph.point.y - terrain.heightAt(ph.point.x, ph.point.z);
          if (edge > 0 && ph.collider) {
            const cb = ph.collider.center.y - ph.collider.halfExtents.y;
            if (ph.point.y - cb < edge) continue;
          }
          let b = -1;
          for (let k = 0; k < bands.length; k += 1) {
            if (h >= (k === 0 ? -0.2 : bands[k - 1]) && h < bands[k]) { b = k; break; }
          }
          if (b < 0) continue;
          const sx = Math.min(img.w - 1, Math.floor((ndcX * 0.5 + 0.5) * img.w));
          const sy = Math.min(img.h - 1, Math.floor((1 - (ndcY * 0.5 + 0.5)) * img.h));
          const o = (sy * img.w + sx) * 4;
          out[b].push(0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]);
          if (b === 0) hits.push([sx, sy, ph.surface, ph.point.x, ph.point.y, ph.point.z]);
        }
      }
      return {
        bands: out.map((v) => {
          if (!v.length) return null;
          const s = v.slice().sort((a, b) => a - b);
          return { n: v.length, med: s[Math.floor(s.length / 2)] };
        }),
        hits,
        // The frame with every band-0 sample painted, so the population
        // can be looked at instead of trusted. Two probes on this
        // project have been retracted for measuring something other
        // than what their name said.
        marked: (() => {
          if (!hits.length) return null;
          const cv = document.createElement("canvas");
          cv.width = img.w; cv.height = img.h;
          const g2 = cv.getContext("2d");
          const id = g2.createImageData(img.w, img.h);
          id.data.set(img.data);
          for (const [hx, hy] of hits) {
            for (let dy = -2; dy <= 2; dy += 1) {
              for (let dx = -2; dx <= 2; dx += 1) {
                const x = hx + dx; const y = hy + dy;
                if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
                const o2 = (y * img.w + x) * 4;
                id.data[o2] = 255; id.data[o2 + 1] = 0; id.data[o2 + 2] = 255;
              }
            }
          }
          g2.putImageData(id, 0, 0);
          return cv.toDataURL("image/png");
        })(),
      };
    },

    /**
     * Which mesh actually draws a given set of pixels.
     *
     * The physics classifier names the object a RAY hits, and at a
     * wall's base the ray and the pixel need not agree - a collider is
     * an oriented box and the geometry inside it can be inset, so a
     * "concrete wall" hit can land on a pixel showing something else
     * entirely. Hiding one mesh at a time and watching the pixels is
     * the classifier of last resort, and it cannot be fooled.
     */
    identifyPixels(hits) {
      const names = [];
      T.ctx.render.scene.traverse((o) => {
        if ((o.isMesh || o.isInstancedMesh) && o.visible && /^(structures|foliage)-/.test(o.name)) {
          names.push(o);
        }
      });
      const lumaAt = (img) => {
        let s = 0;
        for (const [x, y] of hits) {
          const o = (y * img.w + x) * 4;
          s += 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
        }
        return s / Math.max(1, hits.length);
      };
      W.__CP.freeze(3);
      const base = lumaAt(W.__CP.grab());
      const out = [];
      // Grouped by name, because structures.js buckets by material AND
      // cell - there are many meshes called structures-concrete and
      // hiding one of them proves nothing.
      const groups = new Map();
      for (const o of names) {
        if (!groups.has(o.name)) groups.set(o.name, []);
        groups.get(o.name).push(o);
      }
      for (const [name, list] of groups) {
        for (const o of list) o.visible = false;
        W.__CP.freeze(3);
        const after = lumaAt(W.__CP.grab());
        for (const o of list) o.visible = true;
        if (Math.abs(after - base) > 1.0) out.push({ name, base, after });
      }
      W.__CP.freeze(3);
      return { base, movers: out };
    },

    /** Which scene meshes carry this target's shadow contribution. */
    casterMeshes(target) {
      const names = [];
      T.ctx.render.scene.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        if (target.mesh) { if (o.name === target.mesh) names.push(o.name); return; }
        // A merged structures bucket. Only the buckets that can hold
        // this archetype are toggled, and the clearance test above has
        // already guaranteed nothing else of that material is in frame.
        if (/^structures-/.test(o.name) && o.name !== "structures-contact") names.push(o.name);
      });
      return names;
    },

    setCasters(names, on) {
      const set = new Set(names);
      T.ctx.render.scene.traverse((o) => {
        if ((o.isMesh || o.isInstancedMesh) && set.has(o.name)) o.castShadow = on;
      });
    },

    /* sky.js writes render.sun.castShadow inside updateLighting(),
       which update() calls `if (moved)` while the weather easing is
       still settling. It has converged by the time this runs, but a
       silently reverted flag prints a clean table of zeroes that reads
       exactly like a disproof, so the wanted state is stored and
       re-asserted before every frame rather than set once. */
    _sunWant: null,
    applySun() {
      if (W.__CP._sunWant === null) return;
      const r = T.ctx.render;
      r.sun.castShadow = W.__CP._sunWant;
      const far = r.scene.getObjectByName("bs-sun-cascade-1");
      if (far) far.castShadow = W.__CP._sunWant;
    },
    setSunShadow(on) {
      W.__CP._sunWant = on;
      W.__CP.applySun();
    },

    /**
     * Point a camera at the target from one of four stations.
     *
     * Azimuths are defined against the SUN's ground direction, not
     * against world axes, because the whole question is where the
     * shadow falls relative to the eye.
     */
    stage(target, station, range) {
      const sun = W.__CP.sun();
      const elev = Math.asin(Math.max(0.05, sun.y));
      // Ground direction the shadow runs in.
      const sd = new THREE.Vector3(-sun.x, 0, -sun.z).normalize();
      const perp = new THREE.Vector3(-sd.z, 0, sd.x);
      const c = new THREE.Vector3().fromArray(target.centre);
      const aim = new THREE.Vector3(c.x, c.y + target.top * 0.45, c.z);

      let eye;
      let fov = 50;
      if (station === "top") {
        eye = new THREE.Vector3(c.x + sd.x * 0.6, c.y + 12, c.z + sd.z * 0.6);
        // Straight down needs a nudge or the up vector is degenerate.
        aim.set(c.x + sd.x * 0.35, c.y, c.z + sd.z * 0.35);
        fov = 42;
      } else {
        // cross: perpendicular to the shadow, so it runs across frame.
        // down:  sun behind the eye, shadow pointing away and hiding.
        // anti:  looking into the sun, shadow foreshortened toward us.
        const dirs = {
          cross: perp,
          down: new THREE.Vector3(-sd.x, 0, -sd.z),
          anti: sd,
        };
        const d = dirs[station] || perp;
        eye = new THREE.Vector3(c.x + d.x * range, 0, c.z + d.z * range);
        eye.y = T.heightAt(eye.x, eye.z) + 1.65;
        // Narrow enough that the object and its shadow fill a useful
        // share of the frame at this range. A movedPct measured over a
        // frame that is 95% empty sky is a number about the sky.
        fov = 2 * Math.atan((Math.max(1.6, target.top * 1.6)) / range) * 180 / Math.PI;
        fov = Math.min(60, Math.max(20, fov));
      }
      T.lookAt(eye.toArray(), aim.toArray(), fov);
      return {
        elevDeg: (elev * 180) / Math.PI,
        reach: target.top / Math.tan(elev),
        fov,
      };
    },

    /**
     * The drawing buffer as raw RGBA, read SYNCHRONOUSLY.
     *
     * captureDataURL + new Image() is the house pattern and it cannot
     * be used for an A/B, because decoding a data URL is asynchronous:
     * the await yields to the event loop, the game's own
     * requestAnimationFrame callback runs, and headless Chromium
     * throttles rAF to about 1fps so that one callback arrives with a
     * dt of a whole second, clamped to 0.25. A quarter second of wind,
     * cloud drift and LOD re-bucketing therefore lands BETWEEN the two
     * captures. Measured: a null A/B - two captures with nothing
     * changed at all - moved 86% of the frame and 96% of the SKY.
     *
     * gl.readPixels off the preserved drawing buffer is synchronous, so
     * a whole A/B can run inside one evaluate() with no yield in it and
     * nothing can tick between the halves.
     */
    grab() {
      const gl = T.ctx.render.renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // readPixels is bottom-up; flip so y indexes the way the raycast
      // grid does.
      const data = new Uint8Array(w * h * 4);
      const row = w * 4;
      for (let y = 0; y < h; y += 1) {
        data.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      }
      return { w, h, data };
    },

    /**
     * Run one complete A/B with no yield in it.
     *
     * `flip` is called with true then false; the caller decides what
     * that means (a mesh caster flag, or the sun's). Both captures see
     * the same instant of world time because dt is zero throughout and
     * because nothing between them can give the event loop a turn.
     */
    ab(flip, frames) {
      flip(true);
      for (let i = 0; i < frames; i += 1) { W.__CP.applySun(); T.renderOnce(0); }
      const on = W.__CP.grab();
      flip(false);
      for (let i = 0; i < frames; i += 1) { W.__CP.applySun(); T.renderOnce(0); }
      const off = W.__CP.grab();
      flip(true);
      for (let i = 0; i < frames; i += 1) { W.__CP.applySun(); T.renderOnce(0); }
      return { on, off };
    },

    /**
     * The two captures and their difference at a stated gain, as data
     * URLs.
     *
     * Every statistic in this file is one I wrote today, and this
     * project has twice built a metric that measured itself. Looking
     * at the frames is the check on that, and an amplified diff is the
     * only way to see where a two-count change actually lands.
     */
    dump(pair, gain) {
      const a = pair.on; const b = pair.off;
      if (!a || !b || a.w !== b.w) return null;
      const cv = document.createElement("canvas");
      cv.width = a.w; cv.height = a.h;
      const g2 = cv.getContext("2d");
      const out = g2.createImageData(a.w, a.h);
      for (let i = 0; i < a.w * a.h; i += 1) {
        const o = i * 4;
        for (let c = 0; c < 3; c += 1) {
          out.data[o + c] = Math.min(255, Math.abs(b.data[o + c] - a.data[o + c]) * gain);
        }
        out.data[o + 3] = 255;
      }
      g2.putImageData(out, 0, 0);
      const diff = cv.toDataURL("image/png");
      const toUrl = (img) => {
        const c2 = document.createElement("canvas");
        c2.width = img.w; c2.height = img.h;
        const gg = c2.getContext("2d");
        const id = gg.createImageData(img.w, img.h);
        id.data.set(img.data);
        gg.putImageData(id, 0, 0);
        return c2.toDataURL("image/png");
      };
      return { on: toUrl(a), off: toUrl(b), diff };
    },

    /**
     * Diff the held capture against a fresh one and attribute the
     * difference.
     *
     * Classification is by physics raycast on a coarse grid, for the
     * reason the figure/ground round paid for: three's Raycaster
     * cannot finish against a merged town with no BVH, and a physics
     * hit names the OBJECT rather than the draw call.
     */
    diff(pair, target, cols) {
      const a = pair.on; const b = pair.off;
      if (!a || !b || a.w !== b.w || a.h !== b.h) return null;
      const n = a.w * a.h;
      const L = (p, o) => 0.2126 * p[o] + 0.7152 * p[o + 1] + 0.0722 * p[o + 2];

      let moved2 = 0; let moved8 = 0; let sum = 0; let peak = 0;
      let minX = a.w; let maxX = -1; let minY = a.h; let maxY = -1;
      const delta = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        const o = i * 4;
        // Signed: shadows make the A capture DARKER than the B one, so
        // the sign says whether the caster added shade or removed it.
        const d = L(b.data, o) - L(a.data, o);
        delta[i] = d;
        const ad = Math.abs(d);
        if (ad >= 2) {
          moved2 += 1; sum += ad;
          if (ad > peak) peak = ad;
          const x = i % a.w; const y = (i / a.w) | 0;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (ad >= 8) moved8 += 1;
      }

      /* ---- coarse classification grid ----
       *
       * Foliage registers NO physics collider, so a ray through a bush
       * reports the sand behind it and the plant's own pixels arrive
       * classified as ground. That matters more than it sounds: the
       * plant's own pixels are where a caster toggle moves the MOST
       * value, because the foliage shader gates its translucency on
       * the shadow lookup, so an unshadowed leaf is both unshaded and
       * fully backlit. Counting those as ground would report a bush
       * that shadows nothing but itself as a strong ground caster.
       *
       * The object is excluded analytically instead, by an upright
       * bounding cylinder the ray is tested against before the physics
       * hit is trusted. Exact enough at this scale and it costs six
       * multiplies.
       */
      const cam = T.ctx.render.camera;
      const physics = T.ctx.physics;
      const c = new THREE.Vector3().fromArray(target.centre);
      const sun = W.__CP.sun();
      const sd = new THREE.Vector3(-sun.x, 0, -sun.z).normalize();
      /* The hull was radius + 0.15m and that was swallowing the
         finding: a small caster's shadow starts AT its own outline, so
         a 15cm cuff around the silhouette is most of the shadow. It is
         now 2cm - just enough to keep the object's own edge pixels out
         - and the disc is scaled to the shadow's own geometric reach
         rather than to a fixed four metres, so the same fraction of the
         measured area is shadow whatever size the caster is. */
      const elevR = Math.asin(Math.max(0.05, sun.y));
      const reach = target.top / Math.tan(elevR);
      const RAD = target.radius + 0.02;
      const DISC = target.radius + reach * 2.2;

      const hitsHull = (o, dir, maxT) => {
        // Infinite-cylinder test in xz, then clip to the object's height.
        const ox = o.x - c.x; const oz = o.z - c.z;
        const aa = dir.x * dir.x + dir.z * dir.z;
        if (aa < 1e-9) return false;
        const bb = 2 * (ox * dir.x + oz * dir.z);
        const cc = ox * ox + oz * oz - RAD * RAD;
        const disc = bb * bb - 4 * aa * cc;
        if (disc < 0) return false;
        const sq = Math.sqrt(disc);
        let t0 = (-bb - sq) / (2 * aa);
        let t1 = (-bb + sq) / (2 * aa);
        if (t1 < 0) return false;
        if (t0 < 0) t0 = 0;
        if (t0 > maxT) return false;
        // Any part of the entry-to-exit span inside the height band.
        const y0 = o.y + dir.y * t0;
        const y1 = o.y + dir.y * Math.min(t1, maxT);
        const lo = Math.min(y0, y1); const hi = Math.max(y0, y1);
        return hi >= c.y - 0.1 && lo <= c.y + target.top + 0.1;
      };

      const rows = Math.max(2, Math.round((cols * a.h) / a.w));
      const cls = {
        hull: { n: 0, moved: 0, sum: 0 },      // the object's own pixels
        disc: { n: 0, moved: 0, sum: 0 },      // ground within DISC, clear of it
        far: { n: 0, moved: 0, sum: 0 },       // ground beyond DISC
        other: { n: 0, moved: 0, sum: 0 },     // built geometry
        sky: { n: 0, moved: 0, sum: 0 },
      };
      let discSun = 0;                          // moved disc samples down-sun
      /* Where the shadow actually stops.
       *
       * Bands measured DOWN-SUN from the caster's outline, in units of
       * its own geometric reach (top / tan(elevation)). A caster whose
       * shadow is correct darkens bands 0 and 1 and stops; one whose
       * shadow is being eaten darkens only the first, and by how much
       * it falls off between the two says how much is being eaten. */
      const BANDS = [0.35, 0.7, 1.05, 1.6];
      const band = BANDS.map(() => ({ n: 0, moved: 0, sum: 0 }));
      for (let iy = 0; iy < rows; iy += 1) {
        for (let ix = 0; ix < cols; ix += 1) {
          const ndcX = ((ix + 0.5) / cols) * 2 - 1;
          const ndcY = 1 - ((iy + 0.5) / rows) * 2;
          const dir = W.__CP._dir.set(ndcX, ndcY, 0.5).unproject(cam)
            .sub(cam.position).normalize();
          const ph = physics.raycast(cam.position, dir, 90, {
            layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC
              | physics.LAYER.VEHICLE | physics.LAYER.DYNAMIC,
          });
          const sx = Math.min(a.w - 1, Math.floor((ndcX * 0.5 + 0.5) * a.w));
          const sy = Math.min(a.h - 1, Math.floor((1 - (ndcY * 0.5 + 0.5)) * a.h));
          const d = Math.abs(delta[sy * a.w + sx]);

          let key;
          let dsun = false;
          if (hitsHull(cam.position, dir, ph.hit ? ph.distance : 90)) key = "hull";
          else if (!ph.hit) key = "sky";
          else if (!ph.terrain) key = "other";
          else {
            const dx = ph.point.x - c.x; const dz = ph.point.z - c.z;
            const r = Math.hypot(dx, dz);
            key = r <= DISC ? "disc" : "far";
            dsun = dx * sd.x + dz * sd.z > 0;
          }
          cls[key].n += 1;
          if (d >= 2) {
            cls[key].moved += 1; cls[key].sum += d;
            if (key === "disc" && dsun) discSun += 1;
          }
          if (key === "disc" && dsun && ph.hit) {
            // Distance past the caster's own outline, along the sun's
            // ground axis, normalised by the reach.
            const along = ((ph.point.x - c.x) * sd.x + (ph.point.z - c.z) * sd.z);
            const t = (along - target.radius * 0.7) / Math.max(reach, 1e-3);
            for (let b = 0; b < BANDS.length; b += 1) {
              const lo = b === 0 ? 0 : BANDS[b - 1];
              if (t >= lo && t < BANDS[b]) {
                band[b].n += 1;
                if (d >= 2) { band[b].moved += 1; band[b].sum += d; }
                break;
              }
            }
          }
        }
      }

      return {
        w: a.w,
        h: a.h,
        movedPct: (100 * moved2) / n,
        moved8Pct: (100 * moved8) / n,
        meanDelta: moved2 ? sum / moved2 : 0,
        peakDelta: peak,
        bbox: maxX < 0 ? null : [minX, minY, maxX, maxY],
        cls,
        discSun,
        disc: DISC,
        band,
        bands: BANDS,
      };
    },

    /** Freeze the exposure meter at whatever it settled on. */
    pinExposure() {
      const g = T.report().grade;
      T.grade({ autoExposure: false, exposure: g.exposure });
      return g.exposure;
    },
    unpinExposure() { T.grade({ autoExposure: true }); },

    /** Bring the frame to a steady state. Advances game time. */
    settle(frames) {
      W.__CP.applySun();
      T.advanceTime(1.0, 1 / 60);
      for (let i = 0; i < frames; i += 1) {
        W.__CP.applySun();
        T.renderOnce(1 / 60);
      }
      return T.report().frame;
    },

    /**
     * Re-render at FROZEN game time.
     *
     * This is the difference between a caster A/B and a nonsense one.
     * The first version of this probe advanced a second of simulation
     * between the two captures, and its own sky control caught it:
     * 0.25 to 26.8 percent of SKY pixels moved in a test that toggles a
     * bush. Nothing about a bush can touch the sky - what moved was the
     * cloud layer, which is driven off ctx.time, and with it the wind
     * phase that bends every plant in frame. Both captures have to be
     * the same instant of world time, with only the caster flag
     * different. dt = 0 leaves the shadow map to re-render (autoUpdate
     * is on) while ctx.time, the wind clock and the exposure damper all
     * stand still.
     */
    freeze(frames) {
      for (let i = 0; i < frames; i += 1) {
        W.__CP.applySun();
        T.renderOnce(0);
      }
      return T.report().frame;
    },

    /**
     * Does this object reach the DEPTH PASS at all?
     *
     * Everything else in this file measures the shadow after it has
     * been through the receiver: the PCSS filter, the normal bias, the
     * cascade blend and the grade all sit between the depth pass and a
     * frame pixel, and any of them could swallow a small caster. This
     * reads the shadow map itself, so it answers the one question those
     * cannot confound - is the geometry in the map.
     *
     * Only the patch of the map the object projects into is read. The
     * near cascade is 3072 square; a full readback is 37MB twice, and
     * a 160-texel window at 4.9cm per texel is 7.9m of ground, which
     * covers a two-metre bush and its throw several times over.
     */
    shadowTexels(target, names, half) {
      const R = T.ctx.render;
      const rt = R.sun.shadow.map;
      if (!rt) return null;
      const cam = R.sun.shadow.camera;
      const c = new THREE.Vector3().fromArray(target.centre);
      c.y += target.top * 0.5;
      const p = c.clone().project(cam);
      const cx = Math.round((p.x * 0.5 + 0.5) * rt.width);
      const cy = Math.round((p.y * 0.5 + 0.5) * rt.height);
      const x0 = Math.max(0, Math.min(rt.width - 2 * half, cx - half));
      const y0 = Math.max(0, Math.min(rt.height - 2 * half, cy - half));
      const n = 2 * half;
      const A = new Uint8Array(n * n * 4);
      const B = new Uint8Array(n * n * 4);
      const read = (buf) => R.renderer.readRenderTargetPixels(rt, x0, y0, n, n, buf);

      W.__CP.setCasters(names, true);
      T.renderOnce(0); T.renderOnce(0);
      read(A);
      W.__CP.setCasters(names, false);
      T.renderOnce(0); T.renderOnce(0);
      read(B);
      W.__CP.setCasters(names, true);
      T.renderOnce(0);

      let diff = 0;
      let nearer = 0;
      for (let i = 0; i < n * n; i += 1) {
        const o = i * 4;
        if (A[o] !== B[o] || A[o + 1] !== B[o + 1]
          || A[o + 2] !== B[o + 2] || A[o + 3] !== B[o + 3]) {
          diff += 1;
          // Packed depth is big-endian in RGBA; the high byte alone is
          // enough to say which capture holds the nearer occluder.
          if (A[o] < B[o]) nearer += 1;
        }
      }
      return {
        map: rt.width,
        window: n,
        inRange: p.x > -1 && p.x < 1 && p.y > -1 && p.y < 1 && p.z > -1 && p.z < 1,
        texels: diff,
        nearer,
        pct: (100 * diff) / (n * n),
        // What the object's silhouette OUGHT to occupy, at this
        // cascade's texel size, if every one of its texels were solid.
        expect: Math.round((Math.PI * target.radius * target.radius)
          / (((cam.right * 2) / rt.width) ** 2)),
      };
    },

    /**
     * One station, start to finish, inside a single synchronous call.
     *
     * Nothing here may await. The whole reason this function exists as
     * one lump rather than as the six evaluate() calls it started as is
     * that every await handed a rAF callback the chance to advance a
     * quarter second of world time in the middle of an A/B.
     */
    run(target, station, range, opts) {
      const info = W.__CP.stage(target, station, range);
      // Settle with the meter live, then freeze it: removing shadows
      // brightens the frame, the meter reacts, and every pixel in the
      // image moves for a reason that has nothing to do with casters.
      W.__CP.settle(10);
      const exposure = W.__CP.pinExposure();

      const names = W.__CP.casterMeshes(target);
      const nothing = () => {};
      const casters = (on) => W.__CP.setCasters(names, on);

      // The noise floor: an A/B whose flip does nothing at all. Every
      // number below is worth only what this one is not.
      const nulPair = W.__CP.ab(nothing, opts.frames);
      const out = {
        station,
        info,
        exposure,
        names,
        nul: W.__CP.diff(nulPair, target, opts.cols),
      };

      const abPair = W.__CP.ab(casters, opts.frames);
      out.self = W.__CP.diff(abPair, target, opts.cols);
      out.depth = W.__CP.shadowTexels(target, names, 80);

      if (opts.sun) {
        // The cascade patch is guarded on NUM_DIR_LIGHT_SHADOWS, so
        // dropping the sun's shadow recompiles every program in the
        // scene. Give it more frames than a caster toggle needs.
        const sunPair = W.__CP.ab((on) => W.__CP.setSunShadow(on), opts.frames + 8);
        W.__CP._sunWant = null;
        out.sun = W.__CP.diff(sunPair, target, opts.cols);
      }

      if (opts.dump) {
        out.nullImages = W.__CP.dump(nulPair, opts.gain);
        out.images = W.__CP.dump(abPair, opts.gain);
      }
      W.__CP.unpinExposure();
      return out;
    },
  };
  return true;
}

/* ------------------------------------------------------------------
   Harness.
   ------------------------------------------------------------------ */

async function bootPage(context, edits) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const seen = await installRewrite(page, edits);
  await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 180000 });
  await page.evaluate(() => {
    window.__BS.maximize();
    window.__BS.hideHud(true);
    window.__BS.hideViewmodel(true);
    const el = document.getElementById("bs-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  await page.evaluate(installRig);
  await page.evaluate((h) => window.__BS.setTimeOfDay(h), TOD);
  await page.evaluate(() => window.__BS.advanceTime(4, 1 / 60));
  const got = await seen();
  for (const f of new Set((edits || []).map((e) => e.file))) {
    if (!got.has(f)) throw new Error(`variant edit never reached the browser: ${f}`);
  }
  console.log(`variant: ${(edits || []).length} edit(s)`
    + ((edits || []).length ? ` applied to ${[...got].join(", ")}` : " (shipped)"));
  page.__bsErrors = errors;
  return page;
}

const STATIONS = ["cross", "down", "anti", "top"];

async function runTarget(page, target, opts) {
  const rows = [];
  for (const station of STATIONS) {
    rows.push(await page.evaluate((a) => window.__CP.run(a.t, a.s, a.r, a.o), {
      t: target,
      s: station,
      r: RANGE,
      o: {
        cols: COLS,
        frames: 4,
        sun: Boolean(opts.sun),
        dump: Boolean(opts.dump),
        gain: Number(opts.gain || 6),
      },
    }));
  }
  return rows;
}

const pct = (b) => (b.n ? (100 * b.moved) / b.n : 0);
const avg = (b) => (b.moved ? b.sum / b.moved : 0);

function fmt(d) {
  if (!d) return "(no capture)";
  const h = d.cls.hull; const s = d.cls.disc; const f = d.cls.far;
  // Sky is the exposure control. Nothing in a caster A/B can change a
  // sky pixel, so anything above zero here is the auto-exposure meter
  // still live and every other number on the row is worthless.
  const k = d.cls.sky;
  return `sky ${pct(k).toFixed(2).padStart(5)}%  frame ${d.movedPct.toFixed(2).padStart(6)}%  `
    // The object's own pixels. Non-zero here and zero on the disc is
    // the exact signature of "casts, but only onto itself".
    + `self ${pct(h).toFixed(1).padStart(5)}%/${String(h.n).padStart(4)} d${avg(h).toFixed(0).padStart(3)}  `
    // The finding: visible ground shadow around the object's feet.
    + `disc ${pct(s).toFixed(1).padStart(5)}%/${String(s.n).padStart(4)} d${avg(s).toFixed(0).padStart(3)}  `
    + `(dn-sun ${String(d.discSun).padStart(3)})  `
    + `far ${pct(f).toFixed(1).padStart(5)}%/${String(f.n).padStart(5)}`;
}

/** Down-sun shadow profile, in units of the caster's geometric reach. */
function profile(d) {
  if (!d || !d.band) return "";
  return d.band.map((b, i) => {
    const lo = i === 0 ? 0 : d.bands[i - 1];
    return `${lo.toFixed(2)}-${d.bands[i].toFixed(2)}: `
      + `${pct(b).toFixed(0).padStart(3)}%/${String(b.n).padStart(4)} d${avg(b).toFixed(0).padStart(3)}`;
  }).join("  ");
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--mute-audio"],
    });
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, colorScheme: "light",
    });
    const page = await bootPage(context, args.edit ? (EDITS[args.edit] || (() => { throw new Error(`unknown --edit ${args.edit}`); })()) : []);

    await page.evaluate((h) => window.__BS.setTimeOfDay(h), TOD);
    await page.evaluate(() => window.__BS.advanceTime(3, 1 / 60));
    const shadowInfo = await page.evaluate(() => {
      const T = window.__BS;
      const R = T.ctx.render;
      const s = R.sun.shadow;
      /* The round-2 bug in one line: updateShadowCamera() used to
         re-derive the sun's direction from sun.position, which it had
         itself moved on the previous frame, so the key light converged
         on a function of the camera's world coordinates - 39 degrees
         out in elevation. It is recorded as fixed. Nothing costs less
         than checking, and every station in this probe is placed from
         ctx.sky.sunDirection, so if the two disagree the whole rig is
         aimed at the wrong azimuth. */
      const key = R.sun.position.clone().sub(R.sun.target.position).normalize();
      const sky = T.ctx.sky.sunDirection.clone().normalize();
      const deg = (v) => (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI;
      const az = (v) => (Math.atan2(v.x, v.z) * 180) / Math.PI;
      return {
        sunCasts: R.sun.castShadow,
        mapSize: s.mapSize.toArray(),
        extent: s.camera.right,
        texelCm: ((s.camera.right * 2) / s.mapSize.x) * 100,
        normalBiasCm: s.normalBias * 100,
        radius: s.radius,
        intensity: R.sun.intensity,
        keyElev: deg(key),
        skyElev: deg(sky),
        keyAz: az(key),
        skyAz: az(sky),
        agree: key.dot(sky),
      };
    });
    console.log(`key light: elev ${shadowInfo.keyElev.toFixed(1)} vs sky ${shadowInfo.skyElev.toFixed(1)}  `
      + `azimuth ${shadowInfo.keyAz.toFixed(1)} vs ${shadowInfo.skyAz.toFixed(1)}  `
      + `dot ${shadowInfo.agree.toFixed(4)}  intensity ${shadowInfo.intensity.toFixed(2)}`);
    console.log("near cascade: "
      + `map ${shadowInfo.mapSize[0]}  extent +/-${shadowInfo.extent.toFixed(1)}m  `
      + `texel ${shadowInfo.texelCm.toFixed(2)}cm  normalBias ${shadowInfo.normalBiasCm.toFixed(1)}cm  `
      + `pcssRadius ${shadowInfo.radius.toFixed(1)}  sunCasts ${shadowInfo.sunCasts}`);

    if (args.wall) {
      const BANDS = [0.2, 0.4, 0.8, 1.2, 1.6, 2.4, 4.0];
      const poses = await page.evaluate(() => window.__BS.listPoses().map((p) => p.id));
      const acc = BANDS.map(() => []);
      for (const id of poses) {
        const ok = await page.evaluate((a) => {
          if (!window.__BS.setPose(a.id)) return false;
          window.__BS.setTimeOfDay(a.tod);
          window.__CP.settle(10);
          return true;
        }, { id, tod: TOD });
        if (!ok) throw new Error(`setPose("${id}") returned false`);
        const res = await page.evaluate(
          (a) => window.__CP.wallProfile(a.c, a.b, a.e), { c: COLS, b: BANDS, e: Number(args.edge || 0) });
        res.bands.forEach((r, i) => { if (r && r.n >= 8) acc[i].push(r); });
        if (res.hits.length && args.identify) {
          const idr = await page.evaluate(
            (h) => window.__CP.identifyPixels(h), res.hits.map((x) => [x[0], x[1]]));
          console.log(`  ${id.padEnd(14)} band-0 pixels: base luma ${idr.base.toFixed(1)}`);
          for (const m of idr.movers) {
            console.log(`      hiding ${m.name.padEnd(22)} -> ${m.after.toFixed(1)}`
              + ` (${(m.after - m.base >= 0 ? "+" : "")}${(m.after - m.base).toFixed(1)})`);
          }
        }
        if (res.hits.length) {
          const bySurface = {};
          for (const h of res.hits) bySurface[h[2]] = (bySurface[h[2]] || 0) + 1;
          console.log(`  ${id.padEnd(14)} band 0 n=${res.hits.length}  `
            + Object.entries(bySurface).map(([k, v]) => `${k}:${v}`).join(" "));
        }
        if (args.dump) {
          const dir = path.resolve(root,
            String(args.dump === true ? "output/blacksand-caster" : args.dump));
          await mkdir(dir, { recursive: true });
          const url = res.marked
            || await page.evaluate(() => window.__BS.captureDataURL("image/png"));
          await writeFile(path.join(dir, `wall-${id}.png`),
            Buffer.from(url.split(",")[1], "base64"));
        }
      }
      const med = (xs) => (xs.length
        ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
      console.log("\nsunlit masonry, median luma by height above its own ground");
      console.log("  applyGroundGrime multiplies the bottom 1.6m by "
        + "0.78 + 0.22*smoothstep(h/1.6), so a correct profile RISES to 1.6m.");
      const ref = med(acc[5].map((r) => r.med));   // the 1.6-2.4m band
      BANDS.forEach((hi, i) => {
        const lo = i === 0 ? 0 : BANDS[i - 1];
        const m = med(acc[i].map((r) => r.med));
        const n = acc[i].reduce((a, r) => a + r.n, 0);
        const predicted = (() => {
          const h = Math.min(1.6, (lo + hi) * 0.5);
          const t = Math.max(0, Math.min(1, h / 1.6));
          return 0.78 + 0.22 * t * t * (3 - 2 * t);
        })();
        console.log(`  ${lo.toFixed(1)}-${hi.toFixed(1)}m  `
          + `luma ${Number.isFinite(m) ? m.toFixed(1).padStart(6) : "     -"}  `
          + `x clean ${Number.isFinite(m / ref) ? (m / ref).toFixed(3) : "  -  "}  `
          + `grime predicts ${predicted.toFixed(3)}  `
          + `n=${n}  poses=${acc[i].length}`);
      });
      if (page.__bsErrors.length) {
        console.log(`\n!! ${page.__bsErrors.length} page error(s): ${page.__bsErrors[0]}`);
      }
      await page.close();
      return;
    }

    if (args.ladder) {
      const sizes = String(args.ladder === true ? "0.3,0.6,0.9,1.5,3.0" : args.ladder)
        .split(",").map(Number);
      const sites = await page.evaluate((n) => window.__CP.findOpenSites(n, 14), SITES);
      if (!sites.length) throw new Error("no open flat sand site found");
      for (const site of sites) {
        const cubes = await page.evaluate(
          (a) => window.__CP.buildLadder(a.s, a.z), { s: site, z: sizes });
        console.log(`\n=========== cube ladder at (${site[0]}, ${site[2].toFixed(0)}) ===========`);
        for (const t of cubes) {
          const rows = await runTarget(page, t, {
            sun: false, dump: Boolean(args.dump), gain: args.gain,
          });
          if (args.dump) {
            const dir = path.resolve(root,
              String(args.dump === true ? "output/blacksand-caster" : args.dump));
            await mkdir(dir, { recursive: true });
            for (const r of rows) {
              if (!r.images) continue;
              for (const [k, url] of Object.entries(r.images)) {
                await writeFile(path.join(dir, `${t.kind}-${r.station}-${k}.png`),
                  Buffer.from(url.split(",")[1], "base64"));
              }
            }
          }
          console.log(`\n  ${t.kind}  top ${t.top.toFixed(2)}m  radius ${t.radius.toFixed(2)}m  `
            + `reach ${rows[0].info.reach.toFixed(2)}m  `
            + `reach/radius ${(rows[0].info.reach / t.radius).toFixed(2)}`);
          for (const r of rows) {
            console.log(`    ${r.station.padEnd(6)} null   ${fmt(r.nul)}`);
            console.log(`    ${"".padEnd(6)} caster ${fmt(r.self)}`);
            console.log(`    ${"".padEnd(6)} shadow reach  ${profile(r.self)}`);
            if (r.depth) {
              console.log(`    ${"".padEnd(6)} depth  ${String(r.depth.texels).padStart(6)}`
                + ` of ${r.depth.window}^2 texels (${r.depth.pct.toFixed(2)}%), `
                + `silhouette ~${r.depth.expect}, `
                + `ratio ${(r.depth.texels / Math.max(1, r.depth.expect)).toFixed(2)}`);
            }
          }
        }
        await page.evaluate(() => window.__CP.clearLadder());
      }
      if (page.__bsErrors.length) {
        console.log(`\n!! ${page.__bsErrors.length} page error(s): ${page.__bsErrors[0]}`);
      }
      await page.close();
      return;
    }

    for (const kind of KINDS) {
      const targets = kind === "crate" || kind === "post"
        ? await page.evaluate((a) => window.__CP.findProps(a.k, a.n, a.c),
          { k: kind, n: SITES, c: Number(args.clear || 5) })
        : await page.evaluate((a) => window.__CP.findFoliage(a.k, a.n, a.c),
          { k: kind, n: SITES, c: Number(args.clear || 10) });

      console.log(`\n================ ${kind} : ${targets.length} target(s) ================`);
      if (!targets.length) { console.log("  none found on open sunlit ground"); continue; }

      let ti = 0;
      for (const t of targets) {
        const wantDump = Boolean(args.dump) && ti === Number(args.dumpIndex || 0);
        const rows = await runTarget(page, t, {
          sun: Boolean(args.sun), dump: wantDump, gain: args.gain,
        });
        if (wantDump) {
          const dir = path.resolve(root, String(args.dump === true ? "output/blacksand-caster" : args.dump));
          await mkdir(dir, { recursive: true });
          for (const r of rows) {
            for (const [tag, set] of [["ab", r.images], ["null", r.nullImages]]) {
              if (!set) continue;
              for (const [k, url] of Object.entries(set)) {
                await writeFile(path.join(dir, `${kind}-${r.station}-${tag}-${k}.png`),
                  Buffer.from(url.split(",")[1], "base64"));
              }
            }
          }
          console.log(`  wrote captures to ${dir}`);
        }
        ti += 1;
        console.log(`\n  ${kind} at (${t.centre[0].toFixed(0)}, ${t.centre[2].toFixed(0)})  `
          + `top ${t.top.toFixed(2)}m  radius ${t.radius.toFixed(2)}m  `
          + `sun elev ${rows[0].info.elevDeg.toFixed(1)}deg  `
          + `reach ${rows[0].info.reach.toFixed(2)}m  `
          + `reach/radius ${(rows[0].info.reach / Math.max(t.radius, 1e-3)).toFixed(2)}`
          + (t.neighbour !== undefined && Number.isFinite(t.neighbour)
            ? `  nearest sibling ${t.neighbour.toFixed(1)}m` : ""));
        console.log(`    casters toggled: ${rows[0].names.join(", ") || "(none)"}`);
        for (const r of rows) {
          console.log(`    ${r.station.padEnd(6)} null  A/B   ${fmt(r.nul)}`);
          console.log(`    ${"".padEnd(6)} caster A/B   ${fmt(r.self)}`);
          if (r.sun) console.log(`    ${"".padEnd(6)} sun    A/B   ${fmt(r.sun)}`);
          if (r.depth) {
            console.log(`    ${"".padEnd(6)} depth pass   `
              + `${String(r.depth.texels).padStart(6)} of ${r.depth.window}^2 texels differ `
              + `(${r.depth.pct.toFixed(2)}%), nearer-with-caster ${r.depth.nearer}, `
              + `silhouette would be ~${r.depth.expect}, inRange ${r.depth.inRange}`);
          }
        }
      }
    }
    if (page.__bsErrors.length) {
      console.log(`\n!! ${page.__bsErrors.length} page error(s): ${page.__bsErrors[0]}`);
    }
    await page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
