#!/usr/bin/env node
/* Active third-person visual/performance proof for Saintfall.

   Unlike the broad gameplay regression suite, this starts a fresh page
   for every profile, keeps the player moving and firing, synchronises
   the WebGL context, and records real canvas/DPR/render counters next
   to the screenshot it measures. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "output/saintfall/aaa-vesper-active-play");
const port = 47000 + (process.pid % 1200);
const base = `http://127.0.0.1:${port}`;

const profiles = [
  { id: "desktop-golden", width: 1280, height: 720, dpr: 1, quality: "high", time: "goldenhour" },
  { id: "desktop-vespers", width: 1280, height: 720, dpr: 1, quality: "high", time: "dusk" },
  { id: "mobile-night", width: 390, height: 844, dpr: 2, quality: "high", time: "night" },
];

const percentile = (values, p) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(out, { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const results = [];

  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(`${base}/games/saintfall.html?qa=1&quality=${profile.quality}`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });

    const measured = await page.evaluate(async (settings) => {
      const T = window.__SF;
      T.maximize();
      T.setStorm(0);
      T.setTime(settings.time);
      T.setQuality(settings.quality);
      T.releaseCamera();
      T.hidePlayer(false);
      // This is the same open-dune corridor used by the collision
      // suite's unobstructed-ground proof.  The generic flat-site
      // search can choose ground beneath monumental world geometry,
      // which is valid terrain but a useless character screenshot.
      T.teleport(300, 430, 2.45);
      const boot = document.getElementById("sf-boot");
      if (boot) boot.remove();

      const canvas = T.render.renderer.domElement;
      const gl = T.render.renderer.getContext();
      const finish = () => { if (typeof gl.finish === "function") gl.finish(); };
      const before = T.report();
      const start = { ...before.player };
      const ammo0 = before.weapons?.ammo ?? before.weapons?.mag ?? null;

      T.player.input.inject(0.18, -1);
      T.player.input.state.sprint = true;
      for (let i = 0; i < 120; i += 1) {
        if (i % 24 === 0) T.fireWeapon(1);
        T.renderOnce(1 / 60);
      }
      finish();

      const frameMs = [];
      let fired = 0;
      for (let i = 0; i < 180; i += 1) {
        if (i % 30 === 0) fired += T.fireWeapon(1);
        const started = performance.now();
        T.renderOnce(1 / 60);
        finish();
        frameMs.push(performance.now() - started);
      }
      T.player.input.inject(null, null);
      T.player.input.state.sprint = false;

      // Leave a live combat frame on screen rather than a post-test idle.
      // Daylight proves gunplay; low-light profiles prove the signature
      // censer-lance and its local amber readability.
      if (settings.time === "goldenhour") {
        fired += T.fireWeapon(1);
        T.renderStill();
      } else {
        T.equipWeapon("glaive");
        T.freezeAction("melee1", 0.30);
      }
      finish();
      const image = T.captureDataURL();
      const after = T.report();
      const ammo1 = after.weapons?.ammo ?? after.weapons?.mag ?? null;
      return {
        frameMs,
        fired,
        movedM: Math.hypot(after.player.x - start.x, after.player.z - start.z),
        ammoDelta: ammo0 === null || ammo1 === null ? null : ammo0 - ammo1,
        canvas: {
          css: [canvas.clientWidth, canvas.clientHeight],
          backing: [canvas.width, canvas.height],
          dpr: window.devicePixelRatio,
        },
        report: after,
        image,
      };
    }, profile);

    const png = Buffer.from(measured.image.slice(measured.image.indexOf(",") + 1), "base64");
    const screenshot = path.join(out, `${profile.id}.png`);
    await writeFile(screenshot, png);
    const times = measured.frameMs;
    const result = {
      ...profile,
      canvas: measured.canvas,
      frames: times.length,
      p50Ms: Number(percentile(times, 0.50).toFixed(2)),
      p95Ms: Number(percentile(times, 0.95).toFixed(2)),
      p99Ms: Number(percentile(times, 0.99).toFixed(2)),
      maxMs: Number(Math.max(...times).toFixed(2)),
      over16_67: times.filter((value) => value > 16.67).length,
      movedM: Number(measured.movedM.toFixed(2)),
      fired: measured.fired,
      ammoDelta: measured.ammoDelta,
      render: measured.report.render,
      enemies: measured.report.enemies,
      errors,
      screenshot: path.relative(root, screenshot),
    };
    results.push(result);
    console.log(`${profile.id}: p50 ${result.p50Ms}ms · p95 ${result.p95Ms}ms`
      + ` · p99 ${result.p99Ms}ms · ${result.over16_67}/${result.frames} over 16.67ms`);
    console.log(`  ${result.render.calls} calls · ${result.render.triangles.toLocaleString()} tris`
      + ` · canvas ${result.canvas.backing.join("x")} · moved ${result.movedM}m · errors ${errors.length}`);
    await context.close();
  }

  await browser.close();
  await writeFile(path.join(out, "report.json"), JSON.stringify({ profiles: results }, null, 2));
  const failed = results.filter((result) => {
    const mobile = result.width < 500;
    return result.errors.length || result.p95Ms > 16.67 || result.movedM < 3
      || result.render.calls > (mobile ? 120 : 180)
      || result.render.triangles > (mobile ? 600000 : 700000);
  });
  if (failed.length) {
    throw new Error(`active-play gate failed: ${failed.map((result) => result.id).join(", ")}`);
  }
  console.log(`artifacts: ${path.relative(root, out)}`);
} finally {
  server.kill("SIGTERM");
}
