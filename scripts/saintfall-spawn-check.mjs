#!/usr/bin/env node
/* ============================================================
   SAINTFALL - where the drop actually lands

   The spawn was written as a plain coordinate and had drifted off the
   Pilgrim's Road onto the shoulder above it. Both spawns are derived
   from ROAD_PATH now, so this checks the thing that actually matters:
   that the trooper is standing ON the roadbed, on the level, with the
   causeway running away in front of them rather than a hillside.

   The roadbed is cut flat within 9m of the centreline and grades out
   to a shoulder over the next 26m, so "on the road" means inside 9m.

   Usage: node scripts/saintfall-spawn-check.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, "output/saintfall/spawn");
const PORT = 43900 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

// Inside this of the centreline is roadbed; beyond it is shoulder.
const ROADBED_HALF_WIDTH = 9;
// A level roadbed. More than this over a 6m span is a slope.
const LEVEL_TOLERANCE_M = 0.9;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

function tag(width, text) {
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(`<svg width="${width}" height="22">`
    + `<rect width="${width}" height="22" fill="#12100c"/>`
    + `<text x="6" y="16" font-family="monospace" font-size="13" fill="#f4d9a0">${safe}</text>`
    + `</svg>`);
}

async function main() {
  const server = startServer();
  let browser = null;
  const fails = [];
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({ viewport: { width: 1120, height: 700 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    await mkdir(out, { recursive: true });

    /* --- measured, untouched: this is where the game put the player --- */
    const probe = await page.evaluate(() => {
      const T = window.__SF;
      T.hideHud(true);
      T.maximize();
      T.setTime("golden");
      T.clearEnemies();
      // NOT teleported. The whole point is where the boot sequence
      // left the trooper.
      for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
      const ps = T.playerState();

      const road = T.roadPointAtZ(ps.z);
      const offRoadM = Math.hypot(ps.x - road.x, 0);

      // Level ground under the boots: sampled across the roadbed and
      // along it, since a spawn on a shoulder reads as a sideways tilt.
      const g = (x, z) => T.groundHeightAt(x, z);
      const here = g(ps.x, ps.z);
      const across = Math.abs(g(ps.x + 3, ps.z) - g(ps.x - 3, ps.z));
      const along = Math.abs(g(ps.x, ps.z + 3) - g(ps.x, ps.z - 3));

      // And that the way the trooper is facing is actually open.
      T.setCam(ps.yaw, -0.02);
      for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
      const clear = T.aimClearance(320).clearM;

      return {
        x: +ps.x.toFixed(2), z: +ps.z.toFixed(2), y: +here.toFixed(2),
        yawDeg: +(ps.yaw * 180 / Math.PI).toFixed(1),
        roadX: +road.x.toFixed(2),
        roadYawDeg: +(road.yaw * 180 / Math.PI).toFixed(1),
        offRoadM: +offRoadM.toFixed(2),
        acrossM: +across.toFixed(2),
        alongM: +along.toFixed(2),
        clear: +clear.toFixed(1),
      };
    });

    /* --- what it looks like from the drop --- */
    const tiles = [];
    for (const [label, pitch, dist] of [
      ["from the drop, looking up the road", -0.02, 5.2],
      ["the causeway underfoot", -0.55, 4.0],
    ]) {
      const url = await page.evaluate(([p, d]) => {
        const T = window.__SF;
        const ps = T.playerState();
        T.setCam(ps.yaw, p, d);
        for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);
        T.renderStill();
        return T.captureDataURL();
      }, [pitch, dist]);
      const buffer = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      tiles.push(await sharp(buffer).resize(560, 420, { fit: "cover" })
        .composite([{ input: tag(560, label), left: 0, top: 0 }]).png().toBuffer());
    }
    const sheetBuf = await sharp({
      create: { width: 1120, height: 420, channels: 3, background: { r: 18, g: 16, b: 12 } },
    }).composite(tiles.map((input, i) => ({ input, left: i * 560, top: 0 })))
      .png().toBuffer();
    await writeFile(path.join(out, "drop.png"), sheetBuf);

    const p = probe;
    console.log("\nSAINTFALL drop point\n" + "=".repeat(66));
    console.log(`spawned at (${p.x}, ${p.z}) at ${p.y}m, facing ${p.yawDeg}deg`);
    console.log(`the road here runs through x ${p.roadX} at ${p.roadYawDeg}deg`);
    console.log(`off the centreline: ${p.offRoadM}m   (roadbed is ${ROADBED_HALF_WIDTH}m either side)`);
    console.log(`ground fall across/along a 6m span: ${p.acrossM}m / ${p.alongM}m`);
    console.log(`clear ahead on the trooper's own facing: ${p.clear}m`);
    console.log("=".repeat(66));

    if (p.offRoadM > ROADBED_HALF_WIDTH) {
      fails.push(`spawned ${p.offRoadM}m off the centreline - that is the shoulder, not the road`);
    }
    if (p.acrossM > LEVEL_TOLERANCE_M) {
      fails.push(`the ground falls ${p.acrossM}m across the trooper - standing on a slope`);
    }
    // Facing a hillside is the other half of the complaint.
    if (p.clear < 60) {
      fails.push(`only ${p.clear}m of clear ground ahead - the drop faces into a rise`);
    }
    if (errors.length) fails.push(`${errors.length} page errors: ${errors[0]}`);

    if (fails.length) {
      console.log("FAIL");
      for (const f of fails) console.log(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("the drop lands on the causeway, on the level, with the road ahead");
    }
    console.log(path.relative(root, path.join(out, "drop.png")));
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
