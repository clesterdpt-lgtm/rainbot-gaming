#!/usr/bin/env node
/* ============================================================
   SCRAP CIRCUIT — screenshot harness

   Boots the game in a GPU-backed headless Chromium, starts a match
   in each arena, drives the QA free camera through a fixed set of
   poses (overview, street level, hero landmark, gameplay chase) and
   writes PNGs plus a metrics JSON.

   Usage:
     node scripts/scrap-shots.mjs
     node scripts/scrap-shots.mjs --out output/scrap-shots/run-2 \
       --arenas suburb,junkyard --width 1440 --height 810

   Flags:
     --out <dir>        artifact directory
     --arenas <a,b,c>   arena ids, or "all" (default all)
     --vehicle <id>     player vehicle (default towtruck)
     --poses <a,b>      pose ids to shoot, or "all"
     --width/--height   viewport (default 1440x810 = 3x the 480x270 target)
     --warm <seconds>   simulated seconds before capture (default 2)
     --hud              keep the HUD visible (default hidden)
     --headed           run with a visible browser window
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
const OUT_DIR = path.resolve(root, args.out || "output/scrap-shots/latest");
const WIDTH = Number(args.width || 1440);
const HEIGHT = Number(args.height || 810);
const WARM = Number(args.warm ?? 2);
const KEEP_HUD = Boolean(args.hud);
const HEADED = Boolean(args.headed);
const VEHICLE = String(args.vehicle || "towtruck");
const PORT = Number(args.port || 43000 + (process.pid % 9000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE_URL}/games/scrap-circuit.html?qa=1&debug=1`;

const ALL_ARENAS = ["suburb", "junkyard", "interchange", "boardwalk", "rooftop", "cemetery"];
const ARENAS = args.arenas && args.arenas !== "all"
  ? String(args.arenas).split(",").map((s) => s.trim()).filter(Boolean)
  : ALL_ARENAS;

/* --------------------------------------------------------------
   Camera poses.

   Expressed as functions of the arena bounds so a resized arena
   keeps working. `eye`/`look` are world-space [x, y, z].
   -------------------------------------------------------------- */
const POSES = {
  // High three-quarter establishing shot: reads overall layout + scale.
  overview: (b) => ({
    eye: [b.hw * 0.95, b.hw * 0.72, b.hd * 1.05],
    look: [0, 4, 0],
    fov: 62,
  }),
  // Driver's-eye down the main axis: the framing players actually live in.
  street: (b) => ({
    eye: [0, 3.2, b.hd * 0.72],
    look: [0, 3.0, -b.hd * 0.2],
    fov: 62,
  }),
  // Low hero angle from a corner: shows silhouette and vertical mass.
  low: (b) => ({
    eye: [-b.hw * 0.55, 2.0, -b.hd * 0.55],
    look: [b.hw * 0.2, 8, b.hd * 0.3],
    fov: 62,
  }),
  // Mid-height sweep across the middle: the "action" altitude.
  mid: (b) => ({
    eye: [b.hw * 0.42, 14, -b.hd * 0.62],
    look: [-b.hw * 0.15, 2, b.hd * 0.1],
    fov: 62,
  }),
  // Behind the player car — the real gameplay camera.
  chase: null,
};
const POSE_IDS = args.poses && args.poses !== "all"
  ? String(args.poses).split(",").map((s) => s.trim()).filter(Boolean)
  : Object.keys(POSES);

/* ------------------------- static server ------------------------- */

function startServer() {
  const child = spawn("python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/games/scrap-circuit.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`Static server never came up on ${BASE_URL}`);
}

/* --------------------------- browser --------------------------- */

async function launchBrowser() {
  // `channel: "chromium"` uses the full build, not the headless shell —
  // the shell throttles rAF to ~1fps and hands back black frames.
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

/* ------------------------ image analysis ------------------------ */

/**
 * Objective frame checks so a broken capture cannot be signed off by
 * eye. Catches black frames, blown frames, flat frames, drained frames.
 */
async function analyse(file) {
  const image = sharp(file).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const pixels = data.length / info.channels;

  let sum = 0, sumSq = 0, clipHigh = 0, clipLow = 0, colourful = 0;
  const histogram = new Uint32Array(32);
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    sum += luma; sumSq += luma * luma;
    if (luma >= 253) clipHigh += 1;
    if (luma <= 2) clipLow += 1;
    colourful += Math.max(r, g, b) - Math.min(r, g, b);
    histogram[Math.min(31, luma >> 3)] += 1;
  }
  const mean = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - mean * mean);
  const usedBuckets = histogram.reduce((n, v) => n + (v > pixels * 0.0004 ? 1 : 0), 0);

  // Detail density: mean absolute luma gradient. A flat-shaded box world
  // scores low; a texture-mapped world with clutter scores high. This is
  // the single most diagnostic number for "does it look like 1996 or like
  // untextured primitives".
  const w = info.width, h = info.height, ch = info.channels;
  let grad = 0, gradN = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * ch;
      const l = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      const ir = i + ch;
      const lr = data[ir] * 0.2126 + data[ir + 1] * 0.7152 + data[ir + 2] * 0.0722;
      const id = i + w * ch;
      const ld = data[id] * 0.2126 + data[id + 1] * 0.7152 + data[id + 2] * 0.0722;
      grad += Math.abs(l - lr) + Math.abs(l - ld);
      gradN += 2;
    }
  }

  const metrics = {
    meanLuma: +mean.toFixed(2),
    stdDevLuma: +Math.sqrt(variance).toFixed(2),
    clippedHighPct: +((clipHigh / pixels) * 100).toFixed(3),
    clippedLowPct: +((clipLow / pixels) * 100).toFixed(3),
    saturation: +(colourful / pixels).toFixed(2),
    tonalRange: usedBuckets,
    detail: +(grad / gradN).toFixed(3),
  };

  const warnings = [];
  if (metrics.meanLuma < 10) warnings.push("frame is almost black — did the scene render?");
  if (metrics.meanLuma > 228) warnings.push("frame is almost white — exposure blown out");
  if (metrics.stdDevLuma < 12) warnings.push("almost no tonal contrast — the frame is flat");
  if (metrics.clippedLowPct > 25) warnings.push(`${metrics.clippedLowPct}% crushed black`);
  if (metrics.tonalRange < 8) warnings.push("very narrow tonal range");
  if (metrics.detail < 3) warnings.push(`detail density ${metrics.detail} — surfaces read as untextured flat shading`);
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
  const report = { generated: new Date().toISOString(), viewport: [WIDTH, HEIGHT], shots: [] };

  try {
    await waitForServer();
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto(GAME_URL, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__scrapQA, null, { timeout: 30000 });
    // Textures load async off the manifest; give them a beat.
    await delay(1200);

    for (const arenaId of ARENAS) {
      const info = await page.evaluate(([a, v, hideHud]) => {
        const qa = window.__scrapQA;
        const r = qa.begin(a, v);
        if (hideHud) qa.hideHUD(true);
        return r;
      }, [arenaId, VEHICLE, !KEEP_HUD]);

      // Warm the sim so pickups spin up, hazards move, bots spread out.
      await page.evaluate((s) => window.__scrapQA.step(s), WARM);
      const stats = await page.evaluate(() => window.__scrapQA.stats());

      for (const poseId of POSE_IDS) {
        const file = path.join(OUT_DIR, `${arenaId}-${poseId}.png`);
        const dataUrl = await page.evaluate(([pid, poseSrc]) => {
          const qa = window.__scrapQA;
          if (pid === "chase") { qa.freeCam(false); qa.chase(); return qa.capture(); }
          const fn = new Function(`return (${poseSrc});`)();
          const p = fn(qa.arena.bounds);
          qa.pose(p.eye, p.look, p.fov);
          return qa.capture();
        }, [poseId, POSES[poseId] ? POSES[poseId].toString() : "null"]);
        await writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
        const { metrics, warnings } = await analyse(file);
        report.shots.push({ arena: arenaId, pose: poseId, file: path.basename(file), metrics, warnings, stats });
        const flag = warnings.length ? `  ⚠︎ ${warnings.join(" | ")}` : "";
        console.log(`${arenaId}/${poseId}  luma ${metrics.meanLuma}  sd ${metrics.stdDevLuma}  sat ${metrics.saturation}  detail ${metrics.detail}${flag}`);
      }
      console.log(`  ${info.arena}: ${stats.meshes} meshes / ${stats.tris} tris / ${stats.drawCalls} draws\n`);
    }

    report.consoleErrors = consoleErrors.slice(0, 20);
    report.pageErrors = pageErrors.slice(0, 20);
    await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

    // Contact sheet so a whole run can be eyeballed in one image.
    const files = report.shots.map((s) => path.join(OUT_DIR, s.file));
    if (files.length) {
      const cols = POSE_IDS.length;
      const tw = 480, th = Math.round((HEIGHT / WIDTH) * 480);
      const tiles = await Promise.all(files.map(async (f, i) => ({
        input: await sharp(f).resize(tw, th).png().toBuffer(),
        left: (i % cols) * tw,
        top: Math.floor(i / cols) * th,
      })));
      await sharp({
        create: {
          width: cols * tw, height: Math.ceil(files.length / cols) * th,
          channels: 3, background: { r: 12, g: 12, b: 16 },
        },
      }).composite(tiles).png().toFile(path.join(OUT_DIR, "_contact.png"));
    }

    if (pageErrors.length) console.log(`\npage errors:\n  ${pageErrors.join("\n  ")}`);
    console.log(`\nWrote ${report.shots.length} shots to ${path.relative(root, OUT_DIR)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
