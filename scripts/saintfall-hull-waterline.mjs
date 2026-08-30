#!/usr/bin/env node
/* ============================================================
   SAINTFALL - THE GREEN ANTIPHON - the hull's waterline

   Four blind rounds in a row have named the same seam, and in
   four different ways, so this instrument answers four separate
   questions rather than one:

     1. IS THE HULL SEE-THROUGH?  Round 10 measured 0.09-0.15 % on
        `spine` and `hold` and called it silhouette antialiasing.
        A round-11 judge still saw water THROUGH the bow. So the
        meter is re-run at the BOW, which round 10 never framed.

        The method is round 10's and it is a three-render
        agreement test: render the composited frame (A), render it
        again with every wreck group hidden (B), and render a pure
        silhouette of the wreck alone against green (M). A pixel
        that M says is ship and where A and B agree to within
        `--tol` display levels is a pixel where the ship drew
        nothing - which is what "see-through" means as a number.

     2. IS THERE A DRAFT?  Per column of the silhouette, find the
        LOWEST ship pixel - the waterline - and read the ship's own
        luminance in three screen bands above it. A hull that sits
        IN water gets darker as it goes down. The level's sea-glare
        fill term was written to do the exact opposite ("puts the
        ship's brightest shade-side value ON THE WATERLINE"), so
        this reports the sign of the gradient, not just its size.

     3. IS THERE CONTACT?  The same columns, read DOWNWARD into the
        water: mean luminance 0-10 px under the hull against 60-90
        px under it. A hundred-metre hull darkens the water it
        stands in; equal numbers mean the water does not know the
        ship is there.

     4. IS THERE A WHITE SKIRT?  The brightest 2 % of the pixels in
        the 0-14 px band straddling the waterline, and what
        fraction of that band is brighter than the frame's own p98.
        The collar was added in round 10 and three judges then
        described it as "a white skirt", so the question is whether
        it is the brightest thing at the seam.

   Everything is reported in DISPLAY sRGB levels, because that is
   the space the judges' words live in.

   Usage:
     node scripts/saintfall-hull-waterline.mjs
     node scripts/saintfall-hull-waterline.mjs --pose spine,bow,hold
     node scripts/saintfall-hull-waterline.mjs --json out.json
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
const POSES = String(args.pose || args.poses || "spine,bow,prow,hold,band")
  .split(",").map((s) => s.trim()).filter(Boolean);
const TIME = String(args.time || "trade");
const QUALITY = String(args.quality || "ultra");
/* 3/255. The same tolerance round 10's meter used, and it is one
   step above the composite's own dither - at 1 the meter reports
   the dither as see-through, at 8 a genuinely half-transparent
   plate over water of a similar value passes. */
const TOL = Number(args.tol || 3);
const PORT = Number(args.port || 45100 + (process.pid % 5000));
const PAGE = String(args.page || "saintfall-green-antiphon.html");
const URL = `http://127.0.0.1:${PORT}/games/${PAGE}`
  + `?qa=1&quality=${QUALITY}&time=${TIME}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

async function waitForServer() {
  for (let i = 0; i < 200; i += 1) {
    try { const r = await fetch(URL, { cache: "no-store" }); if (r.ok) return; } catch (_) {}
    await delay(100);
  }
  throw new Error("server never came up");
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: [
      "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
      "--disable-gpu-vsync", "--force-device-scale-factor=1",
      "--hide-scrollbars", "--mute-audio",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  page.on("pageerror", (e) => logs.push("[pageerror] " + e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__SF, null, { timeout: 240000 });

  const out = await page.evaluate(async ({ poses, tol, dump }) => {
    const T = window.__SF;
    T.maximize();

    async function grab() {
      const url = T.captureDataURL();
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = url; });
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      return { d: g.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
    }

    function wreckRoots() {
      const found = [];
      T.render.scene.traverse((o) => {
        if (typeof o.name === "string" && /^antiphon-/.test(o.name)) found.push(o);
      });
      return found;
    }

    const lum = (d, p) => d[p] * 0.2126 + d[p + 1] * 0.7152 + d[p + 2] * 0.0722;

    /* THE SHIP'S MATERIALS, and the set has to be closed over the
       whole scene rather than over the four wreck groups.

       The debris field is built by atoll-world and added to the
       world group, not under any antiphon-* root, but it is drawn
       with the SAME `hull` and `rust` materials the wreck is. The
       first draft of this probe hid the four groups and then
       coloured the materials, so the debris was magenta in the
       mask and still present in the wreck-hidden render - which
       scored every debris pixel as see-through and put `spine` at
       19.8 %. The hide set and the colour set must be the same
       set, and the honest definition of "the ship" here is "drawn
       with the ship's materials". */
    function wreckMaterials() {
      const mats = new Set();
      for (const r of wreckRoots()) {
        r.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          if (Array.isArray(o.material)) o.material.forEach((m) => mats.add(m));
          else mats.add(o.material);
        });
      }
      return mats;
    }

    function wreckMeshes(mats) {
      const found = [];
      T.render.scene.traverse((o) => {
        if (!(o.isMesh || o.isPoints || o.isInstancedMesh) || !o.material) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        if (ms.some((m) => mats.has(m))) found.push(o);
      });
      return found;
    }

    function hideWreck(mats) {
      const hidden = [];
      for (const o of wreckMeshes(mats)) {
        if (o.visible) { hidden.push(o); o.visible = false; }
      }
      return hidden;
    }

    /* THE MASK IS A MAGENTA RENDER WITH THE REST OF THE SCENE
       STILL IN IT, and the first draft of this probe got that
       wrong in a way that reported a level-wide catastrophe.

       Hiding everything but the wreck gives you the wreck's
       SILHOUETTE, which includes every part of it that is behind a
       palm, behind the treeline or behind the island. Those pixels
       are identical in A and in the wreck-hidden B - correctly, the
       ship is not visible there - and the agreement test then
       scores them as see-through. On `prow`, where the hull is
       buried behind the canopy, that draft read 79.3 %.

       Leaving the scene in place and colouring only the wreck
       means a magenta pixel is a pixel where the ship is the
       FRONTMOST thing, which is the only set the question is
       about. Magenta and not white: the composite is skipped for
       this render, so a clipped sky or a specular can reach
       255,255,255, and the green channel is what separates them. */
    async function silhouette(mats) {
      const swapped = [];
      for (const m of mats) {
        swapped.push([m, m.emissive ? m.emissive.getHex() : null,
          m.emissiveIntensity, m.vertexColors, m.color.getHex()]);
        if (m.emissive) m.emissive.setRGB(1, 0, 1);
        m.emissiveIntensity = 1;
        m.vertexColors = false;
        m.color.setRGB(0, 0, 0);
        m.needsUpdate = true;
      }
      const scene = T.render.scene;
      const r = T.render.renderer;
      const prevTarget = r.getRenderTarget();
      const bg = scene.background;
      scene.background = null;
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, true);
      r.render(scene, T.render.camera);
      const S = await grab();
      scene.background = bg;
      for (const [m, em, ei, vc, col] of swapped) {
        if (em !== null && m.emissive) m.emissive.setHex(em);
        m.emissiveIntensity = ei;
        m.vertexColors = vc;
        m.color.setHex(col);
        m.needsUpdate = true;
      }
      r.setRenderTarget(prevTarget);
      T.renderStill();
      return S;
    }

    /* Custom cameras. The Spine's station and heading come from the
       hook rather than from a literal, so a moved wreck cannot make
       this probe silently frame open water. */
    const st = T.atoll.stations ? T.atoll.stations() : [];
    const sp = st.find((s) => /spine/.test(s.id)) || { x: 0, z: 0 };
    const bearing = 336.0 * Math.PI / 180;
    /* The bow. FLIGHT_BEARING is the ship's own axis, so the bow is
       200 m up-axis from the station; the camera stands 70 m off
       the bow on the beam and looks back along the hull, which is
       the view the round-11 judge described. Eye at 6 m: high
       enough to see plate, low enough that the waterline is in the
       middle third of the frame rather than at its foot. */
    const bx = sp.x - Math.sin(bearing) * 196;
    const bz = sp.z + Math.cos(bearing) * 196;
    const CUSTOM = {
      bow: [[bx - Math.cos(bearing) * 78, 6.0, bz - Math.sin(bearing) * 78],
        [bx, 6.0, bz], 42],
      band: [[sp.x - Math.cos(bearing) * 96, 4.0, sp.z - Math.sin(bearing) * 96],
        [sp.x, 2.0, sp.z], 30],
    };

    const results = {};
    for (const pose of poses) {
      if (CUSTOM[pose]) {
        const [p, t, fov] = CUSTOM[pose];
        T.lookAt(p, t, fov);
      } else T.setPose(pose);
      for (let i = 0; i < 3; i += 1) T.renderStill();

      const A = await grab();
      const W = A.w; const H = A.h;

      const mats = wreckMaterials();
      const hid = hideWreck(mats);
      T.renderStill();
      const B = await grab();
      hid.forEach((o) => { o.visible = true; });
      T.renderStill();

      const S = await silhouette(mats);

      /* ---- 1. see-through ------------------------------------- */
      const mask = new Uint8Array(W * H);
      let maskN = 0;
      let through = 0;
      for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
        /* Magenta, and it has to be all three tests: a clipped
           highlight is 255,255,255 and passes the red and the blue
           on its own. */
        if (!(S.d[p] > 200 && S.d[p + 2] > 200 && S.d[p + 1] < 60)) continue;
        mask[i] = 1; maskN += 1;
        const dr = Math.abs(A.d[p] - B.d[p]);
        const dg = Math.abs(A.d[p + 1] - B.d[p + 1]);
        const db = Math.abs(A.d[p + 2] - B.d[p + 2]);
        if (Math.max(dr, dg, db) <= tol) through += 1;
      }

      /* ---- the waterline, per column --------------------------- */
      const foot = new Int32Array(W).fill(-1);
      for (let x = 0; x < W; x += 1) {
        for (let y = H - 1; y >= 0; y -= 1) {
          if (mask[y * W + x]) { foot[x] = y; break; }
        }
      }
      /* A column only counts if the pixel just under its foot is
         WATER: sky columns and columns standing on the beach are a
         different seam and would average the answer away. The test
         is the wreck-hidden render, where that pixel is whatever
         the ship was covering. Water on this level is blue-
         dominant, so blue > red by more than 6 is the gate; a lit
         sand flat fails it by 40 levels. */
      const cols = [];
      for (let x = 0; x < W; x += 1) {
        const y = foot[x];
        if (y < 40 || y > H - 100) continue;
        const p = ((y + 6) * W + x) * 4;
        if (B.d[p + 2] - B.d[p] < 6) continue;
        cols.push(x);
      }

      /* ---- 2. draft: the ship's own value, going down ---------- */
      const bandAbove = (lo, hi) => {
        let s = 0; let n = 0;
        for (const x of cols) {
          const f = foot[x];
          for (let dy = lo; dy < hi; dy += 1) {
            const y = f - dy;
            if (y < 0 || !mask[y * W + x]) continue;
            s += lum(A.d, (y * W + x) * 4); n += 1;
          }
        }
        return n ? { v: +(s / n).toFixed(1), n } : { v: null, n: 0 };
      };
      /* ---- 3. contact: the water's value, going down ----------- */
      const bandBelow = (lo, hi) => {
        let s = 0; let n = 0;
        for (const x of cols) {
          const f = foot[x];
          for (let dy = lo; dy < hi; dy += 1) {
            const y = f + dy;
            if (y >= H || mask[y * W + x]) continue;
            s += lum(A.d, (y * W + x) * 4); n += 1;
          }
        }
        return n ? { v: +(s / n).toFixed(1), n } : { v: null, n: 0 };
      };

      /* ---- 4. the skirt: the seam's own top end ---------------- */
      const seam = [];
      for (const x of cols) {
        const f = foot[x];
        for (let dy = -7; dy <= 7; dy += 1) {
          const y = f + dy;
          if (y < 0 || y >= H) continue;
          seam.push(lum(A.d, (y * W + x) * 4));
        }
      }
      seam.sort((a, b) => a - b);
      const frame = [];
      for (let i = 0, p = 0; i < W * H; i += 7, p = i * 4) frame.push(lum(A.d, p));
      frame.sort((a, b) => a - b);
      const q = (arr, f) => (arr.length
        ? +arr[Math.min(arr.length - 1, Math.floor(f * arr.length))].toFixed(1) : null);
      const framep98 = q(frame, 0.98);
      const overP98 = seam.length
        ? +(seam.filter((v) => v > framep98).length / seam.length * 100).toFixed(1) : null;

      const nearW = bandBelow(2, 12);
      const farW = bandBelow(60, 90);
      const b0 = bandAbove(1, 11);
      const b1 = bandAbove(11, 31);
      const b2 = bandAbove(31, 71);

      /* THE OVERLAY, and it is not optional when the number is a
         surprise. See-through pixels painted red over the frame,
         mask pixels that drew something painted green. 19.9 % on
         `spine` is either a real hole or a meter artefact, and
         only the picture says which. */
      let overlay = null;
      if (dump) {
        const o = new Uint8ClampedArray(A.d.length);
        o.set(A.d);
        for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
          if (!mask[i]) continue;
          const dr = Math.abs(A.d[p] - B.d[p]);
          const dg = Math.abs(A.d[p + 1] - B.d[p + 1]);
          const db = Math.abs(A.d[p + 2] - B.d[p + 2]);
          const thru = Math.max(dr, dg, db) <= tol;
          o[p] = thru ? 255 : 0;
          o[p + 1] = thru ? 0 : 220;
          o[p + 2] = 0;
        }
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        c.getContext("2d").putImageData(new ImageData(o, W, H), 0, 0);
        overlay = c.toDataURL("image/png");
      }

      /* THE PLAIN FRAME TOO, and it is not a luxury. The overlay
         paints every mask pixel, so the one thing it cannot show
         is what the seam actually LOOKS like - and the four
         complaints this instrument answers are all about how the
         seam reads, not about how it measures. The bow and band
         cameras exist nowhere else, so without this nobody can
         open the view the round-11 judge described. */
      let beauty = null;
      if (dump) {
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        c.getContext("2d").putImageData(
          new ImageData(new Uint8ClampedArray(A.d), W, H), 0, 0);
        beauty = c.toDataURL("image/png");
      }

      results[pose] = {
        overlay,
        beauty,
        maskPx: maskN,
        maskPctOfFrame: +(maskN / (W * H) * 100).toFixed(2),
        seeThroughPx: through,
        seeThroughPct: maskN ? +(through / maskN * 100).toFixed(3) : null,
        waterlineCols: cols.length,
        /* Ship luminance in three screen bands above the waterline.
           Negative `draftSign` means the hull DARKENS as it enters
           the water, which is what a draft looks like. */
        hull0to10px: b0.v, hull11to30px: b1.v, hull31to70px: b2.v,
        draftSign: (b0.v !== null && b2.v !== null) ? +(b0.v - b2.v).toFixed(1) : null,
        /* Water luminance near the hull against far from it.
           Negative `contact` means the water darkens at the ship. */
        waterNear: nearW.v, waterFar: farW.v,
        contact: (nearW.v !== null && farW.v !== null)
          ? +(nearW.v - farW.v).toFixed(1) : null,
        seamP50: q(seam, 0.50), seamP98: q(seam, 0.98),
        frameP98: framep98,
        seamOverFrameP98Pct: overP98,
      };
    }
    return { results, poses };
  }, { poses: POSES, tol: TOL, dump: !!args.dump });

  if (args.dump) {
    const dir = path.resolve(root, String(args.dump));
    await mkdir(dir, { recursive: true });
    for (const pose of POSES) {
      const r = out.results[pose];
      if (!r) continue;
      if (r.beauty) {
        await writeFile(path.join(dir, `${pose}.png`),
          Buffer.from(r.beauty.split(",")[1], "base64"));
        delete r.beauty;
      }
      if (!r.overlay) continue;
      await writeFile(path.join(dir, `${pose}-thru.png`),
        Buffer.from(r.overlay.split(",")[1], "base64"));
      delete r.overlay;
    }
  }

  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, n = 7) => String(v === null || v === undefined ? "-" : v).padStart(n);
  console.log(`time ${TIME}  quality ${QUALITY}  tol ${TOL}/255`);
  console.log(pad("pose", 8) + num("mask%") + num("thru%") + num("cols")
    + num("h0-10") + num("h31-70") + num("draft") + num("wNear")
    + num("wFar") + num("contact") + num("seamP98") + num(">fp98%"));
  for (const pose of POSES) {
    const r = out.results[pose];
    if (!r) { console.log(pad(pose, 8) + "  (no data)"); continue; }
    console.log(pad(pose, 8) + num(r.maskPctOfFrame) + num(r.seeThroughPct)
      + num(r.waterlineCols) + num(r.hull0to10px) + num(r.hull31to70px)
      + num(r.draftSign) + num(r.waterNear) + num(r.waterFar)
      + num(r.contact) + num(r.seamP98) + num(r.seamOverFrameP98Pct));
  }
  if (args.json) {
    await writeFile(path.resolve(root, String(args.json)),
      JSON.stringify(out, null, 2));
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}
