#!/usr/bin/env node
/* ============================================================
   SAINTFALL - GPU cost decomposition

   Measures synced frame cost (render + 1x1 readPixels, which drains
   the GPU queue) while toggling individual pipeline features:

     baseline        everything on, as shipped
     no-shadow-up    shadowMap.autoUpdate=false (freeze, don't clear)
     no-ao           AO passes skipped
     no-msaa         scene target realloc'd with samples=0
     all-off         all of the above

   Also repeats baseline at deviceScaleFactor 2 to show how the frame
   scales with pixel count (a Retina Mac plays at DPR 2).

   Usage: node scripts/saintfall-perf-decompose.mjs [--frames 90]
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const FRAMES = Number((args[args.indexOf("--frames") + 1] || 90));
const PORT = 47800 + (process.pid % 1000);
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

const MEASURE = `
  (frames) => {
    const T = window.__SF;
    const glCtx = document.getElementById("sf-canvas").getContext("webgl2");
    const px = new Uint8Array(4);
    const samples = [];
    for (let i = 0; i < frames; i += 1) {
      const t0 = performance.now();
      T.renderOnce(1 / 60);
      glCtx.readPixels(0, 0, 1, 1, glCtx.RGBA, glCtx.UNSIGNED_BYTE, px);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const at = (p) => samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))];
    return { p50: at(50), p90: at(90) };
  }
`;

async function bootPage(browser, dsf) {
  const page = await (await browser.newContext({
    viewport: { width: 1600, height: 900 }, deviceScaleFactor: dsf,
  })).newPage();
  page.on("pageerror", (e) => console.error("  pageerror:", String(e).slice(0, 200)));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&time=goldenhour`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
    const T = window.__SF;
    T.teleport(-14, 830, Math.PI);
    T.advanceTime(2, 1 / 60);
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
  });
  return page;
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: !args.includes("--headed"),
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--mute-audio"],
    });

    const page = await bootPage(browser, 1);
    const run = (label, setup) => page.evaluate(
      ({ setupSrc, frames, measureSrc }) => {
        const T = window.__SF;
        // eslint-disable-next-line no-new-func
        new Function("T", setupSrc)(T);
        for (let i = 0; i < 12; i += 1) T.renderOnce(1 / 60);
        // eslint-disable-next-line no-eval
        return eval(measureSrc)(frames);
      },
      { setupSrc: setup, frames: FRAMES, measureSrc: MEASURE }
    ).then((r) => {
      console.log(`${label.padEnd(16)} p50 ${r.p50.toFixed(2).padStart(7)}ms   p90 ${r.p90.toFixed(2).padStart(7)}ms`);
      return r;
    });

    console.log(`--- DPR 1, 1600x900, quality=high, ${FRAMES} frames ---`);
    const base1 = await run("baseline", ``);
    await run("no-shadow-up", `T.render.renderer.shadowMap.autoUpdate = false;`);
    await run("no-ao", `T.render.setAo(0);`);
    await run("no-msaa", `
      const t = T.render.targets.sceneTarget;
      t.samples = 0; t.dispose();
    `);
    await run("all-off", ``);
    // restore for sanity
    await run("restored", `
      T.render.renderer.shadowMap.autoUpdate = true;
      T.render.setAo(0.85);
      const t = T.render.targets.sceneTarget;
      t.samples = 4; t.dispose();
    `);
    await page.close();

    console.log(`\n--- DPR 2 (Retina), 1600x900 CSS -> 3200x1800 device px ---`);
    const page2 = await bootPage(browser, 2);
    const run2 = (label, setup) => page2.evaluate(
      ({ setupSrc, frames, measureSrc }) => {
        const T = window.__SF;
        // eslint-disable-next-line no-new-func
        new Function("T", setupSrc)(T);
        for (let i = 0; i < 12; i += 1) T.renderOnce(1 / 60);
        // eslint-disable-next-line no-eval
        return eval(measureSrc)(frames);
      },
      { setupSrc: setup, frames: FRAMES, measureSrc: MEASURE }
    ).then((r) => {
      console.log(`${label.padEnd(16)} p50 ${r.p50.toFixed(2).padStart(7)}ms   p90 ${r.p90.toFixed(2).padStart(7)}ms`);
      return r;
    });
    const base2 = await run2("baseline", ``);
    await run2("no-shadow-up", `T.render.renderer.shadowMap.autoUpdate = false;`);
    await run2("no-ao", `T.render.setAo(0);`);
    await run2("no-msaa", `
      const t = T.render.targets.sceneTarget;
      t.samples = 0; t.dispose();
    `);
    await run2("all-off", ``);
    await page2.close();

    console.log(`\nDPR scaling: p50 ${base1.p50.toFixed(1)}ms -> ${base2.p50.toFixed(1)}ms `
      + `(${(base2.p50 / base1.p50).toFixed(2)}x for 4x pixels)`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
