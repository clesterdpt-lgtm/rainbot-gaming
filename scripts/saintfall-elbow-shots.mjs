#!/usr/bin/env node
/* ============================================================
   SAINTFALL - elbow shots at off-forward aim bearings

   The carry-pose review only ever photographs the reticle straight
   ahead, which is the one bearing the elbows were never wrong at.
   This shoots the bearings they WERE wrong at.

   The chase camera cannot take this picture. Once the body commits
   it stands a fixed MAX_CHEST_TWIST off the camera bearing, so every
   bearing frames the trooper identically - from behind, with the
   jetpack across the arms. A sheet shot that way is twelve copies of
   one photograph.

   So: free camera for the CAMERA, and swing the weapon underneath it.
   In free mode the lance aims along `camYaw`/`camPitch` rather than
   the camera ray, and `setCam` writes those two without moving a free
   camera - so the body can be pinned facing one way, the camera
   parked on its front three-quarter, and the aim swept through the
   bearings the sweep flagged.

   READ THIS SHEET FOR THE GRIP AND THE ARM SILHOUETTE, not as proof
   the elbow is stable. Free mode zeroes the carry aim, so the pole is
   NOT rotated with the reticle the way it is in play - which is the
   motion that used to sweep it through the arm axis. No camera can
   photograph that: with the body committed the chase camera sits a
   fixed MAX_CHEST_TWIST off the trooper's back, and free mode is the
   only way off that rail. Stability is measured, not photographed -
   see scripts/saintfall-elbow-sweep.mjs, which drives the real
   gameplay path over 432 bearings and reads the joints directly.

   Usage: node scripts/saintfall-elbow-shots.mjs [label]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const label = process.argv[2] || "after";
const out = path.resolve(root, "output/saintfall/elbow-shots");
const PORT = 42900 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

const TILE_W = 300;
const TILE_H = 420;
// Bearings the sweep flagged, plus dead ahead as the control.
const BEARINGS = [0, -70, -140, 70, 140, 180];
const PITCHES = [-35, 0, 25];
// Front three-quarter on the trigger side, where the elbow reads.
const CAM_BEARING = -Math.PI / 2 + 0.75;

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
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      window.__SF.hideHud(true);
      window.__SF.autoStow(false);       // photographing the carry pose
      window.__SF.setTime("golden");
      window.__SF.clearEnemies();
      window.__SF.releaseCamera();
      window.__SF.teleport(-520, -562, 0);
      window.__SF.weapons.setMode("ranged");
      window.__SF.setGaitInput(0, 0);
    });
    await mkdir(out, { recursive: true });

    const tiles = [];
    for (const pitchDeg of PITCHES) {
      for (const yawDeg of BEARINGS) {
        const shot = await page.evaluate(([y, p, camBearing]) => {
          const T = window.__SF;
          // Body pinned facing PI; the camera parked on its front
          // quarter; only the aim moves between tiles.
          T.poseFigure(camBearing, { radius: 3.9, fov: 36, aim: 0.98, eye: 1.15, yaw: Math.PI });
          T.weapons.setMode("ranged");
          T.setFiring(true);
          T.setCam(Math.PI + y * Math.PI / 180, p * Math.PI / 180);
          for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
          T.renderStill();
          return { url: T.captureDataURL() };
        }, [yawDeg, pitchDeg, CAM_BEARING]);
        const buffer = Buffer.from(shot.url.slice(shot.url.indexOf(",") + 1), "base64");
        tiles.push(await sharp(buffer).resize(TILE_W, TILE_H, { fit: "cover" })
          .composite([{
            input: tag(TILE_W, `aim ${yawDeg}deg  pitch ${pitchDeg}deg`),
            left: 0, top: 0,
          }]).png().toBuffer());
      }
    }

    const cols = BEARINGS.length;
    const rows = PITCHES.length;
    const sheetBuf = await sharp({
      create: {
        width: cols * TILE_W, height: rows * TILE_H,
        channels: 3, background: { r: 18, g: 16, b: 12 },
      },
    }).composite(tiles.map((input, i) => ({
      input, left: (i % cols) * TILE_W, top: Math.floor(i / cols) * TILE_H,
    }))).png().toBuffer();
    const file = path.join(out, `${label}.png`);
    await writeFile(file, sheetBuf);

    console.log(`page/console errors: ${errors.length}`);
    console.log(path.relative(root, file));
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
