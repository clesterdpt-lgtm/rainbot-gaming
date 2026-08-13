#!/usr/bin/env node
/* ============================================================
   SAINTFALL - live-loop performance measurement

   Headed browser, real GPU, DPR 2 (the Retina case), NO qa flag: the
   production rAF loop runs, the dynamic-resolution controller is
   live, and the number reported is true presented cadence (rAF ticks
   per second measured in-page over rolling windows).

   --pin1 runs the same scenario with ?dynres=0 (scale pinned at 1
   and, for the baseline comparison, shadows back to every frame via
   the console hook) to reproduce the pre-change frame rate.

   Usage:
     node scripts/saintfall-perf-live.mjs            # optimized path
     node scripts/saintfall-perf-live.mjs --pin1     # pre-change path
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIN1 = process.argv.includes("--pin1");
const SECONDS = Number(process.argv[process.argv.indexOf("--seconds") + 1] || 36);
const PORT = 48400 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;

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
      const res = await fetch(`${BASE}/games/saintfall.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: false,
      args: ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio",
        "--force-device-scale-factor=2"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2,
    })).newPage();
    page.on("pageerror", (e) => console.error("pageerror:", String(e).slice(0, 200)));

    const url = `${BASE}/games/saintfall.html?intro=0&time=goldenhour${PIN1 ? "&dynres=0" : ""}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });
    await page.evaluate((pin1) => {
      const T = window.__SF;
      T.maximize();
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
      if (pin1) T.render.setShadowEvery(1);   // full pre-change behavior
      T.teleport(-14, 830, Math.PI);

      // rAF cadence meter, in-page, independent of the game loop.
      window.__fpsMeter = { frames: 0, t0: performance.now(), rows: [] };
      const tick = () => {
        const m = window.__fpsMeter;
        m.frames += 1;
        const dt = performance.now() - m.t0;
        if (dt >= 3000) {
          m.rows.push({
            fps: (m.frames / dt) * 1000,
            scale: T.render.renderScale,
            at: Math.round(performance.now() / 1000),
          });
          m.frames = 0;
          m.t0 = performance.now();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, PIN1);

    // Hold W so the trooper walks the causeway: moving world, moving
    // shadow casters, the honest case.
    await page.keyboard.down("w");
    await delay(SECONDS * 1000);
    await page.keyboard.up("w");

    const out = await page.evaluate(() => ({
      rows: window.__fpsMeter.rows,
      report: window.__SF.report(),
    }));

    console.log(`--- ${PIN1 ? "pinned scale=1, shadows every frame (pre-change)" : "optimized path"} `
      + `- DPR2, 1440x810 css ---`);
    for (const r of out.rows) {
      console.log(`  t+${String(r.at).padStart(3)}s  ${r.fps.toFixed(1).padStart(6)} fps   scale ${r.scale.toFixed(3)}`);
    }
    const settled = out.rows.slice(-4);
    const avg = settled.reduce((a, r) => a + r.fps, 0) / Math.max(1, settled.length);
    console.log(`settled fps (last 4 windows): ${avg.toFixed(1)}`);
    console.log(`render: scale=${out.report.render.renderScale} calls=${out.report.render.calls} `
      + `tris=${out.report.render.triangles} shadowEvery=${out.report.render.shadowEvery}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
