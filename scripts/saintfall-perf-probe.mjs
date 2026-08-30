#!/usr/bin/env node
/* ============================================================
   SAINTFALL - performance probe

   Times the frame directly instead of trusting the in-game counter:
   headless Chromium throttles rAF to ~1fps, so `api.fps` measures
   the throttle, not the renderer (same lesson as the BLACKSAND probe).

   Decomposes the frame three ways per scenario:
     simMs    - api.step(dt, false): all gameplay/animation, no draw
     drawMs   - api.step(0, true): draw an unchanged world (CPU submit)
     syncMs   - drawMs + a 1x1 readPixels, which forces the GPU queue
                to drain - the closest a probe gets to GPU frame cost.

   Scenarios move the trooper to real places with real garrisons, so
   the numbers cover the frames a player actually pays for.

   Usage:
     node scripts/saintfall-perf-probe.mjs
     node scripts/saintfall-perf-probe.mjs --tiers high --frames 120
     node scripts/saintfall-perf-probe.mjs --scenarios spawn,combat
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
const PORT = Number(args.port || 47500 + (process.pid % 2000));
const BASE = `http://127.0.0.1:${PORT}`;
const TIERS = String(args.tiers || "high").split(",");
const FRAMES = Number(args.frames || 140);
const SCENARIOS = String(args.scenarios || "spawn,vista,combat,storm").split(",");

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

/* Each scenario stages the world, then the shared measure loop runs.
   Staging runs inside the page. */
const SCENARIO_SETUP = {
  /* Where the drop leaves you: causeway, lander, Threshold garrison. */
  spawn: `
    T.teleport(-14, 830, Math.PI);
    T.advanceTime(1.5, 1/60);
  `,
  /* Long look up the whole basin toward the cathedral: worst-case
     geometry in frustum. */
  vista: `
    T.teleport(0, 700, 0);
    const p = window.__SF.ctx.player;
    T.lookAt([0, 26, 700], [0, 60, -900], 60);
    T.advanceTime(1.0, 1/60);
  `,
  /* A real fight: a wave of threshers plus stilts, close in. */
  combat: `
    T.teleport(-14, 700, 0);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      T.spawnEnemy("thresher", -14 + Math.cos(a) * (14 + (i % 5) * 4),
        700 + Math.sin(a) * (14 + (i % 5) * 4));
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      T.spawnEnemy("gleaner", -14 + Math.cos(a) * 34, 700 + Math.sin(a) * 34);
    }
    T.advanceTime(1.5, 1/60);
  `,
  /* Storm doubles the particle work and changes the light. */
  storm: `
    T.setStorm(1);
    T.teleport(-14, 700, 0);
    T.advanceTime(2.0, 1/60);
  `,
};

async function measureTier(browser, tier) {
  const page = await (await browser.newContext({
    viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
  })).newPage();

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=${tier}&time=goldenhour`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  // Warm: settle the world and compile every shader before timing.
  await page.evaluate(() => {
    const T = window.__SF;
    T.advanceTime(3, 1 / 60);
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
  });

  const rows = [];
  for (const scen of SCENARIOS) {
    const setup = SCENARIO_SETUP[scen];
    if (!setup) continue;
    const result = await page.evaluate(async ({ setupSrc, frameCount }) => {
      const T = window.__SF;
      // eslint-disable-next-line no-new-func
      new Function("T", setupSrc)(T);
      for (let i = 0; i < 20; i += 1) T.renderOnce(1 / 60);

      const glCtx = document.getElementById("sf-canvas").getContext("webgl2")
        || document.getElementById("sf-canvas").getContext("webgl");
      const px = new Uint8Array(4);

      const sim = [];
      const draw = [];
      const sync = [];
      for (let i = 0; i < frameCount; i += 1) {
        let t0 = performance.now();
        T.advanceTime(1 / 60, 1 / 60);       // one sim step, no draw
        sim.push(performance.now() - t0);

        t0 = performance.now();
        T.renderStill();                      // draw only
        const t1 = performance.now();
        draw.push(t1 - t0);
        if (glCtx) {
          glCtx.readPixels(0, 0, 1, 1, glCtx.RGBA, glCtx.UNSIGNED_BYTE, px);
          sync.push(performance.now() - t0);
        }
      }
      const stat = (arr) => {
        if (!arr.length) return { p50: 0, p90: 0, p99: 0 };
        const s = [...arr].sort((a, b) => a - b);
        const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
        return { p50: at(50), p90: at(90), p99: at(99) };
      };
      const r = T.report();
      return {
        sim: stat(sim), draw: stat(draw), sync: stat(sync),
        calls: r.render.calls, triangles: r.render.triangles,
        programs: r.render.programs, textures: r.render.textures,
        geometries: r.render.geometries,
        enemies: r.enemies, terrain: r.terrain,
      };
    }, { setupSrc: setup, frameCount: FRAMES });
    rows.push({ scenario: scen, ...result });
  }

  await page.close();
  return { tier, rows, consoleErrors };
}

async function main() {
  const server = startServer();
  let browser = null;
  const out = [];
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--mute-audio"],
    });
    for (const tier of TIERS) {
      process.stdout.write(`measuring ${tier}...\n`);
      out.push(await measureTier(browser, tier));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }

  for (const t of out) {
    console.log(`\n=== ${t.tier} ===`);
    console.log(
      `${"scenario".padEnd(9)}${"sim p50".padStart(9)}${"sim p90".padStart(9)}`
      + `${"draw p50".padStart(10)}${"draw p90".padStart(10)}`
      + `${"sync p50".padStart(10)}${"sync p90".padStart(10)}`
      + `${"calls".padStart(7)}${"tris".padStart(11)}`
    );
    for (const r of t.rows) {
      console.log(
        `${r.scenario.padEnd(9)}${r.sim.p50.toFixed(2).padStart(9)}${r.sim.p90.toFixed(2).padStart(9)}`
        + `${r.draw.p50.toFixed(2).padStart(10)}${r.draw.p90.toFixed(2).padStart(10)}`
        + `${r.sync.p50.toFixed(2).padStart(10)}${r.sync.p90.toFixed(2).padStart(10)}`
        + `${String(r.calls).padStart(7)}${r.triangles.toLocaleString().padStart(11)}`
      );
    }
    if (t.consoleErrors.length) {
      console.log(`  !! ${t.consoleErrors.length} console error(s):`);
      for (const e of t.consoleErrors.slice(0, 5)) console.log(`     ${e.slice(0, 200)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
