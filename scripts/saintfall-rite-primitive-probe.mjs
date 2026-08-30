#!/usr/bin/env node
/* ============================================================
   SAINTFALL - rite primitive isolation

   Draws ONE new primitive at a time, alone, at three sizes, so a
   defect can be attributed to the shaft, the shell or the sigil
   instead of to whichever rite happened to fire them together.

   Usage:
     node scripts/saintfall-rite-primitive-probe.mjs [--out path]
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
const outDir = path.resolve(root, args.out || "output/saintfall/rite-primitives");
const port = 52000 + (process.pid % 7000);
const base = `http://127.0.0.1:${port}`;
const W = 520;
const H = 340;

/* name, the call, and the frame each tile is taken at. */
const CASES = [
  ["sigil-small", "sigil", 2.5],
  ["sigil-mid", "sigil", 5],
  ["sigil-large", "sigil", 9],
  ["shell-small", "shell", 2.5],
  ["shell-mid", "shell", 4.5],
  ["shell-large", "shell", 7.5],
  ["shaft-thin", "shaft", 0.42],
  ["shaft-mid", "shaft", 0.9],
  ["shaft-wide", "shaft", 1.6],
];
const TAPS = [4, 14, 30];

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const label = async (text, width, height = 20) => sharp({
  create: { width, height, channels: 4, background: { r: 8, g: 8, b: 10, alpha: 1 } },
}).composite([{
  input: Buffer.from(`<svg width="${width}" height="${height}">
    <text x="8" y="14" font-family="monospace" font-size="12"
          fill="#e8e2d6">${text}</text></svg>`),
  top: 0, left: 0,
}]).png().toBuffer();

try {
  await mkdir(outDir, { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&intro=skip`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.clearEnemies();
    T.invulnerable(true);
    T._teleportRaw(-12, 830, 0);
    T.setBodyHeading(0);
    T.setCam(0, -0.10, 9.0);
    for (let i = 0; i < 20; i += 1) T.renderOnce(1 / 60);
  });

  const rows = [];
  for (const [name, kind, size] of CASES) {
    const tiles = [];
    for (const tap of TAPS) {
      const shot = await page.evaluate(async ([k, s, frames]) => {
        const T = window.__SF;
        for (let i = 0; i < 150; i += 1) T.renderOnce(1 / 60);
        const ps = T.player.state;
        const v = T.vfx;
        // Reach past the dispatcher: these are the primitives alone.
        if (k === "sigil") v.riteProbe.sigil(ps.x, ps.z, s);
        if (k === "shell") v.riteProbe.shell(ps.x, ps.z, s);
        if (k === "shaft") v.riteProbe.shaft(ps.x, ps.z, s);
        for (let i = 0; i < frames; i += 1) T.renderOnce(1 / 60);
        return T.captureDataURL();
      }, [kind, size, tap]);
      tiles.push(Buffer.from(shot.split(",")[1], "base64"));
    }
    const strip = await sharp({
      create: { width: W * TAPS.length, height: H, channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).composite(tiles.map((input, i) => ({ input, left: W * i, top: 0 })))
      .png().toBuffer();
    const head = await label(`${name}  (size ${size})  —  frames ${TAPS.join(", ")}`,
      W * TAPS.length);
    rows.push(await sharp({
      create: { width: W * TAPS.length, height: H + 20, channels: 4,
        background: { r: 8, g: 8, b: 10, alpha: 1 } },
    }).composite([{ input: head, top: 0, left: 0 },
      { input: strip, top: 20, left: 0 }]).png().toBuffer());
    console.log(`captured  ${name}`);
  }

  await writeFile(path.join(outDir, "primitives.png"), await sharp({
    create: { width: W * TAPS.length, height: (H + 20) * rows.length, channels: 4,
      background: { r: 8, g: 8, b: 10, alpha: 1 } },
  }).composite(rows.map((input, i) => ({ input, top: (H + 20) * i, left: 0 })))
    .png().toBuffer());

  if (pageErrors.length) console.log(`\nPAGE ERRORS:\n${pageErrors.join("\n")}`);
  console.log(`\nwrote ${outDir}/primitives.png`);
  await browser.close();
} finally {
  server.kill();
}
