#!/usr/bin/env node
/* ============================================================
   SAINTFALL - ROCK CLOSE-RANGE SHOTS

   Rock close-range harness. The blind set has no camera inside 100 m
   of a rock face and the round 7 note asks for micro-detail at 4 m as
   well as at 900 m, so these are authored here rather than added to
   the shipped pose table (that file belongs to another agent this
   round). Eye/target pairs are world metres, picked off the field:
   the east flank of the Cauldron runs a dead straight 50 degree face
   from y 3 to y 60, and the crater floor at r < 50 is flat at 194 m.

   Usage:  node scripts/saintfall-rock-shots.mjs <out-dir-name> [port]
   Writes output/saintfall/island/<out-dir-name>/{face-4m,face-22m,
   face-110m,cap-6m}.png. Score them with
   saintfall-rock-metric.mjs.
   ============================================================ */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const ROOT = "/Volumes/External SSD/Projects/RainbotGaming";
const TAG = process.argv[2] || "rk";
const OUT = `${ROOT}/output/saintfall/island/${TAG}`;
const PORT = Number(process.argv[3] || 8311);
mkdirSync(OUT, { recursive: true });
const SHOTS = [
  // 4 m off the flank at y ~ 12: what the player sees on the way up
  ["face-4m",  [-149.0, 12.5, 371.5], [-153.7, 13.5, 367.7], 55],
  // 22 m back from the same face
  ["face-22m", [-133.0, 10.0, 384.0], [-157.7, 22.0, 367.7], 52],
  // 110 m back, the whole lower flank
  ["face-110m", [-60.0, 22.0, 440.0], [-170.0, 45.0, 367.7], 45],
  // standing on the crater floor looking across it at the rim wall
  ["cap-6m",   [-327.7, 195.7, 367.7], [-380.0, 200.0, 367.7], 60],
];
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));
const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--disable-gpu-vsync", "--force-device-scale-factor=1", "--hide-scrollbars", "--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://127.0.0.1:${PORT}/games/saintfall-green-antiphon.html?qa=1&time=trade&quality=ultra&nointro=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__SF, null, { timeout: 180000 });
await page.waitForFunction(() => window.__SF.isReady && window.__SF.isReady(), null, { timeout: 180000 });
for (const [name, eye, tgt, fov] of SHOTS) {
  const png = await page.evaluate(async ([e, t, f]) => {
    const T = window.__SF; T.maximize();
    T.lookAt(e, t, f);
    for (let i = 0; i < 8; i += 1) T.renderStill();
    return T.captureDataURL();
  }, [eye, tgt, fov]);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(png.split(",")[1], "base64"));
  console.log("wrote", name);
}
await browser.close(); server.kill(); process.exit(0);
