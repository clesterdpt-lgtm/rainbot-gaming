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
    /* A scale decision is APPLIED at the top of the next render (a
       resized canvas is a cleared canvas, so the resize and the draw
       that refills it have to be the same frame). Every read below
       therefore renders one frame first - which is also what the live
       loop does, so the test exercises the real sequence. */
    const settle = `
      T.render.tickAutoScale(33);
      T.renderStill();
    `;
    const qaForced = await qa.page.evaluate(() => {
      const T = window.__SF;
      T.render.setAutoScale(true, { force: true });
      // Past the startup grace window before any of this counts.
      T.render.tickAutoScale(16);
      const t0 = performance.now();
      while (performance.now() - t0 < 3100) { /* spin past grace */ }
      // Sustained 30fps signal, each decision realised by a draw.
      for (let i = 0; i < 40; i += 1) { T.render.tickAutoScale(33); T.renderStill(); }
      return T.render.renderScale;
    });
    void settle;
    check("over-budget walks scale down", qaForced < 1, `scale=${qaForced.toFixed(3)}`);

    await delay(1100); // let holdUntil lapse
    const second = await qa.page.evaluate(() => {
      const T = window.__SF;
      for (let i = 0; i < 40; i += 1) { T.render.tickAutoScale(33); T.renderStill(); }
      return T.render.renderScale;
    });
    check("second step after cooldown", second < qaForced, `scale=${second.toFixed(3)}`);

    await delay(3200); // let lockUntil lapse
    const recovered = await qa.page.evaluate(async () => {
      const T = window.__SF;
      // Healthy cadence for >4s of accumulated under-budget time.
      for (let i = 0; i < 300; i += 1) { T.render.tickAutoScale(15); T.renderStill(); }
      return T.render.renderScale;
    });
    check("healthy cadence probes back up", recovered > second, `scale=${recovered.toFixed(3)}`);

    const restored = await qa.page.evaluate(() => {
      const T = window.__SF;
      T.render.setAutoScale(false);
      T.renderStill();
      return T.render.renderScale;
    });
    check("disable restores native", restored === 1, `scale=${restored}`);

    /* THE REGRESSION THAT SHIPPED: a scale change used to be applied
       the moment it was decided, which is after the frame was drawn -
       and resizing a canvas clears it, so the compositor was handed an
       empty buffer and the player saw a black flash on every step.
       Assert the canvas holds an image on the very frame a step lands. */
    const stepFrame = await qa.page.evaluate(() => {
      const T = window.__SF;
      T.render.setAutoScale(false);
      T.render.setRenderScale(1);
      T.renderStill();
      const gl = T.render.renderer.getContext();
      const px = new Uint8Array(4 * 64);
      const readMean = () => {
        gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1,
          8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let s = 0;
        for (let i = 0; i < 64; i += 1) {
          s += px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722;
        }
        return s / 64;
      };
      const before = readMean();
      T.render.setRenderScale(0.7);   // queue a step
      T.renderStill();                 // the frame that applies AND draws it
      return { before, onStepFrame: readMean(), scale: T.render.renderScale };
    });
    check("canvas is not black on a resolution-step frame",
      stepFrame.onStepFrame > 4 && stepFrame.scale < 1,
      `mean ${stepFrame.onStepFrame.toFixed(1)} at scale ${stepFrame.scale.toFixed(2)}`);
    await qa.page.evaluate(() => {
      window.__SF.render.setRenderScale(1);
      window.__SF.renderStill();
    });
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
    /* Deliberately preserved on the player path too. Setting it false
       saved nothing measurable and turned every late frame into a
       black flash: with the buffer unpreserved its contents are
       undefined once the compositor has taken them, so any frame the
       page is late to redraw composites from a cleared buffer. */
    check("player: drawing buffer preserved", pInfo.preserve === true);
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
