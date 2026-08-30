#!/usr/bin/env node
/* ============================================================
   BLACKSAND - performance probe

   Times the frame directly instead of trusting the in-game counter.

   `ctx.stats.frameMs` is computed inside the requestAnimationFrame
   callback, and headless Chromium throttles rAF to roughly 1fps - so
   the number the boot check prints (148ms, "8 fps") is measuring the
   throttle, not the renderer. Every visual agent has been adding
   geometry against a performance figure that means nothing.

   This drives `__BS.renderOnce()` in a tight loop and times each call
   with performance.now() inside the page, which measures the actual
   CPU-side cost of simulate + render. It is still not a real machine
   - a headless GPU under ANGLE is not a player's GPU - but it is
   consistent, so regressions and catastrophic costs both show up, and
   the per-tier comparison is meaningful.

   Usage:
     node scripts/blacksand-perf-probe.mjs
     node scripts/blacksand-perf-probe.mjs --tiers ultra --frames 240
   ============================================================ */

import { spawn } from "node:child_process";
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
const PORT = Number(args.port || 47000 + (process.pid % 2000));
const BASE = `http://127.0.0.1:${PORT}`;
const TIERS = String(args.tiers || "low,medium,high,ultra").split(",");
const FRAMES = Number(args.frames || 180);

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

async function measureTier(browser, tier) {
  const page = await (await browser.newContext({
    viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
  })).newPage();

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await page.goto(`${BASE}/games/blacksand.html?qa=1&quality=${tier}`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 180000 });
  await page.evaluate(() => {
    window.__BS.maximize();
    const el = document.getElementById("bs-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  // Warm: let the world settle and every shader compile. A first-frame
  // shader compile can cost 100ms+ and would dominate the sample.
  await page.evaluate(() => window.__BS.advanceTime(4, 1 / 60));
  await page.evaluate(() => { for (let i = 0; i < 40; i += 1) window.__BS.renderOnce(1 / 60); });

  const result = await page.evaluate((frameCount) => {
    const T = window.__BS;
    const samples = [];
    // Walk the player forward through the world so the sample covers
    // varied draw-call counts, not one static view.
    T.releaseCamera();
    const input = T.input;
    input.injectMove(0, -1);
    input.press("sprint");
    for (let i = 0; i < frameCount; i += 1) {
      const t0 = performance.now();
      T.renderOnce(1 / 60);
      samples.push(performance.now() - t0);
    }
    input.injectMove(0, 0);
    input.release("sprint");

    samples.sort((a, b) => a - b);
    const at = (p) => samples[Math.min(samples.length - 1,
      Math.floor((p / 100) * samples.length))];
    const r = T.report();
    return {
      mean: samples.reduce((a, v) => a + v, 0) / samples.length,
      p50: at(50), p90: at(90), p99: at(99), max: samples[samples.length - 1],
      calls: r.render.calls,
      triangles: r.render.triangles,
      programs: r.render.programs,
      textures: r.render.textures,
      geometries: r.render.geometries,
      width: r.render.width, height: r.render.height,
      renderScale: r.render.renderScale,
    };
  }, FRAMES);

  await page.close();
  return { tier, ...result, consoleErrors: consoleErrors.length };
}

async function main() {
  const server = startServer();
  let browser = null;
  const rows = [];
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--mute-audio"],
    });
    for (const tier of TIERS) {
      process.stdout.write(`measuring ${tier}... `);
      const row = await measureTier(browser, tier);
      rows.push(row);
      console.log(`${row.p50.toFixed(1)}ms p50`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }

  console.log("\n--- frame cost, measured directly (simulate + render) ---");
  console.log(
    `${"tier".padEnd(8)}${"p50".padStart(9)}${"p90".padStart(9)}${"p99".padStart(9)}`
    + `${"max".padStart(9)}${"fps@p90".padStart(9)}${"calls".padStart(8)}`
    + `${"tris".padStart(11)}${"progs".padStart(7)}${"res".padStart(12)}`
  );
  for (const r of rows) {
    console.log(
      `${r.tier.padEnd(8)}${r.p50.toFixed(1).padStart(9)}${r.p90.toFixed(1).padStart(9)}`
      + `${r.p99.toFixed(1).padStart(9)}${r.max.toFixed(1).padStart(9)}`
      + `${(1000 / r.p90).toFixed(0).padStart(9)}${String(r.calls).padStart(8)}`
      + `${r.triangles.toLocaleString().padStart(11)}${String(r.programs).padStart(7)}`
      + `${`${r.width}x${r.height}`.padStart(12)}`
    );
  }

  // A shooter is judged on its worst frames, so gate on p90.
  console.log("\n--- verdict ---");
  let failed = false;
  for (const r of rows) {
    const fps = 1000 / r.p90;
    // These are headless-ANGLE numbers, not a player's machine. The
    // budget is deliberately generous; it exists to catch a collapse,
    // not to certify a frame rate.
    const budget = r.tier === "ultra" ? 33 : r.tier === "high" ? 25 : 20;
    const ok = r.p90 <= budget;
    if (!ok) failed = true;
    console.log(`  ${r.tier.padEnd(8)} p90 ${r.p90.toFixed(1)}ms `
      + `(${fps.toFixed(0)} fps)  budget ${budget}ms  ${ok ? "ok" : "OVER BUDGET"}`);
    if (r.consoleErrors) console.log(`           !! ${r.consoleErrors} console error(s)`);
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
