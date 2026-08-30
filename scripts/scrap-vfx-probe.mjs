#!/usr/bin/env node
/* ============================================================
   SCRAP CIRCUIT — VFX probe

   Fires an effect on a stopped clock and steps only the effect
   pools, so each frame of an explosion can be captured exactly
   rather than hoping a screenshot lands on a good one. Writes a
   filmstrip per effect.

   Usage:
     node scripts/scrap-vfx-probe.mjs
     node scripts/scrap-vfx-probe.mjs --arena junkyard --kinds boom,muzzle
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
  const a = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2); const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) a[k] = true; else { a[k] = n; i += 1; }
    } else a._.push(t);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = path.resolve(root, args.out || "output/scrap-vfx/latest");
const WIDTH = Number(args.width || 1280);
const HEIGHT = Number(args.height || 720);
const ARENA = String(args.arena || "junkyard");
const PORT = Number(args.port || 45000 + (process.pid % 9000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const KINDS = args.kinds ? String(args.kinds).split(",") : ["boom", "muzzle", "trail"];

/* Frames sampled across each effect's life, in simulated seconds. */
const TIMELINE = [0.02, 0.08, 0.16, 0.26, 0.38, 0.52, 0.72, 1.0];

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
  throw new Error("server never came up");
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const server = startServer();
  let browser = null;
  const pageErrors = [];
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
    await page.goto(`${BASE_URL}/games/scrap-circuit.html?qa=1`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__scrapQA, null, { timeout: 30000 });
    await delay(1200);
    await page.evaluate((a) => { const qa = window.__scrapQA; qa.begin(a, "towtruck"); qa.hideHUD(true); }, ARENA);
    await page.evaluate(() => window.__scrapQA.step(1.5));

    for (const kind of KINDS) {
      const files = [];
      // Fresh effect each frame, stepped to the sample time — otherwise
      // the pools carry state between samples.
      for (const t of TIMELINE) {
        const dataUrl = await page.evaluate(([k, tt]) => {
          const qa = window.__scrapQA;
          qa.fxStep(4); // drain anything still alive
          qa.fx(k, 0, 2.2, 0, k === "boom" ? 8 : 4);
          qa.fxStep(tt);
          qa.pose([9, 4.2, 13], [0, 2.4, 0], 48);
          return qa.capture();
        }, [kind, t]);
        const file = path.join(OUT_DIR, `${kind}-${String(t).replace(".", "_")}.png`);
        await writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
        files.push(file);
      }
      const tw = 320, th = Math.round((HEIGHT / WIDTH) * 320);
      const tiles = await Promise.all(files.map(async (f, i) => ({
        input: await sharp(f).resize(tw, th).png().toBuffer(),
        left: (i % 4) * tw, top: Math.floor(i / 4) * th,
      })));
      await sharp({
        create: { width: 4 * tw, height: Math.ceil(files.length / 4) * th, channels: 3, background: { r: 10, g: 10, b: 14 } },
      }).composite(tiles).png().toFile(path.join(OUT_DIR, `_${kind}.png`));
      console.log(`${kind}: ${files.length} frames`);
    }

    if (pageErrors.length) console.log(`\npage errors:\n  ${pageErrors.join("\n  ")}`);
    console.log(`\nWrote to ${path.relative(root, OUT_DIR)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
