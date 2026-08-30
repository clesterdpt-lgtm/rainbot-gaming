#!/usr/bin/env node
/* ============================================================
   SAINTFALL - turning gait contact sheet

   The numbers in `saintfall-turn-gait-probe` say the ankles no
   longer cross. This is the picture of it: a hard turn sampled at
   even intervals from behind and slightly above, which is the one
   angle where a scissoring gait is unmistakable and a three-quarter
   hero shot hides it completely.

   Usage: node scripts/saintfall-turn-gait-shots.mjs <outdir> [label]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, process.argv[2] || "output/saintfall/turn-gait-shots");
const label = process.argv[3] || "";
const PORT = 46100 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

const FRAMES = 8;
const TILE_W = 260;
const TILE_H = 340;

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
  const safe = String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return Buffer.from(`<svg width="${width}" height="26" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="26" fill="#0d0b10" fill-opacity="0.85"/>
    <text x="8" y="18" fill="#f4d487" font-family="monospace" font-size="13">${safe}</text>
  </svg>`);
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
    const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    /* `hidePlayer(false)` is not redundant with the default: a free
       camera hides the figure unless the override forces it, and the
       whole subject of this sheet is the figure. */
    await page.evaluate(() => {
      window.__SF.maximize();
      window.__SF.hideHud(true);
      window.__SF.hidePlayer(false);
    });

    await mkdir(outDir, { recursive: true });

    /* Set the trooper running, then reverse the stick and sample the
       turn. The camera is placed by hand each frame rather than left
       to the chase rig, because the chase rig also swings through
       the turn and a camera that turns with the hips cannot show
       that the hips turned. */
    await page.evaluate(() => {
      const T = window.__SF;
      T._teleportRaw(-520, -562, 0);
      T.setGaitInput(0, -1);
      T.advanceTime(1.4, 1 / 60);
      T.setGaitInput(0, 1);            // full about-face
    });

    const shots = [];
    for (let i = 0; i < FRAMES; i += 1) {
      const shot = await page.evaluate(() => {
        const T = window.__SF;
        /* Re-arm the stick EVERY frame, because `lookAt` puts the
           player into free-camera mode and the movement update
           returns before it in that mode - so a loop that placed the
           camera once and then advanced time photographed a frozen
           trooper eight times. `setGaitInput` drops free mode again.  */
        T.setGaitInput(0, 1);
        T.advanceTime(0.11, 1 / 60);
        const p = T.gaitState();
        /* Behind and a little above, at chest height rather than
           overhead, on a FIXED world bearing. The chase rig swings
           through the turn with the hips, and a camera that turns
           with the hips is exactly the one that cannot show the hips
           turning. The narrow lens is what makes the ankles legible. */
        T.lookAt([p.x, p.y + 1.30, p.z + 5.6], [p.x, p.y + 0.62, p.z], 30);
        return { url: T.captureDataURL(), state: p };
      });
      const buf = Buffer.from(shot.url.slice(shot.url.indexOf(",") + 1), "base64");
      const t = (0.11 * (i + 1)).toFixed(2);
      const w = shot.state.yawRate.toFixed(1);
      shots.push(await sharp(buf)
        .resize(TILE_W, TILE_H, { fit: "cover", position: "center" })
        .composite([{ input: tag(TILE_W, `t+${t}s  turn ${w} rad/s`), left: 0, top: 0 }])
        .png().toBuffer());
    }

    const cols = 4;
    const rows = Math.ceil(FRAMES / cols);
    const sheet = await sharp({
      create: {
        width: cols * TILE_W, height: rows * TILE_H + 30,
        channels: 3, background: "#0d0b10",
      },
    }).composite([
      { input: tag(cols * TILE_W, `SAINTFALL 180-degree reversal at speed ${label}`), left: 0, top: 0 },
      ...shots.map((input, i) => ({
        input,
        left: (i % cols) * TILE_W,
        top: 30 + Math.floor(i / cols) * TILE_H,
      })),
    ]).png().toBuffer();

    const file = path.join(outDir, `reversal${label ? `-${label}` : ""}.png`);
    await writeFile(file, sheet);
    console.log(`wrote ${path.relative(root, file)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
