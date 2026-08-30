#!/usr/bin/env node
/* ============================================================
   BLACKSAND - does a shadow rotate a material's hue, and whose
   fault is it: the ALBEDO or the LIGHT?

   The round-10 blind critic called this the whole ballgame: our sand
   rotates hue when it enters shadow, where the reference's materials
   do not. blacksand-shadow-hue.mjs pairs pixels across shadow edges
   over a whole frame and reports no defect, but its 3px window
   straddles the penumbra and mixes the two samples it is supposed to
   separate. This is the controlled version of the same question.

   The rig, standing on open flat sand with nothing else within 12m:

     BOX     one neutral grey cuboid (0x808080, roughness 0.85,
             metalness 0). It exists to cast a shadow, and its own
             faces read the illuminant back: a NEUTRAL albedo can only
             render chromatic if the light is.

     PLATES  four flat neutral cards at linear albedo 0.20, lying on
             the sand at the same normal - two inside the box's shadow
             and two in full sun at the same range. They are the
             control that separates the two candidate causes, and they
             are the whole point of the rig:

               sand   lit -> shade  =  illuminant change  x  albedo
               plate  lit -> shade  =  illuminant change  (albedo is grey)

             If the plates rotate as far as the sand does, the drift is
             in the light and no palette rotation can be responsible
             for it. If the plates hold their hue and the sand does
             not, the rotation is an albedo interaction and PALETTE_HUE
             is a live suspect.

   Every population is read out of ONE capture, so nothing here depends
   on absolute exposure - which moves between runs in this project for
   reasons that have nothing to do with the change under test.

   Sampling. Each pixel is classified by casting through it: physics
   for the world, an analytic slab test against the box for shadow.
   A pixel is only kept when it and four probe points 30cm away on the
   ground AGREE about the sun, which is the penumbra rejection the
   population instrument cannot do. Both populations are then held to
   the same distance band from the box, so sky occlusion near the box
   cannot pose as a colour shift.

   Hue/saturation are computed on the DISPLAY sRGB triple, not on
   linear, because that is the number an art director reads off the
   image. Linear is printed beside it.

   Variants rewrite source literals through an intercepted module
   request - nothing is written to the repo - and the interception is
   asserted, because boot.js pins every module with ?v= and a route
   that silently never fires prints a clean table of identical numbers
   that reads exactly like a disproved hypothesis.

   Usage:
     node scripts/blacksand-shadow-box.mjs
     node scripts/blacksand-shadow-box.mjs --sweep 24,12,0
     node scripts/blacksand-shadow-box.mjs --plan plan.json --sites 4
   ============================================================ */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
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
const PORT = Number(args.port || 47200 + (process.pid % 2000));
const BASE = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE}/games/blacksand.html?qa=1&quality=${args.quality || "ultra"}`;
const WIDTH = Number(args.width || 1280);
const HEIGHT = Number(args.height || 720);
const SITES = Number(args.sites || 5);
const COLS = Number(args.cols || 170);
const TOD = Number(args.tod || 11.2);

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
   as `textures.js?v=<BUILD>` and a Playwright glob stops matching the
   moment a query string appears. */
const MODULE_RE = /\/assets\/js\/blacksand\/[a-z0-9_-]+\.js(\?|$)/i;

async function installRewrite(page, edits) {
  await page.unroute(MODULE_RE).catch(() => {});
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

/* ------------------------------------------------------------------
   Page-side rig.
   ------------------------------------------------------------------ */
function installRig() {
  const T = window.__BS;
  const THREE = T.THREE;
  const W = window;

  W.__SB = {
    rig: null,
    box: null,
    _dir: new THREE.Vector3(),

    toLinear(v) { return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; },
    sun() { return T.ctx.sky.sunDirection.clone().normalize(); },

    /**
     * Open flat sand with a clear line to the sun and nothing built
     * within `clear` metres. Terrain self-shadowing and a neighbouring
     * wall are both illuminant changes we are not asking about, so the
     * site test excludes them rather than trying to model them.
     */
    findSites(want, clear) {
      const physics = T.ctx.physics;
      const terrain = T.ctx.terrain;
      const sun = W.__SB.sun();
      const out = [];
      const STEP = 23;
      for (let x = -430; x <= 430 && out.length < want * 3; x += STEP) {
        for (let z = -430; z <= 430 && out.length < want * 3; z += STEP) {
          const h = terrain.heightAt(x, z);
          let lo = h; let hi = h; let ok = true;
          for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3]]) {
            const y = terrain.heightAt(x + dx, z + dz);
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
          if (hi - lo > 0.45) ok = false;
          if (!ok) continue;
          const p = new THREE.Vector3(x, h + 0.25, z);
          const surf = physics.raycast(new THREE.Vector3(x, h + 30, z),
            new THREE.Vector3(0, -1, 0), 60,
            { layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC });
          if (!surf.hit || !surf.terrain || surf.surface !== "sand") continue;
          if (physics.raycast(p, sun, 400, {
            layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
          }).hit) continue;
          const mask = physics.LAYER.STATIC | physics.LAYER.VEHICLE
            | physics.LAYER.FOLIAGE | physics.LAYER.DYNAMIC;
          let busy = false;
          for (let a = 0; a < 12 && !busy; a += 1) {
            const th = (a / 12) * Math.PI * 2;
            const d = new THREE.Vector3(Math.cos(th), 0.05, Math.sin(th)).normalize();
            if (physics.raycast(p, d, clear, { layer: mask }).hit) busy = true;
          }
          if (busy) continue;
          out.push([x, h, z]);
        }
      }
      // Spread them over the map: adjacent grid cells are the same dune.
      const picked = [];
      for (const s of out) {
        if (picked.every((p) => Math.hypot(p[0] - s[0], p[2] - s[2]) > 120)) picked.push(s);
        if (picked.length >= want) break;
      }
      return picked;
    },

    /**
     * Box plus four neutral cards, and the camera that frames them.
     *
     * The cards must not cast: they are compared against the sand
     * beside them, and a card that shades its own neighbourhood
     * measures itself.
     */
    build(site) {
      if (W.__SB.rig) {
        T.ctx.render.scene.remove(W.__SB.rig);
        W.__SB.rig.traverse((o) => {
          if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
        });
        W.__SB.rig = null;
      }
      const sun = W.__SB.sun();
      const elev = Math.asin(Math.max(0.05, sun.y));
      // Ground direction the shadow runs in, and how far it reaches
      // from the box's own footprint.
      const sd = new THREE.Vector3(-sun.x, 0, -sun.z).normalize();
      const perp = new THREE.Vector3(-sd.z, 0, sd.x);
      // Wide and tall on purpose: the umbra has to be big enough that a
      // useful population of ground pixels sits clear of both the
      // penumbra and the near-field AO skirt around the base.
      const BW = 3.2; const BH = 5.0;
      const reach = BH / Math.tan(elev);

      const group = new THREE.Group();
      group.name = "sb-rig";
      const base = new THREE.Vector3(site[0], site[1], site[2]);

      const boxMat = new THREE.MeshStandardMaterial({
        roughness: 0.85, metalness: 0.0, dithering: true,
      });
      boxMat.color.setHex(0x808080);
      boxMat.name = "sb-box-mat";
      const box = new THREE.Mesh(new THREE.BoxGeometry(BW, BH, BW), boxMat);
      box.name = "sb-box";
      box.position.set(base.x, T.heightAt(base.x, base.z) + BH * 0.5, base.z);
      /* Turned 45 degrees off the shadow axis so the camera, which has
         to stand on the shadow side to see the umbra, still catches one
         face at +45 to the sun and one at -135. That pair - same
         neutral albedo, same vertical orientation, one lit and one not
         - is the only reading here that isolates the illuminant with
         everything else held fixed. Square to the sun it is unreachable:
         the lit face is always the one hidden behind the box. */
      box.rotation.y = Math.atan2(sd.x, sd.z) + Math.PI / 4;
      box.castShadow = true;
      box.receiveShadow = true;
      box.userData.qaOpaque = false;
      group.add(box);

      /* Linear working space with an explicit colour space, so this is
         an ALBEDO and not an sRGB swatch.

         0.50, not the 0.20 first used, and the reason is the whole
         validity of this control: a card in the umbra lands near a
         tenth of its sunlit value, and at albedo 0.20 that put its
         shaded reading at 40/255 carrying two to four COUNTS of
         chroma. Hue from three counts is quantisation, and it duly
         printed 180 degrees on one row. 0.50 puts the shaded card
         alongside the sand it is being compared with, where the same
         hue arithmetic has something to work on. */
      const cardMat = () => {
        const m = new THREE.MeshStandardMaterial({
          roughness: 0.85, metalness: 0.0, dithering: true,
        });
        m.color.setRGB(0.50, 0.50, 0.50, THREE.LinearSRGBColorSpace);
        return m;
      };
      const cardGeo = new THREE.PlaneGeometry(1.5, 1.5);
      cardGeo.rotateX(-Math.PI / 2);

      // Two inside the shadow, two in sun at the same range from the
      // box - matched range matters because the box occludes sky for
      // anything near it and that is a level change, not a colour one.
      const spots = [
        ["shade", BW * 0.5 + reach * 0.28, 0],
        ["shade", BW * 0.5 + reach * 0.62, 0],
        ["lit", 0, BW * 0.5 + reach * 0.28],
        ["lit", 0, BW * 0.5 + reach * 0.62],
      ];
      spots.forEach(([kind, along, side], i) => {
        const px = base.x + sd.x * along + perp.x * side;
        const pz = base.z + sd.z * along + perp.z * side;
        const m = new THREE.Mesh(cardGeo, cardMat());
        m.name = `sb-card-${i}`;
        m.userData.want = kind;
        m.position.set(px, T.heightAt(px, pz) + 0.04, pz);
        m.castShadow = false;
        m.receiveShadow = true;
        m.userData.qaOpaque = false;
        group.add(m);
      });

      T.ctx.render.scene.add(group);
      W.__SB.rig = group;
      W.__SB.box = {
        centre: box.position.toArray(),
        half: [BW * 0.5, BH * 0.5, BW * 0.5],
        yaw: box.rotation.y,
        sd: sd.toArray(),
        perp: perp.toArray(),
        reach,
      };

      /* Camera: off to the side of the shadow strip and above it, so
         the frame carries the shadow, the cards and open sunlit sand
         at one range. Looking down the shadow's own axis would put the
         box between the eye and half of what is being measured. */
      const mid = new THREE.Vector3(
        base.x + sd.x * (BW * 0.5 + reach * 0.45),
        base.y,
        base.z + sd.z * (BW * 0.5 + reach * 0.45)
      );
      const eye = mid.clone()
        .addScaledVector(perp, 7.5)
        .addScaledVector(sd, 1.5);
      eye.y = T.heightAt(eye.x, eye.z) + 5.2;
      T.lookAt(eye.toArray(), [mid.x, mid.y + 0.2, mid.z], 46);
      return { reach, elevDeg: (elev * 180) / Math.PI, box: W.__SB.box };
    },

    /**
     * Sunlit masonry, for costing a palette change against the walls.
     *
     * Walls are found through PHYSICS COLLIDERS rather than by hunting
     * for them in a beauty pose, for the reason the figure/ground round
     * paid for: structures.js merges by material AND cell, so a mesh
     * name names the draw call and not the object. A collider carries
     * the SURFACE the piece was placed with.
     *
     * Masonry is measured on its OWN pixels rather than through a
     * frame band. The frame-level hue metric is saturation-weighted, so
     * it is set by whatever chromatic surface happens to be in view -
     * which is exactly how a hue target got adopted and then withdrawn
     * on this project.
     */
    /**
     * Median LINEAR hue and saturation of every generated albedo, so a
     * palette change can be read at SOURCE as well as at the frame.
     * palette() early-outs on any texel with less than 1/512 of chroma,
     * so a mostly-grey generator is barely rotated however large the
     * constant is - and that is invisible from the frame alone.
     */
    albedoCensus() {
      const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const out = [];
      for (const name of T.ctx.textures.list()) {
        let set = null;
        try { set = T.ctx.textures.get(name); } catch (e) { continue; }
        const img = set && set.map && set.map.image;
        if (!img || !img.data) continue;
        const d = img.data;
        const step = Math.max(4, (Math.floor(d.length / 4 / 20000) * 4) || 4);
        const hs = []; const ss = [];
        for (let i = 0; i < d.length; i += step) {
          const r = toLin(d[i] / 255); const g = toLin(d[i + 1] / 255); const b = toLin(d[i + 2] / 255);
          const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const dd = mx - mn;
          let h = 0;
          if (dd > 1e-6) {
            if (mx === r) h = 60 * (((g - b) / dd) % 6);
            else if (mx === g) h = 60 * ((b - r) / dd + 2);
            else h = 60 * ((r - g) / dd + 4);
            if (h < 0) h += 360;
          }
          hs.push(h); ss.push(mx > 1e-6 ? dd / mx : 0);
        }
        const m = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
        out.push({ name, hue: m(hs), sat: m(ss) });
      }
      return out;
    },

    /* Stands come from the shipped poses rather than from collider
       geometry. Enumerating faces was tried first and picked nothing:
       structures.js colliders are ORIENTED boxes, so deriving a face
       normal from halfExtents and world axes is wrong for every wall
       that is not axis-aligned, and the sun's horizontal component is
       split across x and z so a per-axis dot never clears a sensible
       threshold. Framing bias does not matter here the way it does for
       a frame statistic: every sample is classified by the physics
       surface it hit, so the pose decides WHICH walls are measured, not
       what a wall pixel reads. */
    wallPoses() {
      return T.listPoses().map((p) => p.id);
    },

    aimPose(id, tod) {
      if (W.__SB.rig) {
        T.ctx.render.scene.remove(W.__SB.rig);
        W.__SB.rig = null;
      }
      W.__SB.box = null;
      if (!T.setPose(id)) return false;
      T.setTimeOfDay(tod);
      return true;
    },

    /** Sunlit, near-vertical masonry pixels in the current frame. */
    async readWall(cols) {
      const cam = T.ctx.render.camera;
      const physics = T.ctx.physics;
      const sun = W.__SB.sun();
      const url = T.captureDataURL("image/png");
      const img = await new Promise((res) => {
        const im = new Image(); im.onload = () => res(im); im.src = url;
      });
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const g2 = cv.getContext("2d");
      g2.drawImage(img, 0, 0);
      const px = g2.getImageData(0, 0, cv.width, cv.height).data;

      const groups = {};
      const ROWS = Math.max(2, Math.round((cols * cv.height) / cv.width));
      for (let iy = 0; iy < ROWS; iy += 1) {
        for (let ix = 0; ix < cols; ix += 1) {
          const ndcX = ((ix + 0.5) / cols) * 2 - 1;
          const ndcY = 1 - ((iy + 0.5) / ROWS) * 2;
          const dir = W.__SB._dir.set(ndcX, ndcY, 0.5).unproject(cam)
            .sub(cam.position).normalize();
          const ph = physics.raycast(cam.position, dir, 40, {
            layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
          });
          if (!ph.hit || ph.terrain || ph.surface !== "concrete") continue;
          if (Math.abs(ph.normal.y) > 0.25) continue;          // a face, not a coping
          if (ph.normal.dot(sun) < 0.25) continue;
          const above = ph.point.clone().addScaledVector(ph.normal, 0.06);
          if (physics.raycast(above, sun, 300, {
            layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
          }).hit) continue;
          const sxp = Math.floor((ndcX * 0.5 + 0.5) * cv.width);
          const syp = Math.floor((1 - (ndcY * 0.5 + 0.5)) * cv.height);
          const o = (syp * cv.width + sxp) * 4;
          (groups.wall || (groups.wall = [])).push([px[o], px[o + 1], px[o + 2]]);
        }
      }
      const out = {};
      for (const [k, v] of Object.entries(groups)) out[k] = W.__SB.summarise(v);
      return out;
    },

    /** Analytic slab test against the box, in the box's own frame. */
    boxBlocks(px, py, pz, dir) {
      const b = W.__SB.box;
      const c = Math.cos(-b.yaw); const s = Math.sin(-b.yaw);
      const ox = px - b.centre[0]; const oy = py - b.centre[1]; const oz = pz - b.centre[2];
      const lx = ox * c - oz * s; const lz = ox * s + oz * c;
      const dx = dir.x * c - dir.z * s; const dz = dir.x * s + dir.z * c;
      const o = [lx, oy, lz]; const d = [dx, dir.y, dz];
      let t0 = -Infinity; let t1 = Infinity;
      for (let i = 0; i < 3; i += 1) {
        if (Math.abs(d[i]) < 1e-8) {
          if (Math.abs(o[i]) > b.half[i]) return false;
        } else {
          const a = (-b.half[i] - o[i]) / d[i];
          const bb = (b.half[i] - o[i]) / d[i];
          t0 = Math.max(t0, Math.min(a, bb));
          t1 = Math.min(t1, Math.max(a, bb));
        }
      }
      return t1 >= Math.max(t0, 0.0);
    },

    /**
     * Is this ground point in sun, in the box's umbra, or neither?
     *
     * Four probes 30cm out on the ground must agree with the centre.
     * A pixel in the penumbra disagrees with at least one of them and
     * is dropped - which is the whole difference between this and the
     * population instrument, whose window spans the penumbra and
     * averages the two answers together.
     */
    classify(point) {
      const physics = T.ctx.physics;
      const sun = W.__SB.sun();
      const P = 0.30;
      let lit = 0; let shade = 0;
      for (const [dx, dz] of [[0, 0], [P, 0], [-P, 0], [0, P], [0, -P]]) {
        const x = point.x + dx; const z = point.z + dz;
        const y = point.y + 0.06;
        if (W.__SB.boxBlocks(x, y, z, sun)) shade += 1;
        else if (physics.raycast(new THREE.Vector3(x, y, z), sun, 400, {
          layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
        }).hit) return null;                  // world shadow, not the rig's
        else lit += 1;
      }
      if (lit === 5) return "lit";
      if (shade === 5) return "shade";
      return null;                            // penumbra
    },

    /** One capture, classified. */
    async read(cols) {
      const cam = T.ctx.render.camera;
      const physics = T.ctx.physics;
      const b = W.__SB.box;
      const sd = new THREE.Vector3().fromArray(b.sd);
      const url = T.captureDataURL("image/png");
      const img = await new Promise((res) => {
        const im = new Image(); im.onload = () => res(im); im.src = url;
      });
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const g2 = cv.getContext("2d");
      g2.drawImage(img, 0, 0);
      const px = g2.getImageData(0, 0, cv.width, cv.height).data;

      const groups = {};
      const push = (k, rgb) => { (groups[k] || (groups[k] = [])).push(rgb); };
      // Both sand populations are held to the same band of distance
      // from the box so that near-field sky occlusion, which is a level
      // effect, cannot masquerade as a colour one.
      const NEAR = Math.max(1.3, b.half[0] + 0.5);
      const FAR = b.half[0] + b.reach * 0.95;

      const ROWS = Math.max(2, Math.round((cols * cv.height) / cv.width));
      for (let iy = 0; iy < ROWS; iy += 1) {
        for (let ix = 0; ix < cols; ix += 1) {
          const ndcX = ((ix + 0.5) / cols) * 2 - 1;
          const ndcY = 1 - ((iy + 0.5) / ROWS) * 2;
          const dir = W.__SB._dir.set(ndcX, ndcY, 0.5).unproject(cam)
            .sub(cam.position).normalize();
          const ph = physics.raycast(cam.position, dir, 60, {
            layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC
              | physics.LAYER.VEHICLE | physics.LAYER.FOLIAGE | physics.LAYER.DYNAMIC,
          });
          let hit = ph.hit ? { name: ph.terrain ? "terrain" : "world", ...ph } : null;
          if (W.__SB.rig) {
            const r = new THREE.Raycaster(cam.position, dir.clone());
            r.far = hit ? hit.distance : 60;
            const rh = r.intersectObjects(W.__SB.rig.children, false)[0];
            if (rh && rh.face) {
              const nm = new THREE.Matrix3().getNormalMatrix(rh.object.matrixWorld);
              hit = {
                name: rh.object.name,
                point: rh.point,
                normal: rh.face.normal.clone().applyNormalMatrix(nm).normalize(),
                distance: rh.distance,
                terrain: false,
                surface: null,
              };
            }
          }
          if (!hit) continue;

          const sxp = Math.floor((ndcX * 0.5 + 0.5) * cv.width);
          const syp = Math.floor((1 - (ndcY * 0.5 + 0.5)) * cv.height);
          const o = (syp * cv.width + sxp) * 4;
          const rgb = [px[o], px[o + 1], px[o + 2]];

          if (hit.name === "sb-box") {
            const n = hit.normal;
            const sun = W.__SB.sun();
            if (n.y > 0.9) push("boxTop", rgb);
            else if (Math.abs(n.y) < 0.2) {
              if (n.dot(sun) > 0.25) push("boxSunSide", rgb);
              else if (n.dot(sun) < -0.25) push("boxDarkSide", rgb);
            }
            continue;
          }
          if (/^sb-card-/.test(hit.name)) {
            if (hit.normal.y < 0.9) continue;
            const k = W.__SB.classify(hit.point);
            if (k) push(`card-${k}`, rgb);
            continue;
          }
          if (!hit.terrain || hit.surface !== "sand") continue;
          if (hit.normal.y < 0.94) continue;    // a slope is a cosine change
          const off = new THREE.Vector3(hit.point.x - b.centre[0], 0,
            hit.point.z - b.centre[2]);
          const d = off.length();
          if (d < NEAR || d > FAR) continue;
          // Reject the strip immediately behind the box, which is
          // neither shadow nor clean sun at this sun angle.
          if (off.dot(sd) < -0.2 * d && d < NEAR + 1.0) continue;
          const k = W.__SB.classify(hit.point);
          if (k) push(`sand-${k}`, rgb);
        }
      }
      const out = {};
      for (const [k, v] of Object.entries(groups)) out[k] = W.__SB.summarise(v);
      return out;
    },

    /**
     * Medians per channel, so one specular sliver or one foliage pixel
     * cannot move a population.
     */
    summarise(list) {
      const n = list.length;
      if (!n) return null;
      const med = (arr) => {
        const s = arr.slice().sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };
      const r = med(list.map((c) => c[0]));
      const g = med(list.map((c) => c[1]));
      const b = med(list.map((c) => c[2]));
      const lin = [W.__SB.toLinear(r / 255), W.__SB.toLinear(g / 255), W.__SB.toLinear(b / 255)];
      return { n, srgb: [r, g, b], linear: lin };
    },
  };
  return true;
}

/* ------------------------------------------------------------------
   Node-side maths.
   ------------------------------------------------------------------ */

function hueOf(r, g, b) {
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
  if (d < 1e-9) return null;
  let h;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return h < 0 ? h + 360 : h;
}
const satOf = (r, g, b) => {
  const mx = Math.max(r, g, b);
  return mx > 1e-9 ? (mx - Math.min(r, g, b)) / mx : 0;
};

/* Below this many 8-bit counts between max and min channel, a hue is
   an artefact of rounding and not a measurement. A shaded neutral card
   printed 180 degrees on one row and 240 on another off three counts
   and zero counts respectively; both are "grey", and saying so is the
   honest answer. */
const CHROMA_FLOOR = 4;

function describe(s) {
  if (!s) return null;
  const [r, g, b] = s.srgb;
  const [lr, lg, lb] = s.linear;
  const counts = Math.max(r, g, b) - Math.min(r, g, b);
  return {
    n: s.n,
    srgb: s.srgb.slice(),
    counts,
    hue: counts < CHROMA_FLOOR ? null : hueOf(r, g, b),
    sat: satOf(r, g, b),
    gr: r > 0 ? g / r : 0,
    linHue: hueOf(lr, lg, lb),
    linSat: satOf(lr, lg, lb),
    luma: 0.2126 * lr + 0.7152 * lg + 0.0722 * lb,
  };
}

const med = (xs) => {
  const v = xs.filter((x) => x !== null && Number.isFinite(x));
  return v.length ? v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)] : NaN;
};
/* "grey" is a result, not a missing value: a neutral albedo that comes
   back achromatic in shade is telling you the fill it received is
   achromatic. Printing NaN would hide the finding. */
const fmtHue = (h) => (Number.isFinite(h) ? h.toFixed(1) : "grey");

function drift(a, b) {
  if (a === null || b === null) return NaN;
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
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
  const want = new Set((edits || []).map((e) => e.file));
  const got = await seen();
  for (const f of want) {
    if (!got.has(f)) {
      throw new Error(`variant edit never reached the browser: ${f} was not intercepted`);
    }
  }
  page.__bsErrors = errors;
  return page;
}

async function runVariant(page, sites, gradePatch) {
  const rows = [];
  for (const site of sites) {
    const info = await page.evaluate((s) => window.__SB.build(s), site);
    /* grade() writes only the keys it is given, so a sweep of partial
       patches accumulates - row 5 still carrying rows 2-4 is how a
       previous round read "every lever darkens the frame". Every patch
       passed in here is a full reset of the keys under test. */
    if (gradePatch) await page.evaluate((g) => window.__BS.grade(g), gradePatch);
    await page.evaluate(() => window.__BS.advanceTime(2.0, 1 / 60));
    await page.evaluate(() => { for (let i = 0; i < 8; i += 1) window.__BS.renderOnce(1 / 60); });
    const by = await page.evaluate((c) => window.__SB.read(c), COLS);
    rows.push({ site, info, by });
  }
  await page.evaluate(() => {
    if (window.__SB.rig) {
      window.__BS.ctx.render.scene.remove(window.__SB.rig);
      window.__SB.rig = null;
    }
  });
  return rows;
}

function report(label, rows, opts = {}) {
  const pick = (k) => rows.map((r) => describe(r.by[k])).filter(Boolean);
  const sandLit = pick("sand-lit"); const sandShade = pick("sand-shade");
  const cardLit = pick("card-lit"); const cardShade = pick("card-shade");
  const boxTop = pick("boxTop"); const boxDark = pick("boxDarkSide");
  const boxSun = pick("boxSunSide");

  const line = (name, xs) => {
    if (!xs.length) return `  ${name.padEnd(20)} (no samples)`;
    const rgb = [0, 1, 2].map((c) => med(xs.map((x) => x.srgb[c])).toFixed(0).padStart(3));
    return `  ${name.padEnd(20)} hue ${fmtHue(med(xs.map((x) => x.hue))).padStart(5)}   `
      + `sat ${med(xs.map((x) => x.sat)).toFixed(3)}   `
      + `G/R ${med(xs.map((x) => x.gr)).toFixed(3)}   `
      + `luma ${med(xs.map((x) => x.luma)).toFixed(4)}   `
      // The raw triple, because hue from a handful of 8-bit counts is
      // quantisation and the only way to see that is to see the counts.
      + `sRGB ${rgb.join(",")}   n=${xs.reduce((a, x) => a + x.n, 0)}`;
  };

  if (!opts.terse) {
    console.log(`\n--- ${label} ---`);
    console.log(line("sunlit sand", sandLit));
    console.log(line("sand in box shadow", sandShade));
    console.log(line("neutral card, lit", cardLit));
    console.log(line("neutral card, shade", cardShade));
    console.log(line("box top (lit)", boxTop));
    console.log(line("box sun side", boxSun));
    console.log(line("box dark side", boxDark));
  }

  const perSite = (a, b) => rows.map((r) => {
    const x = describe(r.by[a]); const y = describe(r.by[b]);
    if (!x || !y) return null;
    return {
      d: (x.hue === null || y.hue === null) ? null : drift(x.hue, y.hue),
      s: y.sat / Math.max(x.sat, 1e-4),
      gr: y.gr / Math.max(x.gr, 1e-4),
    };
  }).filter(Boolean);

  const sand = perSite("sand-lit", "sand-shade");
  const card = perSite("card-lit", "card-shade");
  /* The cleanest pair in the rig: one neutral albedo, one orientation,
     sun on and sun off. Nothing about the material, the normal or the
     range differs between the two, so the whole difference is the
     colour of the light. */
  const face = perSite("boxSunSide", "boxDarkSide");
  return {
    label,
    faceDrift: med(face.map((x) => x.d)),
    faceSat: med(face.map((x) => x.s)),
    boxSunHue: med(boxSun.map((x) => x.hue)),
    boxSunSat: med(boxSun.map((x) => x.sat)),
    sandDrift: med(sand.map((x) => x.d)),
    sandSat: med(sand.map((x) => x.s)),
    sandGr: med(sand.map((x) => x.gr)),
    cardDrift: med(card.map((x) => x.d)),
    cardSat: med(card.map((x) => x.s)),
    cardGr: med(card.map((x) => x.gr)),
    litHue: med(sandLit.map((x) => x.hue)),
    shadeHue: med(sandShade.map((x) => x.hue)),
    cardLitHue: med(cardLit.map((x) => x.hue)),
    cardShadeHue: med(cardShade.map((x) => x.hue)),
    boxTopHue: med(boxTop.map((x) => x.hue)),
    boxTopSat: med(boxTop.map((x) => x.sat)),
    boxDarkHue: med(boxDark.map((x) => x.hue)),
    boxDarkSat: med(boxDark.map((x) => x.sat)),
    n: sand.length,
  };
}

const HUE_ANCHOR = "const PALETTE_HUE = 24;";

async function main() {
  const sweep = args.sweep && args.sweep !== true
    ? String(args.sweep).split(",").map((s) => Number(s.trim()))
    : null;
  let plan;
  if (args.plan) plan = JSON.parse(await readFile(path.resolve(root, args.plan), "utf8"));
  else if (args.grade) {
    /* Lit and shaded populations sit a factor of ten apart in
       luminance, and every level-dependent term in the grade therefore
       treats them differently. Whatever drift survives this row is the
       LIGHT; whatever disappears was the curve. Each row is a full
       reset of all three keys - grade() writes only what it is given. */
    plan = [{
      name: "shipped",
      edits: [],
      grades: [
        { __label: "as shipped", shadowLift: 0.085, satRoll: 0.55, saturation: 0.98, ao: 0.95 },
        { __label: "flat curve", shadowLift: 0.0, satRoll: 0.0, saturation: 1.0, ao: 0.95 },
        { __label: "no AO", shadowLift: 0.085, satRoll: 0.55, saturation: 0.98, ao: 0.0 },
      ],
    }];
  } else if (args.fill) {
    /* Which term actually lights a vertical shaded face? The two
       candidates are the hemisphere light and the environment probe's
       diffuse share, and they are the same warm colour at one end, so
       arguing about it from the constants does not settle it. Killing
       each in turn and reading the neutral grey face does. */
    plan = [
      { name: "shipped", edits: [] },
      {
        name: "hemisphere off",
        edits: [{
          file: "sky.js",
          from: "render.hemi.intensity = intensity * GROUND_BOUNCE * bounceScale;",
          to: "render.hemi.intensity = 0.0;",
        }],
      },
      {
        name: "probe diffuse off",
        edits: [{ file: "render.js", from: "const ENV_DIFFUSE = 0.066;", to: "const ENV_DIFFUSE = 0.0;" }],
      },
    ];
  } else if (args.bounce) {
    /* Two ways to take chroma out of a vertical shaded face, and they
       have different costs.

       TINT desaturates the warm half at constant luminance, so no
       normal changes brightness - only the colour of the ground end.

       ON_UP raises the sky end and lowers the intensity by the
       reciprocal, which pins the up-facing case bit-for-bit (the
       pairing GROUND_BOUNCE x BOUNCE_ON_UP is a constant) and divides
       the warm term at every other normal. It desaturates AND dims the
       vertical and downward halves.

       The mix at a vertical normal is fixed at 50/50 by three's
       hemisphere maths, so the only thing that can move its colour is
       the LUMINANCE RATIO between the two ends. */
    const onUp = (u) => ({
      file: "sky.js", from: "const BOUNCE_ON_UP = 0.325;", to: `const BOUNCE_ON_UP = ${u};`,
    });
    const gb = (g) => ({
      file: "sky.js", from: "const GROUND_BOUNCE = 0.28;", to: `const GROUND_BOUNCE = ${g};`,
    });
    const tint = (t) => ({
      file: "sky.js",
      from: "const bounceTint = sunColour.clone().lerp(new THREE.Color(0.90, 0.66, 0.36), 0.40);",
      to: `const bounceTint = sunColour.clone().lerp(new THREE.Color(0.90, 0.66, 0.36), ${t});`,
    });
    plan = [
      { name: "shipped", edits: [] },
      { name: "tint 0.25", edits: [tint(0.25)] },
      { name: "tint 0.15", edits: [tint(0.15)] },
      { name: "onUp 0.55", edits: [onUp(0.55), gb(0.1655)] },
      { name: "onUp 0.80", edits: [onUp(0.80), gb(0.1138)] },
      { name: "tint .25 onUp .55", edits: [tint(0.25), onUp(0.55), gb(0.1655)] },
    ];
  } else if (sweep) {
    plan = sweep.map((v) => ({
      name: `PALETTE_HUE ${v}`,
      edits: v === 24 ? [] : [{
        file: "textures.js", from: HUE_ANCHOR, to: `const PALETTE_HUE = ${v};`,
      }],
    }));
  } else plan = [{ name: "shipped", edits: [] }];

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

    /* Sites are solved on a page of their own and reused verbatim.
       They depend only on terrain and colliders, neither of which any
       variant here touches, and re-solving per variant would let the
       comparison drift onto different ground. */
    const rigMode = !args.masonry && !args.albedo;
    const solver = await bootPage(context, []);
    /* Sites are solved on a page of their own and reused verbatim by
       every variant. They depend only on terrain and colliders, which
       nothing swept here touches, and re-solving per variant would let
       the comparison wander onto different ground. */
    const sites = rigMode ? await page0(solver) : [];
    const walls = args.masonry ? await solver.evaluate(() => window.__SB.wallPoses()) : [];
    await solver.close();
    if (args.masonry) console.log(`masonry stands: ${walls.length} poses, tod pinned ${TOD}`);
    else if (rigMode) console.log(`sites: ${sites.map((s) => `(${s[0]},${s[2].toFixed(0)})`).join(" ")}`);

    if (args.albedo) {
      const cols = [];
      for (const variant of plan) {
        const page = await bootPage(context, variant.edits);
        cols.push({ name: variant.name, rows: await page.evaluate(() => window.__SB.albedoCensus()) });
        await page.close();
      }
      const names = cols[0].rows.map((r) => r.name).sort();
      console.log(`\nalbedo hue at source (median LINEAR hue / sat)\n`
        + `map            ${cols.map((c) => c.name.padEnd(18)).join("")}`);
      for (const n of names) {
        const cells = cols.map((c) => {
          const r = c.rows.find((x) => x.name === n);
          return r ? `${r.hue.toFixed(1)}/${r.sat.toFixed(3)}`.padEnd(18) : "-".padEnd(18);
        });
        console.log(`${n.padEnd(14)} ${cells.join("")}`);
      }
      return;
    }

    if (args.masonry) {
      if (!walls.length) {
        const page = await bootPage(context, []);
        const census = await page.evaluate(() => {
          const by = {};
          for (const c of window.__BS.ctx.physics.colliders) {
            if (!c.active) continue;
            const h = c.halfExtents;
            const k = c.surface || "?";
            const b = (by[k] || (by[k] = { n: 0, tall: 0, thin: 0 }));
            b.n += 1;
            if (h.y >= 1.2) b.tall += 1;
            if (h.y >= 1.2 && Math.min(h.x, h.z) <= 1.2 && Math.max(h.x, h.z) >= 1.5) b.thin += 1;
          }
          return by;
        });
        await page.close();
        console.log("collider census (surface: total / y>=1.2 / wall-shaped):");
        for (const [k, v] of Object.entries(census)) {
          console.log(`  ${k.padEnd(10)} ${v.n} / ${v.tall} / ${v.thin}`);
        }
        throw new Error("no sunlit masonry face found");
      }
      console.log("\nvariant             sunlit masonry   hue    sat    sRGB          n");
      for (const variant of plan) {
        const page = await bootPage(context, variant.edits);
        const per = [];
        for (const w of walls) {
          const ok = await page.evaluate((a) => window.__SB.aimPose(a.id, a.tod), { id: w, tod: TOD });
          if (!ok) throw new Error(`setPose("${w}") returned false`);
          await page.evaluate(() => window.__BS.advanceTime(2.0, 1 / 60));
          await page.evaluate(() => {
            for (let i = 0; i < 8; i += 1) window.__BS.renderOnce(1 / 60);
          });
          const by = await page.evaluate((c) => window.__SB.readWall(c), COLS);
          const d = describe(by.wall);
          if (d && d.n >= 60) per.push({ ...d, pose: w });
        }
        console.log(`${variant.name.padEnd(20)}`
          + `${fmtHue(med(per.map((x) => x.hue)))}`.padStart(15)
          + `${med(per.map((x) => x.sat)).toFixed(3)}`.padStart(8)
          + `   ${[0, 1, 2].map((c) => med(per.map((x) => x.srgb[c])).toFixed(0)).join(",")}`
          + `   luma ${med(per.map((x) => x.luma)).toFixed(4)}`
          + `   poses=${per.length}  n=${per.reduce((a, x) => a + x.n, 0)}`);
        if (args.verbose) {
          for (const p of per) {
            console.log(`      ${String(p.pose).padEnd(16)} hue ${fmtHue(p.hue).padStart(5)}`
              + `  sat ${p.sat.toFixed(3)}  sRGB ${p.srgb.join(",")}  n=${p.n}`);
          }
        }
        if (page.__bsErrors.length) {
          console.log(`   !! ${page.__bsErrors.length} page error(s): ${page.__bsErrors[0]}`);
        }
        await page.close();
      }
      return;
    }

    const summary = [];
    for (const variant of plan) {
      const page = await bootPage(context, variant.edits);
      for (const g of (variant.grades || [null])) {
        const rows = await runVariant(page, sites, g);
        const tag = g && g.__label ? `${variant.name} ${g.__label}` : variant.name;
        summary.push(report(tag, rows, { terse: Boolean(args.terse) }));
      }
      if (page.__bsErrors.length) {
        console.log(`   !! ${page.__bsErrors.length} page error(s): ${page.__bsErrors[0]}`);
      }
      await page.close();
    }

    const sgn = (v) => (Number.isFinite(v) ? (v >= 0 ? "+" : "") + v.toFixed(1) : "grey");
    console.log("\n=== lit -> shade on the SAME surface, penumbra excluded ===");
    console.log("                      SAND (chromatic albedo)      "
      + "NEUTRAL GREY, same normal    NEUTRAL GREY, vertical face");
    console.log("variant             drift   sat x   G/R x       "
      + "drift   sat x   G/R x        drift   sat x");
    for (const s of summary) {
      console.log(`${s.label.padEnd(18)}`
        + `${sgn(s.sandDrift)}`.padStart(7)
        + `${s.sandSat.toFixed(3)}`.padStart(8)
        + `${s.sandGr.toFixed(3)}`.padStart(8) + "    "
        + `${sgn(s.cardDrift)}`.padStart(9)
        + `${s.cardSat.toFixed(3)}`.padStart(8)
        + `${s.cardGr.toFixed(3)}`.padStart(8) + "    "
        + `${sgn(s.faceDrift)}`.padStart(9)
        + `${s.faceSat.toFixed(3)}`.padStart(8));
    }
    console.log("\n                    sand lit -> shade    grey card lit -> shade   "
      + "grey face lit (h/s)   grey face shade (h/s)");
    for (const s of summary) {
      console.log(`${s.label.padEnd(18)}`
        + `${fmtHue(s.litHue)} -> ${fmtHue(s.shadeHue)}`.padStart(20)
        + `${fmtHue(s.cardLitHue)} -> ${fmtHue(s.cardShadeHue)}`.padStart(24)
        + `${fmtHue(s.boxSunHue)}/${s.boxSunSat.toFixed(3)}`.padStart(22)
        + `${fmtHue(s.boxDarkHue)}/${s.boxDarkSat.toFixed(3)}`.padStart(24));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

async function page0(page) {
  const sites = await page.evaluate((n) => window.__SB.findSites(n, 12), SITES);
  if (!sites.length) throw new Error("no open flat sand site found");
  return sites;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
