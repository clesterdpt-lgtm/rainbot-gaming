#!/usr/bin/env node
/* ============================================================
   INKBLOOD — sprite bounds check

   Every character is baked into a canvas sized from a hand-written
   extents box in sprites.js. Get that box wrong and the art is
   silently cropped — a sword tip, a horn, a club head just stops at
   the canvas edge and nothing errors.

   This bakes each figure across its whole animation cycle, reads the
   alpha channel, and reports any ink touching the border, plus how
   much dead margin is being wasted.

   Usage: node scripts/inkblood-artcheck.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8741;

async function ensureServer() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: "HEAD" });
    if (r.ok || r.status === 404) return null;
  } catch { /* start our own */ }
  const proc = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    await delay(120);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: "HEAD" });
      if (r.ok || r.status === 404) return proc;
    } catch { /* keep waiting */ }
  }
  throw new Error("server never came up");
}

const proc = await ensureServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(`http://127.0.0.1:${PORT}/tests/fixtures/inkblood-figure.html?who=hero&scale=1&game=0`,
  { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__BAKED, null, { timeout: 60000 });

const report = await page.evaluate(async () => {
  const mod = await import("/assets/js/inkblood/sprites.js");
  const names = ["hero", ...Object.keys(mod.CAST)];
  const out = [];

  for (const name of names) {
    const def = name === "hero" ? null : mod.CAST[name];
    const frames = def ? def.frames : 16;
    // Worst clipping across the cycle, but MINIMUM margin across the
    // cycle — trimming a box against one frame's slack would clip a
    // different frame where the limb swings further.
    let worst = null;
    const minMargin = { top: 1e9, bottom: 1e9, left: 1e9, right: 1e9 };

    for (let i = 0; i < frames; i++) {
      const heroSlash = name === "hero" && i >= 8;
      const frame = heroSlash ? i - 8 : i;
      const frameCount = name === "hero" ? 8 : frames;
      const f = mod.bakeFigure(name, {
        scale: 1,
        t: frame / frameCount,
        action: heroSlash ? "slash" : undefined,
      });
      const g = f.canvas.getContext("2d", { willReadFrequently: true });
      const { width: W, height: H } = f.canvas;
      const d = g.getImageData(0, 0, W, H).data;
      const A = (x, y) => d[(y * W + x) * 4 + 3];

      // How many opaque pixels sit on each border, and where the art
      // actually starts (to measure wasted margin).
      let top = 0; let bottom = 0; let left = 0; let right = 0;
      for (let x = 0; x < W; x++) { if (A(x, 0) > 12) top++; if (A(x, H - 1) > 12) bottom++; }
      for (let y = 0; y < H; y++) { if (A(0, y) > 12) left++; if (A(W - 1, y) > 12) right++; }

      let minX = W; let minY = H; let maxX = 0; let maxY = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (A(x, y) > 12) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const clipped = top + bottom + left + right;
      const rec = {
        frame: i, W, H, top, bottom, left, right, clipped,
        margin: {
          top: minY, bottom: H - 1 - maxY, left: minX, right: W - 1 - maxX,
        },
      };
      for (const k of ["top", "bottom", "left", "right"]) {
        if (rec.margin[k] < minMargin[k]) minMargin[k] = rec.margin[k];
      }
      if (!worst || rec.clipped > worst.clipped) worst = rec;
    }
    out.push({ name, ...worst, margin: minMargin });
  }
  return out;
});

console.log("figure           canvas      clipped px (t/b/l/r)      min margin (t/b/l/r)");
console.log("-".repeat(78));
let bad = 0;
for (const r of report) {
  const clip = `${r.top}/${r.bottom}/${r.left}/${r.right}`;
  const marg = `${r.margin.top}/${r.margin.bottom}/${r.margin.left}/${r.margin.right}`;
  const flag = r.clipped > 0 ? "  <-- CLIPPED" : "";
  if (r.clipped > 0) bad++;
  console.log(`${r.name.padEnd(16)} ${String(r.W + "x" + r.H).padEnd(11)} ${clip.padEnd(24)} ${marg}${flag}`);
}
console.log(`\n${bad} of ${report.length} figures are clipped by their bake box`);
if (errs.length) console.log("page errors:", errs);

await browser.close();
if (proc) proc.kill();
process.exit(bad ? 1 : 0);
