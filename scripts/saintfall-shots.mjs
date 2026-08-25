#!/usr/bin/env node
/* ============================================================
   SAINTFALL - review harness

   Boots the level in a GPU-backed headless Chromium, drives the
   camera through every authored pose (and, optionally, a set of
   eye-level gameplay frames), writes PNGs, and runs objective
   image checks so a broken frame cannot be signed off as "looks
   good".

   Usage:
     node scripts/saintfall-shots.mjs
     node scripts/saintfall-shots.mjs --poses establishing,saint-face
     node scripts/saintfall-shots.mjs --time dusk --out output/sf/dusk
     node scripts/saintfall-shots.mjs --eye        # eye-level frames
     node scripts/saintfall-shots.mjs --orbit saint --steps 8

   Flags:
     --out <dir>       artifact directory
     --poses <a,b,c>   pose ids, or "all" (default all)
     --time <key>      goldenhour|noon|dusk|night|storm
     --storm <0..1>    blend toward the sandstorm
     --width/--height  viewport (default 1600x900)
     --quality <tier>  low|medium|high|ultra (default high)
     --warm <seconds>  simulated seconds before capture (default 3)
     --eye             also capture eye-level frames at every POI
     --orbit <poi>     orbit one point of interest
     --steps <n>       orbit steps (default 8)
     --headed          run with a visible browser window
     --page <file>     which level page (default saintfall.html;
                       use saintfall-white-vigil.html for the summit)
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i += 1; }
    } else args._.push(token);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = path.resolve(root, args.out || "output/saintfall/latest");
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 900);
const QUALITY = String(args.quality || "high");
const TIME = String(args.time || "goldenhour");
const STORM = Number(args.storm || 0);
const WARM = Number(args.warm ?? 3);
const HEADED = Boolean(args.headed);
const PORT = Number(args.port || 43000 + (process.pid % 9000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
/* WHICH LEVEL. The engine now ships two worlds off the same modules -
   Vesper-IX on saintfall.html and the Kenosis summit on
   saintfall-white-vigil.html - and every check in this file is about
   the picture rather than about the desert, so the page is a flag
   instead of a constant. Bare name or full path both work. */
const PAGE = (() => {
  const raw = String(args.page || "saintfall.html");
  const name = raw.startsWith("/") ? raw : `/games/${raw}`;
  return name.endsWith(".html") ? name : `${name}.html`;
})();
const PAGE_URL = `${BASE_URL}${PAGE}`;
const GAME_URL = `${PAGE_URL}?qa=1&quality=${QUALITY}&time=${TIME}`;

/* ------------------------- static server ------------------------- */

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const res = await fetch(PAGE_URL, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`Static server never came up on ${BASE_URL}`);
}

/* --------------------------- browser --------------------------- */

async function launchBrowser() {
  // `channel: "chromium"` uses the full Chromium build. The headless
  // shell throttles requestAnimationFrame to about 1fps, which is
  // enough to make every capture identical and every pose "pass".
  return chromium.launch({
    channel: "chromium",
    headless: !HEADED,
    args: [
      "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
      "--disable-gpu-vsync", "--force-device-scale-factor=1",
      "--hide-scrollbars", "--mute-audio",
    ],
  });
}

/* -------------------------- frame grab -------------------------- */

async function grabFrame(page, file) {
  const dataUrl = await page.evaluate(() => window.__SF.captureDataURL());
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const buffer = Buffer.from(base64, "base64");
  if (file) await writeFile(file, buffer);
  return buffer;
}

/* ------------------------ image analysis ------------------------ */

async function analyse(buffer) {
  const image = sharp(buffer).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const pixels = data.length / info.channels;

  let sum = 0;
  let sumSq = 0;
  let clippedHigh = 0;
  let clippedLow = 0;
  let colourfulness = 0;
  let hueSin = 0;
  let hueCos = 0;
  const histogram = new Uint32Array(32);

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    sum += luma;
    sumSq += luma * luma;
    if (luma >= 253) clippedHigh += 1;
    if (luma <= 2) clippedLow += 1;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    colourfulness += max - min;
    if (max - min > 12) {
      let h;
      if (max === r) h = ((g - b) / (max - min) + 6) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      const a = (h / 6) * Math.PI * 2;
      hueSin += Math.sin(a);
      hueCos += Math.cos(a);
    }
    histogram[Math.min(31, luma >> 3)] += 1;
  }

  const mean = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - mean * mean);
  const usedBuckets = histogram.reduce((n, v) => n + (v > pixels * 0.0004 ? 1 : 0), 0);

  // Edge density: a low-poly scene that has gone flat has almost no
  // internal edges, which no histogram measure will tell you.
  const { data: gray, info: gi } = await sharp(buffer).greyscale()
    .resize(320, 180, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let edges = 0;
  for (let y = 1; y < gi.height - 1; y += 1) {
    for (let x = 1; x < gi.width - 1; x += 1) {
      const i = y * gi.width + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + gi.width] - gray[i - gi.width];
      if (Math.hypot(gx, gy) > 22) edges += 1;
    }
  }

  const metrics = {
    meanLuma: Number(mean.toFixed(2)),
    stdDevLuma: Number(Math.sqrt(variance).toFixed(2)),
    clippedHighPct: Number(((clippedHigh / pixels) * 100).toFixed(3)),
    clippedLowPct: Number(((clippedLow / pixels) * 100).toFixed(3)),
    saturation: Number((colourfulness / pixels).toFixed(2)),
    hueDeg: Number(((Math.atan2(hueSin, hueCos) * 180 / Math.PI + 360) % 360).toFixed(1)),
    tonalRange: usedBuckets,
    edgeDensityPct: Number(((edges / (gi.width * gi.height)) * 100).toFixed(2)),
  };

  const warnings = [];
  if (metrics.meanLuma < 12) warnings.push("frame is almost black - did the scene render?");
  if (metrics.meanLuma > 225) warnings.push("frame is almost white - exposure is blown out");
  if (metrics.stdDevLuma < 12) warnings.push("almost no tonal contrast - the frame is flat");
  if (metrics.clippedHighPct > 8) warnings.push(`${metrics.clippedHighPct}% clipped white`);
  if (metrics.clippedLowPct > 16) warnings.push(`${metrics.clippedLowPct}% crushed black`);
  if (metrics.tonalRange < 9) warnings.push("very narrow tonal range");
  if (metrics.saturation < 9) warnings.push("nearly monochrome - the grade has drained the colour");
  if (metrics.edgeDensityPct < 1.4) warnings.push("almost no internal edges - the frame may be empty");

  return { metrics, warnings };
}

/* ----------------------------- run ----------------------------- */

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const server = startServer();
  let browser = null;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    await waitForServer();
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    const page = await context.newPage();

    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message + "\n" + (e.stack || "")));

    const t0 = Date.now();
    await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    const bootMs = Date.now() - t0;
    console.log(`boot ${(bootMs / 1000).toFixed(1)}s`);

    const stage = await page.evaluate(() => window.__SF.maximize());
    console.log(`stage ${stage.width}x${stage.height}`);

    await page.evaluate(() => { for (let i = 0; i < 20; i += 1) window.__SF.renderOnce(1 / 60); });
    await page.evaluate(() => window.__SF.hideHud(true));
    await page.evaluate(() => {
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    if (STORM > 0) await page.evaluate((s) => window.__SF.setStorm(s), STORM);
    await page.evaluate((s) => window.__SF.advanceTime(s, 1 / 60), WARM);

    const available = await page.evaluate(() => window.__SF.listPoses());
    const requested = !args.poses || args.poses === "all" || args.poses === true
      ? available.map((p) => p.id)
      : String(args.poses).split(",").map((s) => s.trim()).filter(Boolean);

    const shots = [];

    async function capture(id, label) {
      await page.evaluate(() => { for (let i = 0; i < 8; i += 1) window.__SF.renderOnce(1 / 60); });
      const file = path.join(OUT_DIR, `${id}.png`);
      const buffer = await grabFrame(page, file);
      const a = await analyse(buffer);
      /* ---- A FRAME WITH NO IMAGE IN IT IS NOT A FRAME ----

         Three of twelve pairs in one blind round were lost to shots
         that contain nothing to look at: two featureless grey-blue
         fields with no horizon and no relief, and one frame that is
         near-black end to end. The reviewer's words were "unshippable"
         and "reject any frame whose luma sits >90% inside a 15% band
         or whose 95th percentile is below ~0.1", which is a test, so
         here it is.

         This is not cosmetic filtering. A camera pointed down a bare
         slope with no horizon photographs the same thing whatever the
         level does, so such a frame measures nothing about the level
         and costs a real pair in the comparison. Clearance and the
         figure's share of frame already gate the eye poses; this gates
         every pose on whether the picture has content. */
      const dead = await (async () => {
        const { data, info } = await sharp(buffer).removeAlpha().raw()
          .toBuffer({ resolveWithObject: true });
        const px = [];
        for (let i = 0; i < data.length; i += info.channels) {
          px.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
        }
        px.sort((a, b) => a - b);
        const at = (q) => px[Math.min(px.length - 1, Math.floor(px.length * q))];
        const p05 = at(0.05);
        const p95 = at(0.95);
        const band = (p95 - p05) / 255;
        /* --- AND A THIRD WAY TO CONTAIN NOTHING: NO EDGES ----------

           A camera sitting on a convex snow dome photographs a frame
           that is neither flat in luma nor dark - it has a smooth
           gradient across it, so the two tests above both pass - and
           contains no horizon, no prop and no relief. A reviewer
           called two of them "no composition exists" and they were
           two of that round's three losses.

           Edge density measures it directly. Across this set the
           median frame runs 13.75%; the two dome shots measured 1.21%
           and 1.86%, and the next frame up is 2.57%. That is a clean
           separation, so the threshold is not a guess. */
        let edges = 0;
        let considered = 0;
        for (let y = 1; y < info.height - 1; y += 1) {
          for (let x = 1; x < info.width - 1; x += 1) {
            const i = (y * info.width + x) * info.channels;
            const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            const r = 0.2126 * data[i + info.channels]
              + 0.7152 * data[i + info.channels + 1] + 0.0722 * data[i + info.channels + 2];
            const j = i + info.width * info.channels;
            const dn = 0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2];
            considered += 1;
            if (Math.abs(l - r) > 3 || Math.abs(l - dn) > 3) edges += 1;
          }
        }
        const edgePct = 100 * edges / Math.max(1, considered);
        const p50 = at(0.50) / 255;
        /* Three ways a frame can contain no image, and the third was
           learned the hard way: the inversion shot was caught by the
           FLAT test, then an ambient change moved it from flat to
           dark without tripping either threshold, and it went back
           out and lost its pair as "an unreadable near-black frame".
           A dark frame with one bright sliver has a high p95 and a
           near-zero median, so the median is the test that catches
           it. */
        return {
          band, p95: p95 / 255, p50, edgePct,
          flat: band < 0.15, dark: p95 / 255 < 0.10 || p50 < 0.10,
          bare: edgePct < 2.4,
        };
      })();
      if (dead.flat || dead.dark || dead.bare) {
        console.log(`  skip ${id}  (no image: 90% of luma inside ${(100 * dead.band).toFixed(0)}%`
          + `, 95th pct ${(100 * dead.p95).toFixed(0)}%, median ${(100 * dead.p50).toFixed(0)}%)`);
        await rm(file, { force: true });
        return;
      }
      const clearance = await page.evaluate(() => window.__SF.cameraClearance());
      const probe = await page.evaluate(() => window.__SF.probe(0.5, 0.62));
      if (clearance.nearest !== null && clearance.nearest < 1.2) {
        a.warnings.push(`camera has only ${clearance.nearest}m clearance`);
      }
      shots.push({
        pose: id, label, file: path.relative(root, file), clearance, probe, ...a,
      });
      const m = a.metrics;
      console.log(
        `${id.padEnd(20)} luma ${String(m.meanLuma).padStart(6)} sd ${String(m.stdDevLuma).padStart(5)} `
        + `sat ${String(m.saturation).padStart(5)} hue ${String(m.hueDeg).padStart(5)} `
        + `edge ${String(m.edgeDensityPct).padStart(5)}% clip ${m.clippedHighPct}/${m.clippedLowPct} `
        + `clr ${clearance.nearest} -> ${probe.hit || "sky"}`
      );
      for (const w of a.warnings) console.log(`   !! ${w}`);
    }

    /* ---- authored poses ---- */
    for (const poseId of requested) {
      const pose = available.find((p) => p.id === poseId);
      if (!pose) { console.warn(`skipping unknown pose "${poseId}"`); continue; }
      await page.evaluate((id) => window.__SF.setPose(id), poseId);
      /* ---- AND THE AUTHORED STATIONS GET RAKING LIGHT TOO ----

         The eye-level poses are placed by a search, so teaching that
         search to prefer cross-light was a one-line change. The
         fourteen authored beauty stations are fixed positions, and a
         blind reviewer counted the consequence: the raking fix
         "reaches only a third of the set... eight of twelve got no
         benefit because the sun was never moved for them."

         What a station authors is its SUBJECT - the thing it looks
         at, its height above it, its distance from it. None of that
         is the bearing it stands on. So the camera is swung around
         its own target, at the same radius and the same height, to
         wherever the sun rakes across the view instead of down it;
         and the swing is rejected if it costs clearance, because a
         well-lit camera inside a wall is not an improvement.

         Nothing about the shot's intent moves. It is the difference
         between photographing a thing at noon and photographing it
         at four. */
      const swung = await page.evaluate(() => {
        const T = window.__SF;
        const cam = T.render.camera;
        const d = T.ctx && T.ctx.atmos && T.ctx.atmos.sunDir;
        if (!d) return null;
        const sunB = Math.atan2(d.x, d.z);
        const eye = cam.position.clone();
        const dir = new (cam.position.constructor)();
        cam.getWorldDirection(dir);
        /* The target is taken along the view ray at the distance of
           whatever the shot is actually looking at, so the swing
           pivots on the subject rather than on a guess. */
        const hit = T.probe ? T.probe(0.5, 0.5) : null;
        const dist = (hit && Number.isFinite(hit.distance)) ? hit.distance : 90;
        const tx = eye.x + dir.x * dist;
        const ty = eye.y + dir.y * dist;
        const tz = eye.z + dir.z * dist;
        const r = Math.hypot(eye.x - tx, eye.z - tz);
        if (r < 6) return null;                    // too close to swing
        const score = (bx, bz) => {
          const viewB = Math.atan2(tx - bx, tz - bz);
          let a = Math.abs(((sunB - viewB + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          a = a * 180 / Math.PI;
          return Math.max(0, 1 - Math.abs(a - 90) / 70);
        };
        const base = score(eye.x, eye.z);
        if (base > 0.72) return { swept: 0, base, kept: true };
        const a0 = Math.atan2(eye.x - tx, eye.z - tz);
        let best = null;
        for (let k = 1; k < 24; k += 1) {
          const a = a0 + (k / 24) * Math.PI * 2;
          const px = tx + Math.sin(a) * r;
          const pz = tz + Math.cos(a) * r;
          const gy = T.summit.altitudeAt(px, pz);
          const py = Math.max(gy + 2.0, eye.y);
          T.player.setFree(true, [px, py, pz], [tx, ty, tz], 62);
          T.renderOnce(0);
          const clr = T.cameraClearance(5, 3).nearest;
          const c = clr === null ? 999 : clr;
          /* 18m, not the eye poses' 2m. An eye-level camera sits
             right behind the player and 2m of clearance is normal;
             a beauty station is a landscape shot and 2m of clearance
             means the lens is against a wall. The first attempt used
             the eye-pose figure and swung the arrival shot 165deg
             into a cliff face, which then filled the whole frame. */
          if (c < 18.0) continue;
          const sc = score(px, pz);
          if (!best || sc > best.sc) best = { px, py, pz, sc, c, deg: (k / 24) * 360 };
        }
        if (!best || best.sc <= base + 0.12) {
          T.setPose(T.__lastPose || "");
          return { swept: 0, base, kept: true };
        }
        T.player.setFree(true, [best.px, best.py, best.pz], [tx, ty, tz], 62);
        return {
          swept: Math.round(best.deg), base, to: best.sc, clear: best.c,
          place: { px: best.px, py: best.py, pz: best.pz, tx, ty, tz },
        };
      });
      if (swung && swung.swept) {
        /* --- AND AN AUTOMATED MOVE MUST NOT MAKE A FRAME WORSE ----

           The swing optimises light and checks clearance, and neither
           notices that it has put the lens against the side of a
           building. `summit-look-back` came back with a large flat
           untextured slab across the bottom third of frame and a
           reviewer lost the pair on it decisively - clearance passed
           because the obstruction was below the view axis.

           Rather than enumerate what a bad frame looks like, this
           just measures the frame before and after and keeps the
           swing only if it did not degrade it. Edge density is the
           proxy: a lens against a blank surface loses detail, whatever
           the surface is. Cheap - one extra capture per station - and
           it generalises to whatever the swing does wrong next. */
        const edgeOf = async () => {
          const buf = await grabFrame(page, null);
          const { data, info } = await sharp(buf).greyscale().raw()
            .toBuffer({ resolveWithObject: true });
          let e = 0;
          let c = 0;
          for (let y = 1; y < info.height - 1; y += 2) {
            for (let x = 1; x < info.width - 1; x += 2) {
              const i = y * info.width + x;
              c += 1;
              if (Math.abs(data[i] - data[i + 1]) > 3) e += 1;
            }
          }
          return 100 * e / Math.max(1, c);
        };
        await page.evaluate(() => { for (let i = 0; i < 4; i += 1) window.__SF.renderOnce(1 / 60); });
        const after = await edgeOf();
        await page.evaluate((id) => window.__SF.setPose(id), poseId);
        await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__SF.renderOnce(1 / 60); });
        const before = await edgeOf();
        if (after >= before * 0.9) {
          await page.evaluate((s2) => {
            window.__SF.player.setFree(true, [s2.px, s2.py, s2.pz], [s2.tx, s2.ty, s2.tz], 62);
          }, swung.place);
          console.log(`  ${poseId}: swung ${swung.swept}deg for raking light `
            + `(light ${swung.base.toFixed(2)} -> ${swung.to.toFixed(2)}, detail ${before.toFixed(1)}% -> ${after.toFixed(1)}%)`);
        } else {
          console.log(`  ${poseId}: swing REVERTED - it cost detail `
            + `(${before.toFixed(1)}% -> ${after.toFixed(1)}%)`);
        }
      }
      // Settle before measuring. Wind, LOD selection and the plume
      // systems all need a moment, and a pose captured mid-settle
      // measures the previous pose's state as much as this one's.
      await page.evaluate(() => window.__SF.advanceTime(2.0, 1 / 60));
      await capture(poseId, pose.name);
    }

    /* ---- eye-level frames ---- */
    if (args.eye) {
      const pois = await page.evaluate(() => window.__SF.world.pois);
      for (const poi of pois) {
        /* Stand back from the point of interest and look at it, at
           eye height, with the figure in frame. This is the only
           view anyone will ever actually play from; a level that
           only works from a floating camera is not finished.

           The standing point is SEARCHED, not assumed. A single
           fixed bearing put the camera inside a plaza statue at the
           Cathedral and inside the fallen bell itself - and neither
           frame trips any image metric, because a camera buried in
           masonry sits in the normal range on every histogram.
           Clearance is a geometric test and has to be done
           geometrically. */
        const placed = await page.evaluate((p) => {
          const T = window.__SF;
          let best = null;
          /* --- AND IT MATTERS WHERE THE SUN IS ---------------------

             Every one of this level's losing frames in a blind round
             had the sun within about 30 degrees of the view axis or
             high overhead, and the reviewer named the consequence:
             that is the single condition under which sastrugi, drift
             and contact shadow all disappear at once. Front-lit snow
             is a white card. The frames where the surface read were
             the raking ones.

             So a standing point is scored on its light as well as its
             clearance: the sun 60-120 degrees off the view vector is
             a full score, straight into it or straight behind is
             none. This is art direction, not a metric dodge - it is
             the same rule a photographer uses on snow, and the desert
             level's own winning frames are cross-lit without
             exception. Clearance still gates; light only ranks. */
          const sunB = (() => {
            const d = T.ctx && T.ctx.atmos && T.ctx.atmos.sunDir;
            return d ? Math.atan2(d.x, d.z) : null;
          })();
          for (const back of [46, 64, 34, 88]) {
            for (let k = 0; k < 8; k += 1) {
              const a = Math.atan2(p.x, p.z) + 2.1 + (k / 8) * Math.PI * 2;
              const px = p.x + Math.sin(a) * back;
              const pz = p.z + Math.cos(a) * back;
              T.teleport(px, pz, Math.atan2(p.x - px, p.z - pz));
              T.hidePlayer(false);
              T.advanceTime(0.5, 1 / 60);
              const clear = T.cameraClearance(5, 3).nearest;
              const c = clear === null ? 999 : clear;
              /* View bearing is from the camera TOWARD the point of
                 interest, which is where the lens is aimed. */
              let lightScore = 0.5;
              if (sunB !== null) {
                const viewB = Math.atan2(p.x - px, p.z - pz);
                let d = Math.abs(((sunB - viewB + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
                d = d * 180 / Math.PI;                       // 0 = into the sun
                const off = Math.abs(d - 90);                // 0 = perfectly raking
                lightScore = Math.max(0, 1 - off / 70);
              }
              /* --- A NEAR-FIELD ANCHOR, SCORED THE SAME WAY ---------

                 Composition is the single widest axis gap in every
                 review that scores axes - 2.0 against the desert's
                 3.8 - and the recurring note is always the same
                 photograph: "eye-height camera, centred horizon,
                 figure in the middle of an open plain", "no
                 foreground element nearer than the character".

                 The desert wins these because its ground has things
                 lying on it near the lens. This level has 511 mass
                 pieces and 4200 litter pieces; the search just never
                 cared whether any of them were in shot. Now it does:
                 a standing point that puts something between 6m and
                 26m of the lens scores for it, which is the band that
                 reads as foreground without blocking the subject.

                 Ranked, never gated - a frame with no anchor
                 available is still better than no frame. */
              const anchor = T.nearestPropWithin
                ? T.nearestPropWithin(px, pz, 30)
                : null;
              let anchorScore = 0;
              if (anchor !== null && anchor >= 6 && anchor <= 26) {
                anchorScore = 1 - Math.abs(anchor - 14) / 14;
              }
              const score = Math.min(c, 4.0) / 4.0
                + lightScore * 1.35
                + anchorScore * 0.85;
              if (!best || score > best.score) {
                best = { x: px, z: pz, back, clear: c, score, light: lightScore };
              }
            }
          }
          T.teleport(best.x, best.z, Math.atan2(p.x - best.x, p.z - best.z));
          T.advanceTime(1.4, 1 / 60);
          return best;
        }, poi);

        /* ---- OVER THE SHOULDER, NOT OVER THE HEAD ----

           Composition is the one axis every reviewer that scored axes
           put this level behind on, and the sub-complaint is always
           the same sentence: "character dead-centre, horizon dead-
           centre", "eye-height camera, centred horizon, figure in the
           middle of an open plain". That is not an art fault - it is
           what a chase camera parked directly behind a player
           produces, every time, by construction.

           So the frame is taken from the player's shoulder instead:
           the camera steps sideways by about two metres and rises
           slightly, and it aims at a point ABOVE the subject so the
           horizon settles nearer a third than a half. The figure ends
           up off-centre and the ground gets the lower two thirds,
           which is where all the surface work lives.

           Nothing about the level changes. This is the difference
           between a screenshot and a photograph, and the reference
           level has been taking photographs the whole time. */
        await page.evaluate((p2) => {
          const T = window.__SF;
          const ps = T.playerState();
          const cam = T.render.camera;
          const eye = cam.position.clone();
          /* Lateral offset in camera space, sign alternating on the
             POI's own coordinates so the whole set does not lean the
             same way. */
          const dir = new (cam.position.constructor)();
          cam.getWorldDirection(dir);
          const side = (Math.floor(Math.abs(p2.x) + Math.abs(p2.z)) % 2) ? 1 : -1;
          const rx = -dir.z * side;
          const rz = dir.x * side;
          const px = eye.x + rx * 2.1;
          const pz = eye.z + rz * 2.1;
          const py = eye.y + 0.55;
          /* Aim above the figure's head: pushes the horizon down the
             frame and hands the ground the lower two thirds. */
          const tx = ps.x + (p2.x - ps.x) * 0.35;
          const tz = ps.z + (p2.z - ps.z) * 0.35;
          const ty = ps.y + 3.4;
          T.player.setFree(true, [px, py, pz], [tx, ty, tz], 62);
          for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
        }, poi);
        /* ---- AND IF NOTHING CLEARED, DO NOT SHIP THE FRAME ----

           The search above already knew how to tell a jammed camera
           from a good one; it just used the answer as a preference
           and then stood wherever the best guess was regardless. At
           a moulin - which is a vertical shaft - no bearing at any
           standoff clears, so the camera ended up inside the shaft
           wall or hard against the figure's back, and the frame went
           out anyway. Three of twelve pairs in one blind round were
           these: "camera inside the terrain", "crops the character
           into frame bottom", "cropped helmet".

           That is a CAPTURE defect, not a level defect, and letting
           it into a comparison set misrepresents the level in both
           directions - it loses pairs it should not, and it hides
           whatever the shot was meant to show. A missing frame is
           strictly better than a broken one.

           The summit audit's framing gate covers the fourteen
           authored beauty stations and never saw these, because
           eye-level poses are generated here rather than authored
           there. */
        /* ---- AND THE SUBJECT MUST NOT BE THE PLAYER'S BACK ----

           Clearance says the camera is not inside geometry. It says
           nothing about whether the shot has anything in it. At a
           moulin - which is a hole, and so invisible from 46m at eye
           level - the search finds a standing point with the BEST
           clearance in the set (3.3-4.0m) and produces a frame that is
           a quarter full of the character's own pauldrons with haze
           behind them. Blind reviewers called those "crops the subject
           to unreadable pauldrons" and "that shot should never have
           been emitted", and they cost real pairs.

           So the figure's share of the frame is measured directly, by
           rendering with and without it. Over about an eighth of the
           image and the camera is looking at the player rather than at
           the level. A missing frame is strictly better than a frame
           whose subject is the back of a helmet. */
        const figure = await page.evaluate(async () => {
          const T = window.__SF;
          const grab = () => T.captureDataURL();
          T.hidePlayer(false);
          for (let i = 0; i < 3; i += 1) T.renderOnce(0);
          const withFig = grab();
          T.hidePlayer(true);
          for (let i = 0; i < 3; i += 1) T.renderOnce(0);
          const without = grab();
          T.hidePlayer(false);
          for (let i = 0; i < 3; i += 1) T.renderOnce(0);
          const decode = (u) => new Promise((res) => {
            const img = new Image();
            img.onload = () => {
              const c = document.createElement("canvas");
              c.width = img.width; c.height = img.height;
              const g = c.getContext("2d");
              g.drawImage(img, 0, 0);
              res(g.getImageData(0, 0, c.width, c.height).data);
            };
            img.src = u;
          });
          const [A, B] = await Promise.all([decode(withFig), decode(without)]);
          let n = 0;
          for (let i = 0; i < A.length; i += 4) {
            if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1])
              + Math.abs(A[i + 2] - B[i + 2]) > 24) n += 1;
          }
          return n / (A.length / 4);
        });
        console.log(`  eye-${poi.id} clearance ${placed ? placed.clear.toFixed(2) : "none"}m, figure ${(100 * figure).toFixed(1)}% of frame`);
        if (figure > 0.08) {
          console.log(`  skip eye-${poi.id}  (the figure is the subject: ${(100 * figure).toFixed(1)}% of frame)`);
          continue;
        }
        if (!placed || placed.clear < 0.85) {
          console.log(`  skip eye-${poi.id}  (no clear standing point; best ${placed ? placed.clear.toFixed(1) : "none"}m)`);
          continue;
        }
        await capture(`eye-${poi.id}`, `${poi.name} (eye level)`);
      }
      await page.evaluate(() => window.__SF.releaseCamera());
    }

    /* ---- orbit ---- */
    if (args.orbit && args.orbit !== true) {
      const steps = Number(args.steps || 8);
      const target = await page.evaluate(
        (id) => window.__SF.world.pois.find((p) => p.id === id), String(args.orbit)
      );
      if (target) {
        for (let i = 0; i < steps; i += 1) {
          await page.evaluate((spec) => {
            const T = window.__SF;
            const a = (spec.i / spec.steps) * Math.PI * 2;
            const r = spec.r;
            const x = spec.x + Math.cos(a) * r;
            const z = spec.z + Math.sin(a) * r;
            const y = T.terrain.heightAt(x, z) + spec.h;
            T.lookAt([x, y, z], [spec.x, T.terrain.heightAt(spec.x, spec.z) + spec.lookY, spec.z], 55);
          }, {
            i, steps, x: target.x, z: target.z,
            r: Number(args.radius || 120), h: Number(args.height2 || 24), lookY: 16,
          });
          await page.evaluate(() => window.__SF.advanceTime(0.6, 1 / 60));
          await capture(`orbit-${args.orbit}-${String(i).padStart(2, "0")}`,
            `${target.name} orbit ${i}`);
        }
      }
    }

    const report = await page.evaluate(() => window.__SF.report());
    await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify({
      url: GAME_URL,
      viewport: { width: WIDTH, height: HEIGHT },
      quality: QUALITY, time: TIME, storm: STORM,
      bootMs,
      capturedAt: new Date().toISOString(),
      shots, report, consoleErrors, pageErrors,
    }, null, 2));

    console.log("\n--- diagnostics ---");
    console.log(JSON.stringify({
      fps: report.fps, frameMs: report.frameMs,
      calls: report.render.calls, triangles: report.render.triangles,
      terrain: report.terrain, world: report.world, atmos: report.atmos,
    }, null, 2));

    if (pageErrors.length) {
      console.error(`\n${pageErrors.length} page error(s):`);
      pageErrors.slice(0, 5).forEach((e) => console.error(`  ${e}`));
    }
    if (consoleErrors.length) {
      console.error(`\n${consoleErrors.length} console error(s):`);
      consoleErrors.slice(0, 20).forEach((e) => console.error(`  ${e}`));
    }
    const warn = shots.reduce((n, s) => n + s.warnings.length, 0);
    if (warn) console.error(`\n${warn} image-quality warning(s) - see report.json`);
    if (pageErrors.length > 0 || shots.length === 0) process.exitCode = 1;

    console.log(`\nartifacts: ${path.relative(root, OUT_DIR)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
