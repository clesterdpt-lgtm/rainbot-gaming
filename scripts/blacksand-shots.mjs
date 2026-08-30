#!/usr/bin/env node
/* ============================================================
   BLACKSAND - screenshot harness

   Boots the game in a GPU-backed headless Chromium, waits until
   frames are genuinely being produced, drives the QA camera through
   the beauty-shot poses, and writes PNGs plus a diagnostics JSON.

   Usage:
     node scripts/blacksand-shots.mjs
     node scripts/blacksand-shots.mjs --out output/blacksand-shots/run-2 \
       --poses establishing,street --width 1920 --height 1080 --warm 4

   Flags:
     --out <dir>       artifact directory
     --poses <a,b,c>   pose ids, or "all" (default all)
     --width/--height  viewport (default 1600x900)
     --quality <tier>  low|medium|high|ultra (default ultra)
     --warm <seconds>  simulated seconds before capture (default 3)
     --hud             keep the HUD visible (default hidden)
     --viewmodel       keep the first-person weapon (default hidden)
     --action          also capture gameplay-in-motion frames
     --headed          run with a visible browser window
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
const OUT_DIR = path.resolve(root, args.out || "output/blacksand-shots/latest");
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 900);
const QUALITY = String(args.quality || "ultra");
const WARM_SECONDS = Number(args.warm ?? 3);
const KEEP_HUD = Boolean(args.hud);
const KEEP_VIEWMODEL = Boolean(args.viewmodel);
const HEADED = Boolean(args.headed);
const PORT = Number(args.port || 42000 + (process.pid % 11000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE_URL}/games/blacksand.html?qa=1&quality=${QUALITY}`;

/* ------------------------- static server ------------------------- */

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`Static server never came up on ${BASE_URL}`);
}

/* --------------------------- browser --------------------------- */

async function launchBrowser() {
  // `channel: "chromium"` uses the full Chromium build rather than the
  // headless shell, which throttles requestAnimationFrame to ~1fps and
  // yields black screenshots.
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

/**
 * Grab the rendered frame from the WebGL drawing buffer rather than
 * from Playwright's screenshot API.
 *
 * page.screenshot() goes through the browser compositor, which only
 * refreshes on a real animation frame. Headless Chromium throttles
 * those to roughly 1fps, so a harness that forces its own frames gets
 * byte-identical captures of a stale composited surface - eight poses,
 * one image. Reading the drawing buffer is exact and cannot go stale.
 */
async function grabFrame(page, file) {
  const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const buffer = Buffer.from(base64, "base64");
  if (file) await writeFile(file, buffer);
  return buffer;
}

/* ------------------------ image analysis ------------------------ */

/**
 * Objective checks so a broken frame cannot be signed off as "looks
 * good". Catches the classic failures: black frame, blown-out frame,
 * flat frame, drained frame.
 *
 * There is deliberately no "camera is inside geometry" image check
 * here. That fault is geometric, not statistical - a camera buried in
 * a wall sits inside the normal range on every histogram measure. The
 * guard that works is `cameraClearance()`, applied below.
 */
async function analyseImage(file) {
  const image = sharp(file).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const pixels = data.length / info.channels;

  let sum = 0;
  let sumSq = 0;
  let clippedHigh = 0;
  let clippedLow = 0;
  let colourfulness = 0;
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
    colourfulness += Math.max(r, g, b) - Math.min(r, g, b);
    histogram[Math.min(31, luma >> 3)] += 1;
  }

  const mean = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - mean * mean);
  const usedBuckets = histogram.reduce((n, v) => n + (v > pixels * 0.0004 ? 1 : 0), 0);

  const metrics = {
    meanLuma: Number(mean.toFixed(2)),
    stdDevLuma: Number(Math.sqrt(variance).toFixed(2)),
    clippedHighPct: Number(((clippedHigh / pixels) * 100).toFixed(3)),
    clippedLowPct: Number(((clippedLow / pixels) * 100).toFixed(3)),
    saturation: Number((colourfulness / pixels).toFixed(2)),
    tonalRange: usedBuckets,
  };

  const warnings = [];
  if (metrics.meanLuma < 12) warnings.push("frame is almost black - did the scene render?");
  if (metrics.meanLuma > 225) warnings.push("frame is almost white - exposure is blown out");
  if (metrics.stdDevLuma < 12) warnings.push("almost no tonal contrast - the frame is flat");
  if (metrics.clippedHighPct > 12) warnings.push(`${metrics.clippedHighPct}% of pixels are clipped white - lower exposure`);
  if (metrics.clippedLowPct > 20) warnings.push(`${metrics.clippedLowPct}% of pixels are crushed black - lift the shadows`);
  if (metrics.tonalRange < 8) warnings.push("very narrow tonal range - the histogram is bunched up");
  if (metrics.saturation < 8) warnings.push("nearly monochrome - the grade has drained the colour");

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
      colorScheme: "light",
    });
    const page = await context.newPage();

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 150000 });

    // Fill the viewport with the playfield. Without this the render is
    // a small window inside the site's page chrome and every image
    // metric measures the sidebar instead of the game.
    const stage = await page.evaluate(() => window.__BS.maximize());
    console.log(`stage ${stage.width}x${stage.height}`);

    // Force real frames rather than trusting rAF.
    await page.evaluate(() => { for (let i = 0; i < 20; i += 1) window.__BS.renderOnce(1 / 60); });

    if (!KEEP_HUD) await page.evaluate(() => window.__BS.hideHud(true));
    if (!KEEP_VIEWMODEL) await page.evaluate(() => window.__BS.hideViewmodel(true));

    // The boot overlay is opaque and fades on a timer; remove it
    // unconditionally before any capture.
    await page.evaluate(() => {
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    // Let the world settle: physics, foliage, bots taking positions.
    await page.evaluate((seconds) => window.__BS.advanceTime(seconds, 1 / 60), WARM_SECONDS);

    const available = await page.evaluate(() => window.__BS.listPoses());
    const requested = !args.poses || args.poses === "all" || args.poses === true
      ? available.map((p) => p.id)
      : String(args.poses).split(",").map((s) => s.trim()).filter(Boolean);

    const shots = [];

    for (const poseId of requested) {
      if (!available.some((p) => p.id === poseId)) {
        console.warn(`skipping unknown pose "${poseId}"`);
        continue;
      }
      await page.evaluate((id) => window.__BS.setPose(id), poseId);

      /* ---- let the frame SETTLE before measuring it ----
         A pose changes the time of day, which moves the sun, which
         moves the exposure target, which the eye-adaptation damper then
         eases towards at 1.6/s. Rendering eight frames afterwards
         advances 0.13 simulated seconds - about 19% of the way there -
         so the captured exposure depended on how far the previous
         pose's exposure happened to be from this one's.

         The symptom was brutal to attribute: median frame luma moved
         98.7 -> 161.7 -> 102.8 -> 111 across consecutive runs with NO
         code change, and every agent tuning against the metric gate was
         chasing that noise. Three simulated seconds puts adaptation
         inside 1%, and also lets the sky's weather easing converge. */
      await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
      await page.evaluate(() => { for (let i = 0; i < 8; i += 1) window.__BS.renderOnce(1 / 60); });

      /* ---- nudge the camera off near geometry ----
         The pose author cannot know what the generator put in front of
         the lens. Search a small set of offsets that keep the aim point
         fixed, and take the best one by MEASURED frame contrast rather
         than by clearance alone: a search that only knows about
         obstruction will happily move the camera somewhere clear and
         throw the shot away. */
      const plan = await page.evaluate((id) => {
        const T = window.__BS;
        const THREE = T.THREE;
        const pose = T.ctx.world.getBeautyShots().find((p) => p.id === id);
        if (!pose || !pose.position || !pose.target) return null;
        const eye = new THREE.Vector3().fromArray(pose.position);
        const at = new THREE.Vector3().fromArray(pose.target);
        const fwd = at.clone().sub(eye).normalize();
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
        const terrain = T.ctx.terrain;
        // A candidate must stay above the ground. Without this the
        // search can drop a camera below the terrain, which produces a
        // huge-contrast black frame that a contrast-only gate scores
        // as the best candidate in the set.
        const aboveGround = (v) => v.y > terrain.heightAt(v.x, v.z) + 1.4;

        const out = [{ p: eye.toArray(), base: true }];
        for (const d of [1.5, 3.5, 7]) {
          for (const [rx, uy, fz] of [
            [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0.6, -1], [0.7, 0.5, 0], [-0.7, 0.5, 0],
          ]) {
            const cand = eye.clone()
              .addScaledVector(right, rx * d)
              .addScaledVector(up, uy * d)
              .addScaledVector(fwd, fz * d);
            if (!aboveGround(cand)) continue;
            out.push({ p: cand.toArray(), base: false });
          }
        }
        return { cands: out, target: pose.target, fov: pose.fov };
      }, poseId);

      if (plan) {
        let base = null;
        let best = null;
        for (const candidate of plan.cands) {
          const clear = await page.evaluate((a) => {
            window.__BS.lookAt(a.p, a.t, a.fov);
            for (let i = 0; i < 2; i += 1) window.__BS.renderOnce(1 / 60);
            return window.__BS.cameraClearance().nearest;
          }, { p: candidate.p, t: plan.target, fov: plan.fov });

          const buffer = await grabFrame(page);
          const { data } = await sharp(buffer).greyscale().resize(160, 90).raw()
            .toBuffer({ resolveWithObject: true });
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) sum += data[i];
          const mean = sum / data.length;
          let v = 0;
          for (let i = 0; i < data.length; i += 1) v += (data[i] - mean) ** 2;
          const contrast = Math.sqrt(v / data.length);

          const record = { ...candidate, clear: clear === null ? 999 : clear, contrast };
          if (candidate.base) {
            base = record;
            if (record.clear >= 2.5) break;   // the authored pose is fine
          } else if (base && record.clear > base.clear * 1.2 && contrast >= base.contrast * 0.95) {
            if (!best || contrast > best.contrast) best = record;
          }
        }
        const pick = best || base;
        if (pick) {
          await page.evaluate((a) => window.__BS.lookAt(a.p, a.t, a.fov),
            { p: pick.p, t: plan.target, fov: plan.fov });
        }
      }

      // Real frames so temporal effects resolve.
      await page.evaluate(() => { for (let i = 0; i < 8; i += 1) window.__BS.renderOnce(1 / 60); });
      await delay(120);

      const file = path.join(OUT_DIR, `${poseId}.png`);
      await grabFrame(page, file);

      const analysis = await analyseImage(file);
      const clearance = await page.evaluate(() => window.__BS.cameraClearance());
      if (clearance.nearest !== null && clearance.nearest < 1.2) {
        analysis.warnings.push(
          `camera has only ${clearance.nearest}m of clearance - geometry is pressed against the lens`
        );
      }
      shots.push({ pose: poseId, file: path.relative(root, file), clearance, ...analysis });

      console.log(`captured ${poseId} -> ${path.relative(root, file)}  clearance=${clearance.nearest}`);
      console.log(
        `   luma ${analysis.metrics.meanLuma} sd ${analysis.metrics.stdDevLuma} `
        + `clipHi ${analysis.metrics.clippedHighPct}% clipLo ${analysis.metrics.clippedLowPct}% `
        + `sat ${analysis.metrics.saturation} range ${analysis.metrics.tonalRange}/32`
      );
      for (const warning of analysis.warnings) console.log(`   !! ${warning}`);
    }

    /* ---- gameplay-in-motion shots ---- */
    if (args.action) {
      const beats = [
        { id: "action-firefight", seconds: 4.5, setup: "aim" },
        { id: "action-sprint", seconds: 1.2, setup: "sprint" },
        { id: "action-ads", seconds: 0.8, setup: "ads" },
      ];
      for (const beat of beats) {
        try {
          await page.evaluate((spec) => {
            const T = window.__BS;
            T.releaseCamera();
            T.hideViewmodel(false);
            const input = T.input;
            input.injectMove(0, spec.setup === "sprint" ? -1 : 0);
            if (spec.setup === "sprint") input.press("sprint"); else input.release("sprint");
            input.state.ads = spec.setup === "ads";
            input.state.fire = spec.setup === "aim";
            T.advanceTime(spec.seconds, 1 / 60);
            input.state.fire = false;
            input.injectMove(0, 0);
          }, beat);
          await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });
          const file = path.join(OUT_DIR, `${beat.id}.png`);
          await grabFrame(page, file);
          const analysis = await analyseImage(file);
          shots.push({ pose: beat.id, file: path.relative(root, file), ...analysis });
          console.log(`captured ${beat.id}`);
          for (const warning of analysis.warnings) console.log(`   !! ${warning}`);
        } catch (error) {
          console.warn(`action beat "${beat.id}" failed: ${error.message}`);
        }
      }
    }

    const report = await page.evaluate(() => window.__BS.report());
    await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify({
      url: GAME_URL,
      viewport: { width: WIDTH, height: HEIGHT },
      quality: QUALITY,
      capturedAt: new Date().toISOString(),
      shots,
      report,
      consoleErrors,
      pageErrors,
    }, null, 2));

    console.log("\n--- diagnostics ---");
    console.log(JSON.stringify({
      fps: report.fps,
      frameMs: report.frameMs,
      calls: report.render.calls,
      triangles: report.render.triangles,
      sky: report.sky,
      world: report.world,
      bots: report.bots,
    }, null, 2));

    if (pageErrors.length) {
      console.error(`\n${pageErrors.length} page error(s):`);
      pageErrors.forEach((e) => console.error(`  ${e}`));
    }
    if (consoleErrors.length) {
      console.error(`\n${consoleErrors.length} console error(s):`);
      consoleErrors.slice(0, 20).forEach((e) => console.error(`  ${e}`));
    }

    const imageWarnings = shots.reduce((n, shot) => n + shot.warnings.length, 0);
    if (imageWarnings) console.error(`\n${imageWarnings} image-quality warning(s) - see report.json`);
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
