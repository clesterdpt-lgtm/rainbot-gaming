#!/usr/bin/env node
/* ============================================================
   SAINTFALL - full-figure stills of the LIVE fire pose

   The pose probe's fire bearings are taken while the free camera is
   parked off-axis, and the aim solver converges on that camera - so
   its plates show a pose the game never holds. This fires through
   the real input with the real chase camera, then FREEZES time and
   walks the free camera round the held pose with renderStill, which
   is the one way to photograph live fire from the side honestly.

   Usage: node scripts/saintfall-fire-pose-stills.mjs --tag now
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const tag = arg("--tag", "fire");
const outDir = path.resolve(root, arg("--out", "output/saintfall/fire-pose-stills"));
const PORT = 44200 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${BASE}/games/saintfall-white-vigil.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never became ready");
}

function capture() {
  const T = window.__SF;
  const THREE = T.THREE;
  const p = T.player;
  T.maximize();
  T.hideHud(true);
  const site = T.findFlatSite(6);
  p.spawn(site[0], site[1], Math.PI * 0.25);
  T.advanceTime(1.2, 1 / 60);

  /* Live fire through the real input, real chase camera. */
  for (let i = 0; i < 60; i += 1) {
    T.setFiring(true);
    T.advanceTime(1 / 60, 1 / 60);
  }

  /* Time now stops; the held pose is walked round with renderStill. */
  const st = p.state;
  const focus = new THREE.Vector3(st.x, T.ctx.terrain.heightAt(st.x, st.z) + 1.30, st.z);
  const plates = [];
  const BEARINGS = [
    ["profile", st.yaw + Math.PI / 2, 3.1, 0.06],
    ["front34", st.yaw + Math.PI * 0.78, 3.1, 0.06],
    ["front", st.yaw + Math.PI, 3.0, 0.02],
  ];
  for (const [name, yaw, dist, pitch] of BEARINGS) {
    const eye = [
      focus.x + Math.sin(yaw) * dist * Math.cos(pitch),
      focus.y + Math.sin(pitch) * dist + 0.15,
      focus.z + Math.cos(yaw) * dist * Math.cos(pitch),
    ];
    /* The free camera hides the figure unless told otherwise - the
       standing grip-shots trap. */
    T.hidePlayer(false);
    p.setFree(true, eye, [focus.x, focus.y, focus.z], 34);
    T.renderStill();
    T.renderStill();
    plates.push({ name, url: T.captureDataURL() });
    p.setFree(false);
  }
  T.setFiring(false);
  return { plates };
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/games/saintfall-white-vigil.html?qa=1&quality=high&character=white-vigil&cycle=0`, {
      waitUntil: "domcontentloaded", timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
    await page.evaluate(() => {
      try { window.__SF.setTime("day"); } catch (_) { window.__SF.setTime("goldenhour"); }
    });
    const res = await page.evaluate(capture);
    await mkdir(outDir, { recursive: true });
    for (const plate of res.plates) {
      await writeFile(path.join(outDir, `${tag}-${plate.name}.png`),
        Buffer.from(plate.url.slice(plate.url.indexOf(",") + 1), "base64"));
    }
    console.log(`${res.plates.length} plates -> ${path.relative(root, outDir)}`);
    if (errors.length) console.log(`errors: ${errors.join(" | ")}`);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
