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
              if (!best || c > best.clear) best = { x: px, z: pz, back, clear: c };
              if (c >= 3.0) { best = { x: px, z: pz, back, clear: c }; break; }
            }
            if (best && best.clear >= 3.0) break;
          }
          T.teleport(best.x, best.z, Math.atan2(p.x - best.x, p.z - best.z));
          T.advanceTime(1.4, 1 / 60);
          return best;
        }, poi);
        void placed;
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
