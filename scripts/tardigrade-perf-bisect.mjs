#!/usr/bin/env node
/* ============================================================
   Per-pass frame-cost bisect.

   Renders a fixed pose many times with the whole chain enabled,
   then again with each optional pass disabled in turn. The delta
   is that pass's cost. GPU work is asynchronous, so we time a
   long batch of renders and force a sync each round.
   ============================================================ */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 58300 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const POSE = process.env.POSE || "establishing";
const BATCH = Number(process.env.BATCH || 60);

const server = spawn("/opt/homebrew/bin/python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: root, stdio: ["ignore", "ignore", "ignore"],
});
for (let i = 0; i < 100; i += 1) {
  try { if ((await fetch(`${BASE}/games/tardigrade-simulator.html`)).ok) break; } catch (_) {}
  await delay(100);
}

const browser = await chromium.launch({
  channel: "chromium", headless: true,
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(`${BASE}/games/tardigrade-simulator.html?qa=1&quality=ultra`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__TSIM && window.__TSIM.isReady(), null, { timeout: 90000 });
await page.evaluate(() => { window.__TSIM.hideHud(true); window.__TSIM.advanceTime(3); });

/** Median ms per rendered frame over `batch` renders. */
async function measure(batch) {
  return page.evaluate(async ({ pose, n }) => {
    window.__TSIM.setPose(pose);
    const gl = window.__TSIM_CTX.renderer.getContext();
    // warm up
    for (let i = 0; i < 12; i += 1) window.__TSIM.renderOnce();
    gl.finish();

    const samples = [];
    for (let r = 0; r < 5; r += 1) {
      const t0 = performance.now();
      for (let i = 0; i < n; i += 1) window.__TSIM.renderOnce();
      gl.finish();
      samples.push((performance.now() - t0) / n);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  }, { pose: POSE, n: batch });
}

const chain = await page.evaluate(() =>
  window.__TSIM_CTX.engine.composer.passes.map((p, i) => ({ i, name: p.constructor.name })));

const baseline = await measure(BATCH);
console.log(`pose ${POSE}   baseline ${baseline.toFixed(2)} ms/frame\n`);
console.log("disabling each pass in turn (delta = that pass's cost):");

const results = [];
for (const pass of chain) {
  if (pass.name === "RenderPass") continue;
  await page.evaluate((idx) => {
    const c = window.__TSIM_CTX.engine.composer;
    c.passes.forEach((p) => { p.enabled = true; });
    c.passes[idx].enabled = false;
  }, pass.i);
  const ms = await measure(BATCH);
  results.push({ name: pass.name, ms, saved: baseline - ms });
}

await page.evaluate(() => window.__TSIM_CTX.engine.composer.passes.forEach((p) => { p.enabled = true; }));

results.sort((a, b) => b.saved - a.saved);
for (const r of results) {
  console.log(`  ${r.name.padEnd(22)} without: ${r.ms.toFixed(2)} ms   saves ${r.saved >= 0 ? "+" : ""}${r.saved.toFixed(2)} ms`);
}

// MSAA is not a pass; measure it by rebuilding the target at 0 samples.
const msaa = await page.evaluate(() => {
  const rt = window.__TSIM_CTX.engine.composer.renderTarget1;
  return rt ? rt.samples : null;
});
console.log(`\nMSAA samples on the HDR target: ${msaa}`);

await browser.close();
server.kill("SIGTERM");
