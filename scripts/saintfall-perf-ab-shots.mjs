#!/usr/bin/env node
/* ============================================================
   SAINTFALL - A/B stills for perf changes

   Perf work on this level is only allowed to change the FRAME TIME,
   not the frame. This captures deterministic stills (qa=1 pins
   renderScale/shadow cadence) across scenarios and times of day so a
   chunking/draw-order change can be proven pixel-identical - and so
   that when it is NOT identical, the diff image says where to look.

   Usage:
     node scripts/saintfall-perf-ab-shots.mjs --out output/saintfall/perf-ab/base
     node scripts/saintfall-perf-ab-shots.mjs --out output/saintfall/perf-ab/after
     node scripts/saintfall-perf-ab-shots.mjs --compare output/saintfall/perf-ab/base output/saintfall/perf-ab/after
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const PORT = 47200 + (process.pid % 1000);
const BASE = `http://127.0.0.1:${PORT}`;

const SHOTS = [
  { id: "spawn-golden", time: "goldenhour", setup: `T.teleport(-14, 830, Math.PI); T.advanceTime(1.5, 1/60);` },
  { id: "vista-golden", time: "goldenhour", setup: `T.teleport(0, 700, 0); T.lookAt([0, 26, 700], [0, 60, -900], 60); T.advanceTime(1.0, 1/60);` },
  { id: "road-noon", time: "noon", setup: `T.teleport(-14, 400, Math.PI); T.advanceTime(1.0, 1/60);` },
  { id: "fosse-golden", time: "goldenhour", setup: `T.teleport(64, 428, Math.PI * 0.5); T.advanceTime(1.0, 1/60);` },
  { id: "scatter-dusk", time: "dusk", setup: `T.teleport(-600, -200, Math.PI * 1.5); T.advanceTime(1.0, 1/60);` },
  { id: "night-sky", time: "night", setup: `T.teleport(0, 700, 0); T.lookAt([0, 26, 700], [0, 260, -900], 60); T.advanceTime(1.0, 1/60);` },
];

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

async function capture(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const shot of SHOTS) {
      const page = await (await browser.newContext({
        viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
      })).newPage();
      page.on("pageerror", (e) => console.error("pageerror:", String(e).slice(0, 200)));
      await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&time=${shot.time}`,
        { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });
      const dataUrl = await page.evaluate(async (setup) => {
        const T = window.__SF;
        T.maximize();
        const el = document.getElementById("sf-boot");
        if (el && el.parentNode) el.parentNode.removeChild(el);
        // eslint-disable-next-line no-new-func
        new Function("T", setup)(T);
        for (let i = 0; i < 12; i += 1) T.renderOnce(1 / 60);
        T.renderStill();
        return T.render.captureDataURL();
      }, shot.setup);
      const buf = Buffer.from(dataUrl.split(",")[1], "base64");
      fs.writeFileSync(path.join(outDir, `${shot.id}.png`), buf);
      console.log(`captured ${shot.id} (${buf.length} bytes)`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

async function compare(dirA, dirB) {
  let worst = { id: null, diffPct: 0 };
  for (const shot of SHOTS) {
    const pa = path.join(dirA, `${shot.id}.png`);
    const pb = path.join(dirB, `${shot.id}.png`);
    if (!fs.existsSync(pa) || !fs.existsSync(pb)) { console.log(`${shot.id}: MISSING`); continue; }
    const a = await sharp(pa).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(pb).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
      console.log(`${shot.id}: SIZE MISMATCH`); continue;
    }
    let diff = 0, maxDelta = 0;
    const w = a.info.width, h = a.info.height;
    const diffBuf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < a.data.length; i += 4) {
      const d = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d > 0) diff += 1;
      if (d > maxDelta) maxDelta = d;
      diffBuf[i] = d > 0 ? 255 : a.data[i] >> 2;
      diffBuf[i + 1] = d > 0 ? 0 : a.data[i + 1] >> 2;
      diffBuf[i + 2] = d > 0 ? 0 : a.data[i + 2] >> 2;
      diffBuf[i + 3] = 255;
    }
    const pct = (diff / (w * h)) * 100;
    console.log(`${shot.id}: ${pct.toFixed(4)}% pixels differ, max channel delta ${maxDelta}`);
    if (pct > 0) {
      await sharp(diffBuf, { raw: { width: w, height: h, channels: 4 } })
        .png().toFile(path.join(dirB, `${shot.id}-diff.png`));
    }
    if (pct > worst.diffPct) worst = { id: shot.id, diffPct: pct };
  }
  console.log(worst.diffPct === 0 ? "\nALL IDENTICAL" : `\nworst: ${worst.id} at ${worst.diffPct.toFixed(4)}%`);
}

async function main() {
  const ci = args.indexOf("--compare");
  if (ci >= 0) { await compare(args[ci + 1], args[ci + 2]); return; }
  const oi = args.indexOf("--out");
  const out = oi >= 0 ? args[oi + 1] : "output/saintfall/perf-ab/base";
  await capture(path.resolve(root, out));
}

main().catch((e) => { console.error(e); process.exit(1); });
