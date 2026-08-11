#!/usr/bin/env node
/* ============================================================
   BLACKSAND - figure/ground value separation, against grey primitives

   The finding under investigation: a timber crate face measures 0.92 of
   the open ground beside it, where Battlefield 2's crate stack measures
   0.595 against its sand. Both albedos have already been checked and
   both look right (timber tint linear 0.185, sand ~0.37), so the fault
   is in the light, in a normalisation, or in the instrument.

   The technique that cracked the hardest bug on this project was an A/B
   against a plain grey primitive - a grey box has no rig, no material,
   no LOD and no instancing to blame. So this probe puts KNOWN linear
   albedos into the frame beside the crate and reads all of them at once:

     PLATES  five horizontal cards lying on the ground at linear albedo
             0.06 / 0.12 / 0.20 / 0.32 / 0.50. Same normal as the sand,
             same irradiance, same range. They calibrate
             "linear albedo -> display value" for a GROUND-facing surface.

     CUBES   five 0.9m cubes at the same five albedos, rotated so one
             vertical face is parallel to the crate face being measured.
             They calibrate the same curve for that exact orientation,
             and their TOP faces re-calibrate the ground orientation at
             prop height.

     BRIDGE  one cube of identical geometry carrying the SCENE's own wood
             material and the crate's own merged vertex colour, read
             straight off the buffer the renderer draws. If the bridge
             cube reads like a 0.18 grey the wood is behaving; if it
             reads like a 0.4 grey the wood is not.

   The calibration is the point. A display-value ratio is not an albedo
   ratio - the AgX curve compresses one into the other - so inverting a
   measured display value through the plate curve gives the EFFECTIVE
   ALBEDO the renderer is actually showing, which is the quantity that
   can be compared against physics and against a 2005 title that had no
   filmic curve at all.

   Everything is read from ONE frame. Absolute luminance in this project
   moves between runs for reasons that have nothing to do with the change
   under test, so every number here is a ratio inside a single capture.

   Crates are found by enumerating PHYSICS COLLIDERS, not by hunting for
   them in a beauty pose. `crate()` is the only call site in the kit that
   places a wooden box with square x/y under 0.56m half-extent, so the
   signature is exact - and it has to be, because the modal wood normal
   in a checkpoint frame belongs to the guard tower, which outvotes a
   0.9m crate by an order of magnitude in pixels and reads 0.95 against
   the ground where a crate reads 0.5. That confusion is where the
   original 0.92 came from.

   Three modes:

     (default)   stage the camera in front of N real crates, build the
                 rig beside each, and invert everything through it
     --gameplay  the ten shipped gameplay poses, no rig, every sunlit
                 surface binned by collider surface and size
     --sweep     one crate at several camera ranges, to test whether the
                 aerial term is what lifts the ratio (it is not)

   Usage:
     node scripts/blacksand-figure-ground.mjs --count 6 --standoff 9 --json out.json
     node scripts/blacksand-figure-ground.mjs --gameplay --grid 300
     node scripts/blacksand-figure-ground.mjs --count 5 --sweep 5,9,16,26,40
     node scripts/blacksand-figure-ground.mjs --no-ao --dump output/fg
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
const QUALITY = String(args.quality || "ultra");
const POSES = String(args.poses && args.poses !== true ? args.poses : "").split(",").filter(Boolean);
const PORT = Number(args.port || 45000 + (process.pid % 9000));
const BASE = `http://127.0.0.1:${PORT}`;
const AO = args["no-ao"] ? false : true;
const GRID = Number(args.grid || 240);
const MAXDIST = Number(args.maxdist || 55);
const DUMP = args.dump && args.dump !== true ? String(args.dump) : null;
const COUNT = Number(args.count || 4);
const STANDOFF = Number(args.standoff || 5.5);
const TOD = Number(args.tod || 11.2);
const SWEEP = String(args.sweep && args.sweep !== true ? args.sweep : "")
  .split(",").filter(Boolean).map(Number);
const AUTO = Boolean(args.auto);

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* ------------------------------------------------------------------
   Page-side rig. Installed once, driven per pose.
   ------------------------------------------------------------------ */
function installRig() {
  const T = window.__BS;
  const THREE = T.THREE;
  const W = window;

  W.__FG = {
    ALBEDOS: [0.06, 0.12, 0.20, 0.32, 0.50],
    rig: null,
    _sunRay: new THREE.Raycaster(),
    _camRay: new THREE.Raycaster(),
    _dir: new THREE.Vector3(),

    toLinear(v) { return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; },

    /**
     * Cast one camera ray.
     *
     * The world is queried through PHYSICS, not through three's
     * Raycaster. A merged structures mesh is a few hundred thousand
     * triangles and three has no acceleration structure, so a full-frame
     * classification grid is billions of ray-triangle tests and does not
     * finish. physics.raycast walks a 24m broadphase grid of oriented
     * boxes and marches the heightfield, and it carries the SURFACE type
     * the piece was placed with - which is a better classifier than a
     * merged mesh's name, because it names the collider rather than the
     * draw call.
     *
     * The rig is not in the physics world, so it is intersected
     * separately against its own eleven small meshes and the nearer of
     * the two wins.
     */
    cast(ndcX, ndcY, maxDist) {
      const cam = T.ctx.render.camera;
      const physics = T.ctx.physics;
      const dir = W.__FG._dir.set(ndcX, ndcY, 0.5).unproject(cam).sub(cam.position).normalize();
      const ph = physics.raycast(cam.position, dir, maxDist, {
        layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC
          | physics.LAYER.VEHICLE | physics.LAYER.FOLIAGE | physics.LAYER.DYNAMIC,
      });
      let best = ph.hit
        ? {
          kind: ph.terrain ? "terrain" : "collider",
          name: ph.terrain ? "terrain" : `surface-${ph.surface}`,
          surface: ph.surface,
          collider: ph.collider,
          point: ph.point,
          normal: ph.normal,
          distance: ph.distance,
        }
        : null;
      if (W.__FG.rig && W.__FG.rig.children.length) {
        const r = W.__FG._camRay;
        r.set(cam.position, dir);
        r.far = best ? best.distance : maxDist;
        const hit = r.intersectObjects(W.__FG.rig.children, false)[0];
        if (hit && hit.face) {
          const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
          best = {
            kind: "rig",
            name: hit.object.name,
            surface: null,
            collider: null,
            point: hit.point,
            normal: hit.face.normal.clone().applyNormalMatrix(nm).normalize(),
            distance: hit.distance,
          };
        }
      }
      return best;
    },

    /**
     * Is direct sun reaching this point?
     *
     * The physics world covers terrain and static structures. The rig is
     * NOT in the physics world, so it is tested separately with a
     * geometric ray - without that, a plate standing in a grey cube's
     * own shadow reads as "sunlit" and silently corrupts the
     * calibration curve it exists to provide.
     */
    sunlit(point, normal) {
      const physics = T.ctx.physics;
      const sun = W.__FG.sun();
      if (normal.dot(sun) <= 0.05) return false;
      const above = point.clone().addScaledVector(normal, 0.08);
      if (physics.raycast(above, sun, 300, {
        layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
      }).hit) return false;
      if (W.__FG.rig && W.__FG.rig.children.length) {
        const r = W.__FG._sunRay;
        r.set(above, sun);
        r.far = 40;
        if (r.intersectObjects(W.__FG.rig.children, false).length) return false;
      }
      return true;
    },

    sun() { return T.ctx.sky.sunDirection.clone().normalize(); },

    /**
     * Stand the camera in front of a real crate.
     *
     * Hunting for crates by raycasting a beauty pose does not work: the
     * modal wood normal in a checkpoint frame belongs to the guard
     * tower, which is four metres of planking and outvotes a 0.9m crate
     * by an order of magnitude in pixels. Enumerating the physics
     * colliders finds the crates directly - `crate()` is the only thing
     * in the kit that places a wooden box under 1.1m - and a camera
     * placed from the crate's own sunward axis guarantees the face the
     * measurement is about is the face in frame.
     */
    findCrates(limit) {
      const physics = T.ctx.physics;
      const sun = W.__FG.sun();
      const out = [];
      for (const c of physics.colliders) {
        if (!c.active || c.surface !== "wood") continue;
        const h = c.halfExtents;
        const maxH = Math.max(h.x, h.y, h.z);
        /* A crate's exact collider signature. `crate()` is the only call
           site that builds a wooden box with square x/y and a depth
           within 15% of them; without the squareness test the scan
           returns 0.84 x 0.20 x 0.88 planks, which are neither crates
           nor cubes and cannot be compared against a cube. */
        if (Math.abs(h.x - h.y) > 0.005) continue;
        if (maxH > 0.56 || Math.min(h.x, h.y, h.z) < 0.28) continue;
        // Sunward horizontal face: whichever of the box's own +/-x, +/-z
        // axes the sun is most square-on to.
        const axes = [
          new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
          new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
        ].map((v) => v.applyQuaternion(c.quaternion));
        let best = null;
        for (const a of axes) {
          const d = a.dot(sun);
          if (!best || d > best.d) best = { n: a, d };
        }
        if (best.d < 0.2) continue;
        const face = c.center.clone().addScaledVector(best.n, maxH + 0.02);
        if (!W.__FG.sunlit(face, best.n)) continue;
        // Open sunlit ground in front of the face, where the camera goes
        // and where the sand is measured.
        const openAt = face.clone().addScaledVector(best.n, 5.0);
        const gh = T.heightAt(openAt.x, openAt.z);
        if (Math.abs(gh - (c.center.y - h.y)) > 1.4) continue;
        const gp = new THREE.Vector3(openAt.x, gh, openAt.z);
        if (!W.__FG.sunlit(gp, new THREE.Vector3(0, 1, 0))) continue;
        out.push({
          centre: c.center.toArray(),
          half: h.toArray(),
          normal: best.n.toArray(),
          facing: best.d,
          base: c.center.y - h.y,
        });
        if (out.length >= limit) break;
      }
      return out;
    },

    /** Eye height in front of the chosen crate, weapon hidden. */
    stage(crate, standoff) {
      const centre = new THREE.Vector3().fromArray(crate.centre);
      const n = new THREE.Vector3().fromArray(crate.normal);
      const cx = centre.x + n.x * standoff;
      const cz = centre.z + n.z * standoff;
      T.releaseCamera();
      T.hideHud(true);
      T.teleport(cx, T.heightAt(cx, cz) + 1.65, cz);
      // Same convention as blacksand-gameplay-shots.mjs: yaw is
      // atan2(-forwardX, -forwardZ), and forward here is -n.
      T.ctx.player.state.yaw = Math.atan2(n.x, n.z);
      T.ctx.player.state.pitch = -0.10;
      return { x: cx, z: cz };
    },

    /**
     * A flat sunlit patch of open sand to stand the calibration plates
     * on, chosen from what the staged camera can actually see.
     */
    surveyGround(maxDist, refPoint) {
      const ref = new THREE.Vector3().fromArray(refPoint);
      let spot = null;
      let bestErr = 1e9;
      let n = 0;
      for (let iy = 0; iy < 60; iy += 1) {
        for (let ix = 0; ix < 100; ix += 1) {
          const ndcX = (ix + 0.5) / 100 * 2 - 1;
          const ndcY = 1 - (iy + 0.5) / 60 * 2;
          const h = W.__FG.cast(ndcX, ndcY, maxDist);
          if (!h || h.kind !== "terrain" || h.surface !== "sand") continue;
          if (h.normal.y < 0.985) continue;
          if (!W.__FG.sunlit(h.point, h.normal)) continue;
          n += 1;
          const away = h.point.distanceTo(ref);
          if (away < 2.4 || away > 9) continue;
          // As close to straight in front of the camera as the geometry
          // allows, so the plates land big in frame.
          const err = Math.abs(ndcX) * 6 + Math.abs(away - 4.0);
          if (err < bestErr) { bestErr = err; spot = h.point.clone(); }
        }
      }
      return spot ? { ok: true, plate: spot.toArray(), ground: n } : { ok: false, ground: n };
    },

    /**
     * Find the crate face this run is measured against, plus a flat
     * sunlit patch of open ground to stand the calibration plates on.
     */
    survey(maxDist) {
      const sun = W.__FG.sun();
      const woodSides = [];
      const ground = [];
      let woodTops = 0;

      for (let iy = 0; iy < 90; iy += 1) {
        for (let ix = 0; ix < 160; ix += 1) {
          const ndcX = (ix + 0.5) / 160 * 2 - 1;
          const ndcY = 1 - (iy + 0.5) / 90 * 2;
          const h = W.__FG.cast(ndcX, ndcY, maxDist);
          if (!h) continue;
          const isWood = h.surface === "wood";
          const isGround = h.kind === "terrain" && h.normal.y > 0.97;
          if (!isWood && !isGround) continue;
          if (!W.__FG.sunlit(h.point, h.normal)) continue;
          if (isWood) {
            if (Math.abs(h.normal.y) < 0.25) {
              woodSides.push({
                n: h.normal.clone(), p: h.point.clone(), d: h.distance,
                half: h.collider ? h.collider.halfExtents.toArray() : null,
              });
            } else if (h.normal.y > 0.9) woodTops += 1;
          } else ground.push({ p: h.point.clone(), d: h.distance });
        }
      }
      if (!woodSides.length) return { ok: false, woodSides: 0, ground: ground.length };

      // Modal sunward wood normal: bin the horizontal heading in 10deg
      // buckets and take the most populated, so one stray face on a
      // rotated crate cannot set the reference orientation.
      const bins = new Map();
      for (const s of woodSides) {
        const k = Math.round(Math.atan2(s.n.x, s.n.z) / (Math.PI / 18));
        const b = bins.get(k) || { n: 0, list: [] };
        b.n += 1; b.list.push(s);
        bins.set(k, b);
      }
      let best = null;
      for (const b of bins.values()) if (!best || b.n > best.n) best = b;
      // Prefer a prop-sized collider. A shed door and a crate are both
      // "wood", and the reported measurement is about a crate.
      const props = best.list.filter((s) => s.half && Math.max(...s.half) < 1.1);
      const pool = props.length >= 8 ? props : best.list;
      pool.sort((a, b) => a.d - b.d);
      const ref = pool[Math.floor(pool.length / 2)];

      // Ground for the plates: flat, sunlit, at roughly the crate's own
      // range so the plates share its exposure, aerial term and cascade.
      let plateSpot = null;
      let bestErr = 1e9;
      for (const g of ground) {
        const away = g.p.distanceTo(ref.p);
        if (away < 3.0 || away > 26) continue;
        const err = Math.abs(g.d - ref.d) + away * 0.2;
        if (err < bestErr) { bestErr = err; plateSpot = g; }
      }
      if (!plateSpot) return { ok: false, woodSides: woodSides.length, ground: ground.length };

      return {
        ok: true,
        refNormal: ref.n.toArray(),
        refPoint: ref.p.toArray(),
        refDist: ref.d,
        refFacing: ref.n.dot(sun),
        refHalf: ref.half,
        plate: plateSpot.p.toArray(),
        plateDist: plateSpot.d,
        counts: { woodSides: woodSides.length, woodTops, ground: ground.length, props: props.length },
        sun: sun.toArray(),
      };
    },

    /**
     * Crate-face vs open-ground display ratio at one camera range,
     * with no rig in the scene.
     *
     * The staged close-range answer and the answer a reviewer sees are
     * not the same number, because everything between the eye and the
     * object - the aerial term, the fog, the detail blend - is a
     * function of range. Sweeping it on ONE crate is a valid A/B: the
     * only thing that changes between rows is where the camera stands.
     */
    async rangeRow(crate, standoff, cols, maxDist) {
      W.__FG.stage(crate, standoff);
      T.ctx.loop.advance(1.2, 1 / 60);
      for (let i = 0; i < 4; i += 1) T.ctx.loop.frame(1 / 60);
      const url = T.captureDataURL("image/png");
      const img = await new Promise((res) => {
        const im = new Image(); im.onload = () => res(im); im.src = url;
      });
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const g2 = cv.getContext("2d");
      g2.drawImage(img, 0, 0);
      const px = g2.getImageData(0, 0, cv.width, cv.height).data;

      const refN = new THREE.Vector3().fromArray(crate.normal);
      const centre = new THREE.Vector3().fromArray(crate.centre);
      const wood = []; const ground = [];
      const ROWS = Math.round(cols * 9 / 16);
      for (let iy = 0; iy < ROWS; iy += 1) {
        for (let ix = 0; ix < cols; ix += 1) {
          const ndcX = (ix + 0.5) / cols * 2 - 1;
          const ndcY = 1 - (iy + 0.5) / ROWS * 2;
          const h = W.__FG.cast(ndcX, ndcY, maxDist);
          if (!h) continue;
          const top = h.normal.y > 0.97;
          const parallel = Math.abs(h.normal.y) < 0.25 && h.normal.dot(refN) > 0.985;
          if (!top && !parallel) continue;
          if (!W.__FG.sunlit(h.point, h.normal)) continue;
          const sxp = Math.floor((ndcX * 0.5 + 0.5) * cv.width);
          const syp = Math.floor((1 - (ndcY * 0.5 + 0.5)) * cv.height);
          const o = (syp * cv.width + sxp) * 4;
          const rgb = [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];
          if (h.kind === "collider" && h.surface === "wood" && parallel
            && h.point.distanceTo(centre) < 1.2) wood.push(rgb);
          // Open sand at roughly the crate's own range, so the two
          // populations share an aerial term and only albedo differs.
          else if (h.kind === "terrain" && h.surface === "sand" && top
            && Math.abs(h.distance - standoff) < standoff * 0.45) ground.push(rgb);
        }
      }
      return {
        standoff,
        wood: W.__FG.summarise(wood),
        ground: W.__FG.summarise(ground),
        exposure: T.ctx.render.readGrade().exposure,
      };
    },

    /**
     * Every sunlit surface in a gameplay frame, binned by what it is.
     *
     * This is the framing the reported 0.92 was taken in, so it is the
     * one that has to be reproduced before it can be explained. Timber
     * is split by collider size: a 0.9m crate and a four-metre run of
     * guard-tower planking are the same material and the same draw call
     * and they are NOT the same measurement.
     */
    async frameCensus(cols, maxDist) {
      const url = T.captureDataURL("image/png");
      const img = await new Promise((res) => {
        const im = new Image(); im.onload = () => res(im); im.src = url;
      });
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const g2 = cv.getContext("2d");
      g2.drawImage(img, 0, 0);
      const px = g2.getImageData(0, 0, cv.width, cv.height).data;

      const sun = W.__FG.sun();
      const groups = {};
      const push = (k, rgb) => { (groups[k] || (groups[k] = [])).push(rgb); };
      const ROWS = Math.round(cols * 9 / 16);
      for (let iy = 0; iy < ROWS; iy += 1) {
        for (let ix = 0; ix < cols; ix += 1) {
          const ndcX = (ix + 0.5) / cols * 2 - 1;
          const ndcY = 1 - (iy + 0.5) / ROWS * 2;
          const h = W.__FG.cast(ndcX, ndcY, maxDist);
          if (!h) continue;
          const top = h.normal.y > 0.97;
          const side = Math.abs(h.normal.y) < 0.25;
          if (!top && !side) continue;
          if (!W.__FG.sunlit(h.point, h.normal)) continue;
          const sxp = Math.floor((ndcX * 0.5 + 0.5) * cv.width);
          const syp = Math.floor((1 - (ndcY * 0.5 + 0.5)) * cv.height);
          const o = (syp * cv.width + sxp) * 4;
          const rgb = [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];
          if (h.kind === "terrain") {
            if (top && h.surface === "sand") push("ground", rgb);
          } else if (h.kind === "collider" && side) {
            const half = h.collider.halfExtents;
            const prop = Math.max(half.x, half.y, half.z) < 0.6;
            const nl = h.normal.dot(sun);
            push(prop ? `${h.surface}-prop` : `${h.surface}-big`, rgb);
            if (h.surface === "wood") {
              push(prop ? "woodPropNL" : "woodBigNL", [nl, nl, nl]);
            }
          }
        }
      }
      const out = {};
      for (const [k, v] of Object.entries(groups)) out[k] = W.__FG.summarise(v);
      return out;
    },

    /**
     * The merged vertex colours the crate itself carries.
     *
     * Taken as the MEDIAN over every wood vertex inside the crate's own
     * collider box, not the nearest single vertex: `paint()` lays a
     * vertical ramp from `tintBottom` to `tint` and `applyGroundGrime`
     * darkens the lowest 1.6m again, so one vertex can be 30% off the
     * piece's level either way.
     */
    woodTint(centreArray, halfArray) {
      const c = new THREE.Vector3().fromArray(centreArray);
      const h = halfArray
        ? new THREE.Vector3().fromArray(halfArray).addScalar(0.06)
        : new THREE.Vector3(0.6, 0.6, 0.6);
      /* structures.js buckets by MATERIAL AND CELL, so the town holds
         many meshes all called `structures-wood`. Taking the last one
         the traverse finds returns whichever cell happens to be last in
         the scene graph, which is almost never the cell the crate is in
         - that mistake made this probe report a crate tint of 1.44 and
         a bridge cube three times too dark. */
      const meshes = W.__FG.woodMeshes();
      if (!meshes.length) return null;
      const rr = []; const gg = []; const bb = [];
      for (const mesh of meshes) {
        if (!mesh.geometry.attributes.color) continue;
        const pos = mesh.geometry.attributes.position;
        const col = mesh.geometry.attributes.color;
        for (let i = 0; i < pos.count; i += 1) {
          if (Math.abs(pos.getX(i) - c.x) > h.x) continue;
          if (Math.abs(pos.getY(i) - c.y) > h.y) continue;
          if (Math.abs(pos.getZ(i) - c.z) > h.z) continue;
          rr.push(col.getX(i)); gg.push(col.getY(i)); bb.push(col.getZ(i));
        }
      }
      if (!rr.length) return null;
      const med = (a) => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
      const material = meshes[0].material;
      return {
        rgb: [med(rr), med(gg), med(bb)],
        vertices: rr.length,
        meshes: meshes.length,
        material: material.name,
        mapMean: W.__FG.mapMean(material),
        mapRgbMean: W.__FG.mapRgbMean(material),
        roughness: material.roughness,
        metalness: material.metalness,
      };
    },

    woodMeshes() {
      const list = [];
      T.ctx.render.scene.traverse((o) => {
        if (o.isMesh && o.name === "structures-wood") list.push(o);
      });
      return list;
    },

    /** Per-channel linear mean of a material's albedo map. */
    mapRgbMean(material) {
      const image = material && material.map && material.map.image;
      const data = image && image.data;
      if (!data) return null;
      const sum = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < data.length; i += 4 * 37) {
        for (let c = 0; c < 3; c += 1) sum[c] += W.__FG.toLinear(data[i + c] / 255);
        n += 1;
      }
      return n ? sum.map((v) => v / n) : null;
    },

    mapMean(material) {
      const image = material && material.map && material.map.image;
      const data = image && image.data;
      if (!data) return null;
      let sum = 0; let n = 0;
      for (let i = 0; i < data.length; i += 4 * 37) {
        for (let c = 0; c < 3; c += 1) { sum += W.__FG.toLinear(data[i + c] / 255); n += 1; }
      }
      return n ? sum / n : null;
    },

    /** Stand the calibration rig on the map. */
    build(survey, tint) {
      if (W.__FG.rig) {
        T.ctx.render.scene.remove(W.__FG.rig);
        W.__FG.rig.traverse((o) => {
          if (o.isMesh && o.name !== "fg-bridge") { o.geometry.dispose(); o.material.dispose(); }
        });
      }
      const group = new THREE.Group();
      group.name = "fg-rig";
      const n = new THREE.Vector3().fromArray(survey.refNormal);
      // Heading of the reference crate face, so a cube face is parallel
      // to it and receives exactly the same cosine of the sun.
      const yaw = Math.atan2(n.x, n.z);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);

      const plate = new THREE.Vector3().fromArray(survey.plate);
      const ref = new THREE.Vector3().fromArray(survey.refPoint);
      // Crate-sized on purpose: a 0.9m cube next to a 0.9m crate rules
      // out geometry, size and screen coverage in one move.
      const cubeGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
      const plateGeo = new THREE.PlaneGeometry(1.0, 1.7);
      plateGeo.rotateX(-Math.PI / 2);

      function grey(a) {
        const m = new THREE.MeshStandardMaterial({ roughness: 1.0, metalness: 0.0, dithering: true });
        // Linear working space with an explicit colour space, so this is
        // an ALBEDO and not an sRGB swatch.
        m.color.setRGB(a, a, a, THREE.LinearSRGBColorSpace);
        m.name = `fg-grey-${a}`;
        return m;
      }

      /* The plates go on the open ground the sand is measured on. The
         CUBES go right beside the crate stack itself - same range, same
         cascade, same aerial term, same neighbours - because the whole
         point of a grey primitive is that it stands where the suspect
         object stands. */
      W.__FG.ALBEDOS.forEach((a, i) => {
        const off = (i - 2) * 1.15;
        const px = plate.x + rx * off;
        const pz = plate.z + rz * off;
        const pm = new THREE.Mesh(plateGeo, grey(a));
        pm.name = `fg-plate-${i}`;
        pm.position.set(px, T.heightAt(px, pz) + 0.06, pz);
        pm.castShadow = false;      // must not shade the ground it is compared against
        pm.receiveShadow = true;
        pm.userData.qaOpaque = false;
        group.add(pm);

        const side = 1.05 + i * 1.05;
        const cx = ref.x + rx * side;
        const cz = ref.z + rz * side;
        const cm = new THREE.Mesh(cubeGeo, grey(a));
        cm.name = `fg-cube-${i}`;
        cm.position.set(cx, T.heightAt(cx, cz) + 0.45, cz);
        cm.rotation.y = yaw;
        cm.castShadow = true;
        cm.receiveShadow = true;
        cm.userData.qaOpaque = false;
        group.add(cm);
      });

      // The bridge: identical geometry, the scene's own wood material,
      // the crate's own merged vertex colour. Full 0-1 uv means it
      // samples the whole albedo map, so its level IS the map mean.
      if (tint) {
        const woodMesh = W.__FG.woodMeshes()[0];
        if (woodMesh) {
          const g = cubeGeo.clone();
          const count = g.attributes.position.count;
          const cols = new Float32Array(count * 3);
          for (let i = 0; i < count; i += 1) {
            cols[i * 3] = tint.rgb[0];
            cols[i * 3 + 1] = tint.rgb[1];
            cols[i * 3 + 2] = tint.rgb[2];
          }
          g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
          if (g.attributes.uv && !g.attributes.uv1) g.setAttribute("uv1", g.attributes.uv.clone());
          const bx = ref.x - rx * 1.05;
          const bz = ref.z - rz * 1.05;
          const bm = new THREE.Mesh(g, woodMesh.material);
          bm.name = "fg-bridge";
          bm.position.set(bx, T.heightAt(bx, bz) + 0.45, bz);
          bm.rotation.y = yaw;
          bm.castShadow = true;
          bm.receiveShadow = true;
          bm.userData.qaOpaque = false;
          group.add(bm);
        }
      }

      T.ctx.render.scene.add(group);
      W.__FG.rig = group;
      return { yaw, plate: plate.toArray(), meshes: group.children.length };
    },

    /**
     * One frame, classified. Every population is read from the SAME
     * capture, so nothing here depends on the absolute exposure.
     */
    async read(survey, cols, maxDist) {
      const url = T.captureDataURL("image/png");
      const img = await new Promise((res) => {
        const im = new Image(); im.onload = () => res(im); im.src = url;
      });
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const g2 = cv.getContext("2d");
      g2.drawImage(img, 0, 0);
      const px = g2.getImageData(0, 0, cv.width, cv.height).data;

      const refN = new THREE.Vector3().fromArray(survey.refNormal);
      const groups = {};
      const push = (k, rgb) => { (groups[k] || (groups[k] = [])).push(rgb); };

      /* Classification overlay. Every conclusion here rests on "these
         pixels are that surface", and the only way to check that claim
         is to look at it - this project has twice been sent after a
         phantom by a statistic taken over the wrong pixels. */
      const ov = document.createElement("canvas");
      ov.width = cv.width; ov.height = cv.height;
      const og = ov.getContext("2d");
      og.drawImage(img, 0, 0);
      og.globalAlpha = 0.85;
      const KEYCOL = {
        ground: "#00b0ff", plate: "#00ff66", cubeTop: "#ffd000",
        cubeFace: "#ff8800", bridge: "#ff00cc", prop: "#ff2222", other: "#8844ff",
      };
      const mark = (sx, sy, col) => { og.fillStyle = col; og.fillRect(sx - 2, sy - 2, 4, 4); };

      const COLS = cols;
      const ROWS = Math.round(cols * 9 / 16);
      for (let iy = 0; iy < ROWS; iy += 1) {
        for (let ix = 0; ix < COLS; ix += 1) {
          const ndcX = (ix + 0.5) / COLS * 2 - 1;
          const ndcY = 1 - (iy + 0.5) / ROWS * 2;
          const h = W.__FG.cast(ndcX, ndcY, maxDist);
          if (!h) continue;

          const top = h.normal.y > 0.97;
          const side = Math.abs(h.normal.y) < 0.25;
          const parallel = side && h.normal.dot(refN) > 0.985;
          if (!top && !side) continue;
          if (!W.__FG.sunlit(h.point, h.normal)) continue;

          const sxp = Math.floor((ndcX * 0.5 + 0.5) * cv.width);
          const syp = Math.floor((1 - (ndcY * 0.5 + 0.5)) * cv.height);
          const o = (syp * cv.width + sxp) * 4;
          const rgb = [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];

          if (h.kind === "rig") {
            const m = /^fg-(plate|cube)-(\d)$/.exec(h.name);
            if (m) {
              if (m[1] === "plate" && top) { push(`plate${m[2]}`, rgb); mark(sxp, syp, KEYCOL.plate); }
              else if (m[1] === "cube" && top) { push(`cubeTop${m[2]}`, rgb); mark(sxp, syp, KEYCOL.cubeTop); }
              else if (m[1] === "cube" && parallel) { push(`cubeFace${m[2]}`, rgb); mark(sxp, syp, KEYCOL.cubeFace); }
            } else if (h.name === "fg-bridge") {
              if (top) { push("bridgeTop", rgb); mark(sxp, syp, KEYCOL.bridge); }
              else if (parallel) { push("bridgeFace", rgb); mark(sxp, syp, KEYCOL.bridge); }
            }
          } else if (h.kind === "terrain") {
            if (top && h.surface === "sand") { push("ground", rgb); mark(sxp, syp, KEYCOL.ground); }
          } else {
            const kind = h.surface;
            const prop = h.collider && Math.max(...h.collider.halfExtents.toArray()) < 1.1;
            if (top) push(`${kind}:top`, rgb);
            else if (parallel) push(`${kind}:face`, rgb);
            else push(`${kind}:side`, rgb);
            if (kind === "wood" && prop) {
              if (top) { push("prop:top", rgb); mark(sxp, syp, KEYCOL.prop); }
              else if (parallel) { push("prop:face", rgb); mark(sxp, syp, KEYCOL.prop); }
            } else if (kind === "wood") mark(sxp, syp, KEYCOL.other);
          }
        }
      }

      const out = {};
      for (const [k, v] of Object.entries(groups)) out[k] = W.__FG.summarise(v);
      return {
        by: out, width: cv.width, height: cv.height,
        frame: url, overlay: ov.toDataURL("image/png"),
      };
    },

    summarise(list) {
      const n = list.length;
      if (!n) return null;
      const med = (arr) => {
        const s = arr.slice().sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };
      // Medians, so a stray specular or a foliage sliver cannot move a
      // population of a few hundred samples.
      const r = med(list.map((c) => c[0]));
      const g = med(list.map((c) => c[1]));
      const b = med(list.map((c) => c[2]));
      const lin = [W.__FG.toLinear(r), W.__FG.toLinear(g), W.__FG.toLinear(b)];
      return {
        n,
        srgb: [r, g, b],
        value: Math.max(r, g, b),
        mean: (r + g + b) / 3,
        linear: lin,
        linLuma: 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2],
        linValue: Math.max(...lin),
      };
    },
  };
  return true;
}

/* ------------------------------------------------------------------
   Node-side maths: invert the calibration curve.
   ------------------------------------------------------------------ */

/** Monotone piecewise-linear inversion in log(albedo). */
function impliedAlbedo(curve, value) {
  const pts = curve.filter((p) => p && Number.isFinite(p.v)).sort((a, b) => a.v - b.v);
  if (pts.length < 2) return null;
  if (value <= pts[0].v) {
    const s = (Math.log(pts[1].a) - Math.log(pts[0].a)) / (pts[1].v - pts[0].v);
    return Math.exp(Math.log(pts[0].a) + (value - pts[0].v) * s);
  }
  for (let i = 0; i < pts.length - 1; i += 1) {
    if (value <= pts[i + 1].v) {
      const t = (value - pts[i].v) / (pts[i + 1].v - pts[i].v);
      return Math.exp(Math.log(pts[i].a) * (1 - t) + Math.log(pts[i + 1].a) * t);
    }
  }
  const k = pts.length - 1;
  const s = (Math.log(pts[k].a) - Math.log(pts[k - 1].a)) / (pts[k].v - pts[k - 1].v);
  return Math.exp(Math.log(pts[k].a) + (value - pts[k].v) * s);
}

function fmt(s) {
  if (!s) return "      (none)";
  return `n ${String(s.n).padStart(5)}  srgbV ${(s.value * 255).toFixed(1).padStart(5)}`
    + `  mean ${(s.mean * 255).toFixed(1).padStart(5)}  linLuma ${s.linLuma.toFixed(4)}`;
}

/**
 * Invert a measurement through the grey rig PER CHANNEL.
 *
 * The illuminant here is warm and the grade is per-channel, so a
 * neutral card's red is brighter than its blue at the same albedo.
 * Inverting each channel against that channel's own grey curve divides
 * out the illuminant, the tone curve and the saturation controls in one
 * step, and what comes back is the surface's own reflectance - which is
 * the only quantity that can be checked against physics or against a
 * title with no filmic curve at all.
 */
function albedoRgb(cards, sample) {
  if (!sample) return null;
  const out = [];
  for (let c = 0; c < 3; c += 1) {
    const curve = cards
      .filter((k) => k.s)
      .map((k) => ({ a: k.a, v: k.s.linear[c] }));
    if (curve.length < 2) return null;
    out.push(impliedAlbedo(curve, sample.linear[c]));
  }
  return {
    rgb: out,
    luma: 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2],
    value: Math.max(...out),
  };
}

async function main() {
  const server = startServer();
  let browser = null;
  const results = [];
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
    })).newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`${BASE}/games/blacksand.html?qa=1&probe=1&quality=${QUALITY}`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(),
      null, { timeout: 240000 });
    await page.evaluate(() => {
      window.__BS.maximize();
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await page.evaluate(installRig);

    if (args.gameplay) {
      /* Staged exactly as blacksand-gameplay-shots.mjs does, minus the
         framing solver - an adaptive framing step is not a valid A/B,
         and this run has to be comparable to itself across poses. */
      const poses = POSES.length
        ? POSES
        : await page.evaluate(() => (window.__BS.ctx.world.getBeautyShots() || []).map((p) => p.id));
      console.log("GAMEPLAY FRAMING - sunlit vertical faces against sunlit flat sand\n");
      console.log(`  ${"pose".padEnd(14)}${"ground".padStart(8)}`
        + `${"crate".padStart(8)}${"ratio".padStart(7)}${"n".padStart(6)}`
        + `${"bigWood".padStart(9)}${"ratio".padStart(7)}${"n".padStart(6)}`
        + `${"N.L crate".padStart(11)}${"N.L big".padStart(9)}`);
      const out = [];
      for (const id of poses) {
        const ok = await page.evaluate((pid) => {
          const T = window.__BS;
          const c = T.ctx;
          const pose = (c.world.getBeautyShots() || []).find((p) => p.id === pid);
          if (!pose) return false;
          T.releaseCamera();
          T.hideHud(true);
          const dx = pose.target[0] - pose.position[0];
          const dz = pose.target[2] - pose.position[2];
          const len = Math.hypot(dx, dz) || 1;
          const ux = dx / len; const uz = dz / len;
          const sx = pose.target[0] - ux * 14;
          const sz = pose.target[2] - uz * 14;
          T.teleport(sx, T.heightAt(sx, sz) + 1.2, sz);
          c.player.state.yaw = Math.atan2(-ux, -uz);
          c.player.state.pitch = -0.06;
          if (pose.timeOfDay !== undefined) T.setTimeOfDay(pose.timeOfDay);
          return true;
        }, id);
        if (!ok) continue;
        await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
        await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });
        const census = await page.evaluate(
          ([g, m]) => window.__FG.frameCensus(g, m), [GRID, MAXDIST]
        );
        out.push({ id, census });
        const gr = census.ground;
        const cr = census["wood-prop"];
        const bg = census["wood-big"];
        const r = (s) => (s && gr ? (s.value / gr.value).toFixed(3) : "  -  ");
        const v = (s) => (s ? (s.value * 255).toFixed(0) : "-");
        console.log(`  ${id.padEnd(14)}${v(gr).padStart(8)}`
          + `${v(cr).padStart(8)}${r(cr).padStart(7)}${String(cr ? cr.n : 0).padStart(6)}`
          + `${v(bg).padStart(9)}${r(bg).padStart(7)}${String(bg ? bg.n : 0).padStart(6)}`
          + `${(census.woodPropNL ? census.woodPropNL.srgb[0].toFixed(2) : "-").padStart(11)}`
          + `${(census.woodBigNL ? census.woodBigNL.srgb[0].toFixed(2) : "-").padStart(9)}`);
      }
      const pick = (k) => out.map((o) => (o.census[k] && o.census.ground
        ? o.census[k].value / o.census.ground.value : null)).filter((x) => x !== null)
        .sort((a, b) => a - b);
      const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : null);
      const cm = med(pick("wood-prop"));
      const bm = med(pick("wood-big"));
      console.log(`\n  MEDIAN over poses   crate faces ${cm ? cm.toFixed(3) : "-"}`
        + `   large timber ${bm ? bm.toFixed(3) : "-"}   (Battlefield 2 crate stack 0.595)`);
      if (args.json) {
        await writeFile(path.resolve(root, `${String(args.json)}.gameplay.json`),
          JSON.stringify(out, null, 2));
      }
      await page.close();
      return;
    }

    await page.evaluate((h) => window.__BS.setTimeOfDay(h), TOD);
    await page.evaluate(() => window.__BS.advanceTime(2.0, 1 / 60));

    const crates = await page.evaluate((n) => window.__FG.findCrates(n), 400);
    console.log(`crate colliders with a sunlit face and open ground in front: ${crates.length}`);
    // Spread the picks across the map rather than taking the first N,
    // which would all come from one compound.
    const step = Math.max(1, Math.floor(crates.length / COUNT));
    const picks = [];
    for (let i = 0; i < crates.length && picks.length < COUNT; i += step) picks.push(crates[i]);

    if (SWEEP.length) {
      console.log(`\nRANGE SWEEP - crate face : open ground, display value, `
        + `auto exposure ${AUTO ? "LIVE" : "pinned"}\n`);
      console.log(`  ${"crate".padEnd(22)}`
        + SWEEP.map((d) => `${String(d)}m`.padStart(9)).join(""));
      const rows = [];
      for (const crate of picks) {
        const id = `crate-${crate.centre.map((v) => Math.round(v)).join("_")}`;
        const cells = [];
        for (const d of SWEEP) {
          if (!AUTO) {
            // Re-pin per row: a fixed exposure across the sweep would
            // hide the fact that the whole frame changes with range.
            await page.evaluate(() => window.__BS.grade({ autoExposure: true }));
          }
          const row = await page.evaluate(
            ([c, d2, g, m]) => window.__FG.rangeRow(c, d2, g, m),
            [crate, d, Math.min(GRID, 260), Math.max(MAXDIST, d * 2)]
          );
          if (!AUTO) await page.evaluate(() => window.__BS.grade({ autoExposure: false }));
          cells.push(row);
        }
        rows.push({ id, cells });
        console.log(`  ${id.padEnd(22)}`
          + cells.map((c) => (c.wood && c.ground
            ? (c.wood.value / c.ground.value).toFixed(3).padStart(9)
            : "     -   ")).join(""));
      }
      console.log(`  ${"(wood n)".padEnd(22)}`
        + SWEEP.map((_, i) => String(rows[0] && rows[0].cells[i].wood
          ? rows[0].cells[i].wood.n : 0).padStart(9)).join(""));
      if (args.json) {
        await writeFile(path.resolve(root, `${String(args.json)}.sweep.json`),
          JSON.stringify(rows, null, 2));
      }
      if (!args.rig) { await page.close(); return; }
    }

    for (const crate of picks) {
      const poseId = `crate-${crate.centre.map((v) => Math.round(v)).join("_")}`;
      const staged = await page.evaluate(([c, d]) => {
        const rig = window.__FG.rig;
        if (rig) { window.__BS.ctx.render.scene.remove(rig); window.__FG.rig = null; }
        return window.__FG.stage(c, d);
      }, [crate, STANDOFF]);

      await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
      await page.evaluate((ao) => {
        // Pinned so the rig's own pixels cannot move the meter between
        // the survey frame and the read frame.
        const patch = { autoExposure: false, grain: 0 };
        if (!ao) patch.ao = 0;
        window.__BS.grade(patch);
      }, AO);
      await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });

      const ground = await page.evaluate(
        ([d, p]) => window.__FG.surveyGround(d, p), [MAXDIST, crate.centre]
      );
      if (!ground.ok) {
        console.log(`${poseId.padEnd(20)} skipped - no open sunlit sand in frame (${ground.ground})`);
        continue;
      }
      const survey = {
        ok: true,
        refNormal: crate.normal,
        refPoint: crate.centre,
        refDist: STANDOFF,
        refFacing: crate.facing,
        refHalf: crate.half,
        plate: ground.plate,
        plateDist: STANDOFF,
      };

      const tint = await page.evaluate(
        ([p, h]) => window.__FG.woodTint(p, h), [survey.refPoint, survey.refHalf]
      );
      const built = await page.evaluate(([s, t]) => window.__FG.build(s, t), [survey, tint]);
      await page.evaluate(() => { for (let i = 0; i < 4; i += 1) window.__BS.renderOnce(1 / 60); });

      const read = await page.evaluate(
        ([s, c, d]) => window.__FG.read(s, c, d), [survey, GRID, MAXDIST]
      );
      const report = await page.evaluate(() => window.__BS.report());
      if (DUMP) {
        await mkdir(path.resolve(root, DUMP), { recursive: true });
        await writeFile(path.resolve(root, DUMP, `${poseId}.png`),
          Buffer.from(read.frame.split(",")[1], "base64"));
        await writeFile(path.resolve(root, DUMP, `${poseId}-class.png`),
          Buffer.from(read.overlay.split(",")[1], "base64"));
      }
      delete read.frame;
      delete read.overlay;
      results.push({ poseId, staged, survey, tint, built, read, report });

      /* ------------------------------- print ------------------------------- */
      const by = read.by;
      const A = [0.06, 0.12, 0.20, 0.32, 0.50];
      const cards = (prefix) => A.map((a, i) => ({ a, s: by[`${prefix}${i}`] || null }));
      const plateCards = cards("plate");
      const topCards = cards("cubeTop");
      const faceCards = cards("cubeFace");

      const g = by.ground;
      const wf = by["prop:face"] || by["wood:face"];
      const wt = by["prop:top"] || by["wood:top"];
      const bf = by.bridgeFace;
      const bt = by.bridgeTop;

      console.log(`\n=== ${poseId}  tod ${TOD}  standoff ${STANDOFF}m  `
        + `crate half ${crate.half.map((v) => v.toFixed(2)).join("/")}  `
        + `face N.L ${survey.refFacing.toFixed(2)}  AO ${AO ? "on" : "OFF"} ===`);
      console.log(`  crate merged vertex tint ${tint ? tint.rgb.map((v) => v.toFixed(3)).join(", ") : "-"}`
        + `   wood map mean ${tint && tint.mapMean ? tint.mapMean.toFixed(4) : "-"}`
        + `   rough ${tint ? tint.roughness : "-"}`);
      console.log(`  ground        ${fmt(g)}`);
      console.log(`  wood face     ${fmt(wf)}`);
      console.log(`  wood top      ${fmt(wt)}`);
      console.log(`  bridge face   ${fmt(bf)}`);
      console.log(`  bridge top    ${fmt(bt)}`);
      console.log("  PLATES  (flat on ground, known linear albedo)");
      A.forEach((a, i) => console.log(`    ${a.toFixed(2)}  ${fmt(by[`plate${i}`])}`));
      console.log("  CUBE TOPS  (ground-facing, at prop height)");
      A.forEach((a, i) => console.log(`    ${a.toFixed(2)}  ${fmt(by[`cubeTop${i}`])}`));
      console.log("  CUBE FACES  (parallel to the crate face)");
      A.forEach((a, i) => console.log(`    ${a.toFixed(2)}  ${fmt(by[`cubeFace${i}`])}`));

      const other = Object.keys(by).filter((k) => /:/.test(k) && !/^(wood|prop):/.test(k))
        .sort((a, b) => by[b].n - by[a].n).slice(0, 6);
      if (other.length) {
        console.log("  OTHER BUILT SURFACES");
        for (const k of other) console.log(`    ${k.padEnd(18)}${fmt(by[k])}`);
      }

      const gA = albedoRgb(plateCards, g);
      const wfA = albedoRgb(faceCards, wf);
      const wtA = albedoRgb(topCards, wt);
      const bfA = albedoRgb(faceCards, bf);
      const btA = albedoRgb(topCards, bt);
      const p = (v) => (v ? `${v.luma.toFixed(3)} (${v.rgb.map((x) => x.toFixed(2)).join("/")})` : "-");
      console.log("  IMPLIED ALBEDO, per channel through the grey rig  [luma (r/g/b)]");
      console.log(`    ground      ${p(gA)}`);
      console.log(`    crate face  ${p(wfA)}`);
      console.log(`    crate top   ${p(wtA)}`);
      console.log(`    bridge face ${p(bfA)}`);
      console.log(`    bridge top  ${p(btA)}`);
      const ratio = (s, a, label) => {
        if (!s || !g) return;
        console.log(`  RATIO ${label.padEnd(11)}: ground   display ${(s.value / g.value).toFixed(3)}`
          + `   srgbMean ${(s.mean / g.mean).toFixed(3)}`
          + `   linLuma ${(s.linLuma / g.linLuma).toFixed(3)}`
          + `   ALBEDO ${a && gA ? (a.luma / gA.luma).toFixed(3) : "-"}`);
      };
      ratio(wf, wfA, "crate face");
      ratio(wt, wtA, "crate top");
      ratio(bf, bfA, "bridge face");
      console.log(`  exposure ${report.grade.exposure.toFixed(3)}  `
        + `draw calls ${report.render.calls}  triangles ${report.render.triangles}`);
      results[results.length - 1].albedo = {
        ground: gA, crateFace: wfA, crateTop: wtA, bridgeFace: bfA, bridgeTop: btA,
      };
    }

    if (errors.length) console.log(`\n!! ${errors.length} console error(s): ${errors[0]}`);
    if (args.json) {
      await writeFile(path.resolve(root, String(args.json)), JSON.stringify(results, null, 2));
    }
    await page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
