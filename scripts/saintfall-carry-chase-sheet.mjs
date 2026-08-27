#!/usr/bin/env node
/* ============================================================
   SAINTFALL - White Vigil carry through the REAL chase camera

   Every other loadout instrument photographs with a free camera,
   which is not the view the carry was reported broken from. This
   captures the actual gameplay frame - chase camera, real input -
   in the states a player passes through: standing, two walk phases,
   trigger held, and the post-fire decay.

   Usage: node scripts/saintfall-carry-chase-sheet.mjs --tag now
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const tag = arg("--tag", "chase");
const outDir = path.resolve(root, arg("--out", "output/saintfall/carry-chase"));
const PORT = 48400 + (process.pid % 900);
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

function runStates() {
  const T = window.__SF;
  const THREE = T.THREE;
  const p = T.player;
  const loadout = T.ctx.playerLoadout;
  T.maximize();

  const site = T.findFlatSite(6);
  p.spawn(site[0], site[1], Math.PI * 0.25);
  /* The default chase boom frames the mountain, not the carry. Pull
     to the close-follow distance a player actually plays at. */
  if ("camDist" in p.state) p.state.camDist = 3.4;
  T.advanceTime(1.5, 1 / 60);

  const camDir = new THREE.Vector3();
  const emitDir = new THREE.Vector3();
  const measure = () => {
    const camera = T.ctx.render.camera;
    camera.getWorldDirection(camDir);
    return loadout.parts.map((part) => {
      part.asset.updateWorldMatrix(true, true);
      emitDir.fromArray(part.spec.emitterAxis)
        .transformDirection(part.asset.matrixWorld).normalize();
      return {
        id: part.spec.id,
        emit: emitDir.toArray().map((v) => +v.toFixed(3)),
        dotCamera: +emitDir.dot(camDir).toFixed(3),
      };
    });
  };

  const frames = [];
  const shoot = (label) => {
    T.renderOnce();
    frames.push({ label, url: T.captureDataURL(), aim: measure() });
  };

  /* standing */
  shoot("rest");

  /* two walk phases, real input */
  p.input.inject(0, -1);
  T.advanceTime(1.1, 1 / 60);
  shoot("walk-a");
  T.advanceTime(0.22, 1 / 60);
  shoot("walk-b");
  p.input.inject(null);
  T.advanceTime(0.8, 1 / 60);

  /* trigger held - re-asserted every frame like the real poll */
  for (let i = 0; i < 55; i += 1) {
    T.setFiring(true);
    T.advanceTime(1 / 60, 1 / 60);
  }
  shoot("fire-held");

  /* the decay frame a released trigger leaves behind */
  T.setFiring(false);
  T.advanceTime(0.30, 1 / 60);
  shoot("post-fire");
  T.advanceTime(1.2, 1 / 60);
  shoot("settled");

  return { frames };
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
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
    const res = await page.evaluate(runStates);

    await mkdir(outDir, { recursive: true });
    const files = [];
    for (const frame of res.frames) {
      const file = path.join(outDir, `${tag}-${frame.label}.png`);
      await writeFile(file, Buffer.from(frame.url.slice(frame.url.indexOf(",") + 1), "base64"));
      files.push({ label: frame.label, file, aim: frame.aim });
    }

    /* sheet: 3 x 2 grid */
    const TILE_W = 640; const TILE_H = 360; const LABEL_H = 22;
    const cols = 3; const rows = Math.ceil(files.length / cols);
    const composites = [];
    for (let i = 0; i < files.length; i += 1) {
      const col = i % cols; const row = Math.floor(i / cols);
      const img = await sharp(files[i].file).resize(TILE_W, TILE_H).png().toBuffer();
      const label = Buffer.from(`<svg width="${TILE_W}" height="${LABEL_H}">`
        + `<rect width="${TILE_W}" height="${LABEL_H}" fill="#12100c"/>`
        + `<text x="6" y="16" font-family="monospace" font-size="13" fill="#f4d9a0">${files[i].label}</text>`
        + `</svg>`);
      composites.push({ input: await sharp(label).png().toBuffer(), left: col * TILE_W, top: row * (TILE_H + LABEL_H) });
      composites.push({ input: img, left: col * TILE_W, top: row * (TILE_H + LABEL_H) + LABEL_H });
    }
    const sheet = path.join(outDir, `${tag}-sheet.png`);
    await sharp({ create: { width: TILE_W * cols, height: (TILE_H + LABEL_H) * rows, channels: 3, background: "#000" } })
      .composite(composites).png().toFile(sheet);

    for (const entry of files) {
      console.log(`${entry.label.padEnd(10)} ${entry.aim.map((a) => `${a.id} dot ${a.dotCamera}`).join("   ")}`);
    }
    console.log(`sheet -> ${path.relative(root, sheet)}`);
    if (errors.length) console.log(`errors: ${errors.join(" | ")}`);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
