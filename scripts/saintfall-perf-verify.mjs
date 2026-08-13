#!/usr/bin/env node
/* ============================================================
   SAINTFALL - perf change verification

   Three checks, one run:

   1. QA determinism: with ?qa=1 the shadow map redraws every frame,
      the dynamic scale is pinned at 1, and the drawing buffer is
      preserved - the harness contract is exactly what it was.

   2. Shadow interleave mechanics: in the player path (?dynres left
      alone, shadowEvery 2) a still frame after the world stops is
      IDENTICAL to the every-frame-shadow picture - staleness of a
      static scene is invisible by construction. Verified by pixel
      compare of captures with shadowEvery 1 vs 2.

   3. Controller mechanics: synthetic over-budget ticks walk the
      scale down; synthetic healthy ticks walk it back up after the
      lock expires. Uses real waits for the cooldowns.

   Usage: node scripts/saintfall-perf-verify.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 47950 + (process.pid % 500);
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

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

async function boot(browser, url) {
  const page = await (await browser.newContext({
    viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
  })).newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  return { page, errors };
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--mute-audio"],
    });

    /* ---------------- 1. QA contract unchanged ---------------- */
    console.log("--- qa contract ---");
    const qa = await boot(browser, `${BASE}/games/saintfall.html?qa=1&quality=high&time=goldenhour`);
    const qaInfo = await qa.page.evaluate(() => {
      const T = window.__SF;
      T.advanceTime(2, 1 / 60);
      for (let i = 0; i < 10; i += 1) T.renderOnce(1 / 60);
      const attrs = T.render.renderer.getContext().getContextAttributes();
      return { ...T.report().render, preserve: attrs.preserveDrawingBuffer };
    });
    check("qa: shadow redraw every frame", qaInfo.shadowEvery === 1, `shadowEvery=${qaInfo.shadowEvery}`);
    check("qa: dynamic scale pinned", qaInfo.renderScale === 1 && qaInfo.autoScale === false,
      `scale=${qaInfo.renderScale} auto=${qaInfo.autoScale}`);
    check("qa: drawing buffer preserved", qaInfo.preserve === true);
    check("qa: boots clean", qa.errors.length === 0, qa.errors[0] || "");

    /* ------------- 2. interleaved shadows, same picture ------------- */
    console.log("--- shadow interleave picture parity ---");
    const pix = await qa.page.evaluate(() => {
      const T = window.__SF;
      T.teleport(-14, 830, Math.PI);
      T.advanceTime(1, 1 / 60);

      // Settle, then capture the same still under both cadences. The
      // world is stepped identically in between; only the shadow
      // redraw schedule differs.
      const grab = () => {
        T.renderStill();
        return T.captureDataURL();
      };
      T.render.setShadowEvery(1);
      T.renderOnce(0);
      const a = grab();
      T.render.setShadowEvery(2);
      // an odd number of renders so a capture lands on a "stale" frame
      T.renderOnce(0); T.renderOnce(0); T.renderOnce(0);
      const b = grab();
      T.render.setShadowEvery(1);
      return { a, b };
    });
    check("still frame identical under interleave", pix.a === pix.b,
      pix.a === pix.b ? "byte-equal data URLs" : "captures differ");

    /* ---------------- 3. controller mechanics ---------------- */
    console.log("--- dynamic resolution controller ---");
    const qaForced = await qa.page.evaluate(() => {
      const T = window.__SF;
      T.render.setAutoScale(true, { force: true });
      // Feed a sustained 30fps signal: 40 ticks x 33ms = 1.3s over budget.
      for (let i = 0; i < 40; i += 1) T.render.tickAutoScale(33);
      return T.render.renderScale;
    });
    check("over-budget walks scale down", qaForced < 1, `scale=${qaForced.toFixed(3)}`);

    await delay(1100); // let holdUntil lapse
    const second = await qa.page.evaluate(() => {
      const T = window.__SF;
      for (let i = 0; i < 40; i += 1) T.render.tickAutoScale(33);
      return T.render.renderScale;
    });
    check("second step after cooldown", second < qaForced, `scale=${second.toFixed(3)}`);

    await delay(3200); // let lockUntil lapse
    const recovered = await qa.page.evaluate(async () => {
      const T = window.__SF;
      // Healthy cadence for >4s of accumulated under-budget time.
      for (let i = 0; i < 300; i += 1) T.render.tickAutoScale(15);
      return T.render.renderScale;
    });
    check("healthy cadence probes back up", recovered > second, `scale=${recovered.toFixed(3)}`);

    const restored = await qa.page.evaluate(() => {
      const T = window.__SF;
      T.render.setAutoScale(false);
      return T.render.renderScale;
    });
    check("disable restores native", restored === 1, `scale=${restored}`);
    await qa.page.close();

    /* ---------------- 4. player-path defaults ---------------- */
    console.log("--- player path (no ?qa) ---");
    const player = await boot(browser, `${BASE}/games/saintfall.html?intro=0&time=goldenhour`);
    const pInfo = await player.page.evaluate(() => {
      const T = window.__SF;
      for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
      const attrs = T.render.renderer.getContext().getContextAttributes();
      return { ...T.report().render, preserve: attrs.preserveDrawingBuffer };
    });
    check("player: shadows interleaved", pInfo.shadowEvery === 2, `shadowEvery=${pInfo.shadowEvery}`);
    check("player: autoscale armed", pInfo.autoScale === true);
    check("player: buffer not preserved", pInfo.preserve === false);
    check("player: boots clean", player.errors.length === 0, player.errors[0] || "");
    await player.page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
