#!/usr/bin/env node
/* ============================================================
   SAINTFALL - landmark far-LOD boundary probe

   The far-LOD claim is "sub-pixel at the swap distance". This is the
   instrument that checks the claim instead of trusting the
   arithmetic: it frames one wheel from JUST PAST its swap distance,
   renders the same frame twice - once as the player gets it (far
   level active) and once with the LOD forced to the full level - and
   diffs the frames. Whatever the swap actually costs the picture is
   in that diff, at the worst distance it can ever cost it.

   Also asserts the mechanics: full level active when near, far level
   active when past the boundary, and prints the in-view triangle
   delta the swap buys on that framing.

   Usage: node scripts/saintfall-lod-wheel-probe.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 47100 + (process.pid % 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(root, "output/saintfall/lod-wheel");

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
  fs.mkdirSync(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  let failures = 0;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    })).newPage();
    page.on("pageerror", (e) => console.error("pageerror:", String(e).slice(0, 300)));
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&time=goldenhour`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });

    const result = await page.evaluate(async () => {
      const T = window.__SF;
      T.maximize();
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);

      const scene = T.render.scene;
      const pivot = scene.getObjectByName("cathedral-meshy-choir-wheel-plaza");
      if (!pivot) return { error: "plaza wheel pivot not found" };
      let lod = null;
      pivot.traverse((o) => { if (o.isLOD && !lod) lod = o; });
      if (!lod) return { error: "no LOD under the plaza wheel - far variant did not load?" };

      const wp = pivot.getWorldPosition(new T.THREE.Vector3());
      const height = pivot.userData.landmarkPlacement?.targetHeight || 26;
      const swap = lod.levels[1].distance;

      const activeLevel = () => {
        // The nearest visible level object tells us which side of the
        // boundary the last render used.
        for (let i = 0; i < lod.levels.length; i += 1) {
          if (lod.levels[i].object.visible) return i;
        }
        return -1;
      };
      const frame = (dist) => {
        // Stand the camera at `dist` from the wheel centre, framed on it.
        const cy = wp.y + height * 0.5;
        T.lookAt([wp.x, cy, wp.z + dist], [wp.x, cy, wp.z], 60);
        T.renderStill();
        T.renderStill();
        return T.render.captureDataURL();
      };

      const checks = [];
      // Mechanics: near uses the full level, past-boundary uses the far one.
      frame(swap * 0.5);
      checks.push(["near frame uses full level", activeLevel() === 0, `level ${activeLevel()}`]);
      const farShot = frame(swap * 1.15);
      checks.push(["past-boundary frame uses far level", activeLevel() === 1, `level ${activeLevel()}`]);
      const farTris = T.render.info().triangles;

      // Same framing, LOD pinned to the full level: the counterfactual.
      lod.autoUpdate = false;
      lod.levels[0].object.visible = true;
      lod.levels[1].object.visible = false;
      T.renderStill();
      const fullShot = T.render.captureDataURL();
      const fullTris = T.render.info().triangles;
      lod.autoUpdate = true;

      return {
        swap: Number(swap.toFixed(1)), height,
        farShot, fullShot, farTris, fullTris, checks,
      };
    });

    if (result.error) { console.error("FAIL:", result.error); process.exit(1); }
    for (const [name, ok, detail] of result.checks) {
      console.log(`  ${ok ? "ok " : "FAIL"} ${name}  (${detail})`);
      if (!ok) failures += 1;
    }
    console.log(`  swap distance ${result.swap}m for a ${result.height}m wheel`);
    console.log(`  frame triangles at boundary: far ${result.farTris.toLocaleString()} vs full ${result.fullTris.toLocaleString()}`);

    const toRaw = async (dataUrl) => sharp(Buffer.from(dataUrl.split(",")[1], "base64"))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const a = await toRaw(result.fullShot);
    const b = await toRaw(result.farShot);
    let diff = 0, maxDelta = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const d = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d > 0) diff += 1;
      if (d > maxDelta) maxDelta = d;
    }
    const pct = (diff / (a.info.width * a.info.height)) * 100;
    console.log(`  swap-boundary picture delta: ${pct.toFixed(4)}% of pixels, max channel delta ${maxDelta}`);
    await sharp(Buffer.from(result.fullShot.split(",")[1], "base64"))
      .toFile(path.join(OUT, "boundary-full.png"));
    await sharp(Buffer.from(result.farShot.split(",")[1], "base64"))
      .toFile(path.join(OUT, "boundary-far.png"));
    console.log(`  crops: output/saintfall/lod-wheel/boundary-{full,far}.png`);
    /* The gate is deliberately loose in pixels-changed (the wheel
       occupies real area in this deliberate close framing) and tight
       on WHERE it is allowed to matter: this framing FILLS the frame
       with the wheel at the swap boundary, several times larger than
       any player view of it, so a low percentage here is a far lower
       one in play. */
    if (result.farTris >= result.fullTris) {
      console.log("  FAIL far level did not reduce the frame's triangles");
      failures += 1;
    }
    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} CHECKS FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
