#!/usr/bin/env node
/* ============================================================
   SCRAP CIRCUIT — vehicle turntable harness

   Puts each chassis alone on a neutral stage and shoots it from
   four angles (three-quarter front, side, rear three-quarter, low
   hero) so silhouette, proportion and panel detail can be judged
   without an arena behind them. Writes a per-vehicle strip plus a
   whole-roster contact sheet.

   Usage:
     node scripts/scrap-vehicle-shots.mjs
     node scripts/scrap-vehicle-shots.mjs --only towtruck,reaper
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) args[k] = true;
      else { args[k] = n; i += 1; }
    } else args._.push(t);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = path.resolve(root, args.out || "output/scrap-vehicles/latest");
const WIDTH = Number(args.width || 960);
const HEIGHT = Number(args.height || 540);
const PORT = Number(args.port || 44000 + (process.pid % 9000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE_URL}/games/scrap-circuit.html?qa=1`;
const ONLY = args.only ? String(args.only).split(",").map((s) => s.trim()) : null;

/* Angles are in metres around a chassis roughly 4.5 m long. */
const ANGLES = [
  { id: "front34", eye: [6.2, 3.2, 7.6], look: [0, 1.2, 0], fov: 36 },
  { id: "side", eye: [11.0, 2.0, 0.2], look: [0, 1.3, 0], fov: 32 },
  { id: "rear34", eye: [-6.0, 3.0, -7.8], look: [0, 1.2, 0], fov: 36 },
  { id: "hero", eye: [4.8, 1.0, 8.6], look: [0, 1.7, 0], fov: 40 },
];

function startServer() {
  const c = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE_URL}/games/scrap-circuit.html`); if (r.ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`Static server never came up on ${BASE_URL}`);
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const server = startServer();
  let browser = null;
  const pageErrors = [];
  const rows = [];

  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--force-device-scale-factor=1", "--mute-audio"],
    });
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto(GAME_URL, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__scrapQA, null, { timeout: 30000 });
    await delay(1400); // let the manifest textures land

    const roster = await page.evaluate(() => window.SCRAP.vehicles.list.map((v) => ({ id: v.id, name: v.name })));
    const list = ONLY ? roster.filter((v) => ONLY.includes(v.id)) : roster;

    for (const v of list) {
      await page.evaluate((id) => window.__scrapQA.vehicleStage(id), v.id);
      const files = [];
      for (const angle of ANGLES) {
        const dataUrl = await page.evaluate(
          ([eye, look, fov]) => window.__scrapQA.stagePose(eye, look, fov),
          [angle.eye, angle.look, angle.fov]
        );
        const file = path.join(OUT_DIR, `${v.id}-${angle.id}.png`);
        await writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
        files.push(file);
      }
      // Per-vehicle strip.
      const tw = 420, th = Math.round((HEIGHT / WIDTH) * 420);
      const tiles = await Promise.all(files.map(async (f, i) => ({
        input: await sharp(f).resize(tw, th).png().toBuffer(),
        left: i * tw, top: 0,
      })));
      const strip = path.join(OUT_DIR, `_${v.id}.png`);
      await sharp({ create: { width: tw * files.length, height: th, channels: 3, background: { r: 16, g: 17, b: 22 } } })
        .composite(tiles).png().toFile(strip);
      rows.push(strip);
      console.log(`${v.id.padEnd(11)} ${v.name}`);
    }

    // Roster sheet: one row per vehicle.
    if (rows.length) {
      const meta = await sharp(rows[0]).metadata();
      const tiles = await Promise.all(rows.map(async (f, i) => ({
        input: await sharp(f).resize(1200).png().toBuffer(),
        left: 0, top: i * Math.round((meta.height / meta.width) * 1200),
      })));
      await sharp({
        create: {
          width: 1200,
          height: rows.length * Math.round((meta.height / meta.width) * 1200),
          channels: 3, background: { r: 16, g: 17, b: 22 },
        },
      }).composite(tiles).png().toFile(path.join(OUT_DIR, "_roster.png"));
    }

    if (pageErrors.length) console.log(`\npage errors:\n  ${pageErrors.join("\n  ")}`);
    console.log(`\nWrote ${rows.length} vehicle strips to ${path.relative(root, OUT_DIR)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
