#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Doctrine VFX proof sheet

   Fires every Doctrine cue signature through the production
   dispatcher and captures the same four moments of each one, so an
   Order's twenty-eight rites can be compared as PICTURES rather than
   as parameter lists. The strip is deliberately timed off frames, not
   wall clock: `renderOnce` steps the world deterministically, so the
   sheet is reproducible and immune to the headless rAF throttle.

   Usage:
     node scripts/saintfall-doctrine-vfx-sheet.mjs [--out output/path]
     node scripts/saintfall-doctrine-vfx-sheet.mjs --only censer
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((part) => part.trim().split(/\s+/)).map(([key, value]) => [key, value ?? true])
);
const outDir = path.resolve(root, args.out || "output/saintfall/doctrine-vfx");
const only = typeof args.only === "string" ? args.only : "";
const port = 51000 + (process.pid % 8000);
const base = `http://127.0.0.1:${port}`;

/* Frames after the cue at which each tile is taken. A cue that only
   exists on the first of these is a flashbulb, not an effect. */
const TAPS = [2, 9, 20, 38];
const SHOT_W = 480;
const SHOT_H = 300;

/** Every signature the dispatcher can draw, with the payload that
 *  reaches it from the real gameplay path. */
const CUES = [
  ["censer", "brand", { intensity: 0.55 }],
  ["censer", "brand-break", { intensity: 0.9 }],
  ["censer", "vent", { intensity: 0.8 }],
  ["censer", "heatless", { intensity: 0.6, stage: "consume" }],
  ["censer", "reprieve", { intensity: 0.75 }],
  ["censer", "martyr", { intensity: 1, capstone: true }],
  ["procession", "hook", { intensity: 0.6 }],
  ["procession", "toll", { intensity: 0.9 }],
  ["procession", "expose", { intensity: 0.7 }],
  ["procession", "mercy", { intensity: 0.7 }],
  ["procession", "litany", { intensity: 1, capstone: true, stage: "proc" }],
  ["wing", "conversion", { intensity: 0.7 }],
  ["wing", "feather", { intensity: 0.8, count: 3, stage: "consume" }],
  ["wing", "wake", { intensity: 0.6 }],
  ["wing", "ram", { intensity: 0.85, stage: "consume" }],
  ["wing", "circuit", { intensity: 1, capstone: true, stage: "complete" }],
  ["halo", "parry", { intensity: 0.8 }],
  ["halo", "wrath-store", { intensity: 0.5 }],
  ["halo", "reversal", { intensity: 0.8, stage: "consume" }],
  ["halo", "wrath-release", { intensity: 0.9 }],
  ["halo", "mercy", { intensity: 0.6 }],
  ["halo", "dome", { intensity: 0.8 }],
  ["halo", "seraph", { intensity: 1, capstone: true }],
  ["edict", "siren", { intensity: 0.8 }],
  ["edict", "fuse", { intensity: 0.7 }],
  ["edict", "recall", { intensity: 0.7 }],
  ["edict", "chapel", { intensity: 0.8 }],
  ["edict", "sigil", { intensity: 0.8 }],
  ["edict", "fusion", { intensity: 1, capstone: true }],
];

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const label = async (text, width, height = 22) => sharp({
  create: {
    width, height, channels: 4,
    background: { r: 8, g: 8, b: 10, alpha: 1 },
  },
}).composite([{
  input: Buffer.from(
    `<svg width="${width}" height="${height}">
       <text x="8" y="15" font-family="monospace" font-size="13"
             fill="#e8e2d6">${text}</text>
     </svg>`
  ),
  top: 0, left: 0,
}]).png().toBuffer();

try {
  await mkdir(outDir, { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: SHOT_W, height: SHOT_H } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&intro=skip`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  /* Stand somewhere REPRESENTATIVE. The first pass shot every rite on
     a fifty-degree dune face, where a ground seal drapes over fifteen
     metres of relief and every flat ring is edge on - so the sheet was
     measuring the terrain, not the effects. */
  const spot = await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.clearEnemies();
    T.invulnerable(true);
    const terr = T.terrain;
    let best = null;
    for (let sx = -80; sx <= 80; sx += 8) {
      for (let sz = 780; sz <= 900; sz += 8) {
        const h = terr.heightAt(sx, sz);
        let worst = 0;
        for (let a = 0; a < 8; a += 1) {
          const ang = (a / 8) * Math.PI * 2;
          worst = Math.max(worst, Math.abs(
            terr.heightAt(sx + Math.cos(ang) * 6, sz + Math.sin(ang) * 6) - h));
        }
        if (!best || worst < best.relief) best = { x: sx, z: sz, relief: worst };
      }
    }
    T._teleportRaw(best.x, best.z, 0);
    T.setBodyHeading(0);
    // Pitched down a little more than the default so the sheet shows
    // both the ground read and the standing one.
    T.setCam(0, -0.16, 8.2);
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
    return { x: best.x, z: best.z, relief: Number(best.relief.toFixed(2)) };
  });
  console.log(`standing at ${spot.x},${spot.z} (${spot.relief}m relief over 6m)`);

  const rows = [];
  for (const [order, kind, extra] of CUES) {
    if (only && order !== only) continue;
    const tiles = [];
    for (const tap of TAPS) {
      const shot = await page.evaluate(async ([o, k, e, frames]) => {
        const T = window.__SF;
        // Settle so the previous rite is fully gone from every pool.
        for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);
        const ps = T.player.state;
        T.vfx.doctrineCue({
          order: o, cue: k, x: ps.x, y: ps.y, z: ps.z, yaw: ps.yaw, ...e,
        });
        for (let i = 0; i < frames; i += 1) T.renderOnce(1 / 60);
        return T.captureDataURL();
      }, [order, kind, extra, tap]);
      tiles.push(Buffer.from(shot.split(",")[1], "base64"));
    }

    const strip = await sharp({
      create: {
        width: SHOT_W * TAPS.length, height: SHOT_H, channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    }).composite(tiles.map((input, i) => ({ input, left: SHOT_W * i, top: 0 })))
      .png().toBuffer();

    const head = await label(
      `${order} / ${kind}   —   frames ${TAPS.join(", ")} after the proc`,
      SHOT_W * TAPS.length);
    const row = await sharp({
      create: {
        width: SHOT_W * TAPS.length, height: SHOT_H + 22, channels: 4,
        background: { r: 8, g: 8, b: 10, alpha: 1 },
      },
    }).composite([{ input: head, top: 0, left: 0 },
      { input: strip, top: 22, left: 0 }]).png().toBuffer();

    await writeFile(path.join(outDir, `${order}-${kind}.png`), row);
    rows.push({ order, row });
    console.log(`captured  ${order}/${kind}`);
  }

  // One sheet per Order, so an Order's whole vocabulary is one image.
  const byOrder = new Map();
  for (const { order, row } of rows) {
    if (!byOrder.has(order)) byOrder.set(order, []);
    byOrder.get(order).push(row);
  }
  for (const [order, list] of byOrder) {
    const h = (SHOT_H + 22) * list.length;
    const sheet = await sharp({
      create: {
        width: SHOT_W * TAPS.length, height: h, channels: 4,
        background: { r: 8, g: 8, b: 10, alpha: 1 },
      },
    }).composite(list.map((input, i) => ({ input, top: (SHOT_H + 22) * i, left: 0 })))
      .png().toBuffer();
    await writeFile(path.join(outDir, `sheet-${order}.png`), sheet);
    console.log(`sheet     ${order} (${list.length} rites)`);
  }

  if (pageErrors.length) {
    console.log(`\nPAGE ERRORS:\n${pageErrors.join("\n")}`);
  }
  console.log(`\nwrote ${outDir}`);
  await browser.close();
} finally {
  server.kill();
}
