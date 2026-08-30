#!/usr/bin/env node
/* ============================================================
   INKBLOOD — frame-rate probe

   Headless Chromium throttles requestAnimationFrame to about 1fps,
   so measuring real frame cost has to happen in a headed browser
   where the compositor is actually running. This opens a window,
   drives the game into a deliberately heavy state (several hundred
   bodies, a full decal field, speed lines up), lets it run in real
   time, and reports the frame rate the loop actually achieved.

   Usage: node scripts/inkblood-perf.mjs [--seconds 6]
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const PORT = Number(arg("port", 8741));
const SECONDS = Number(arg("seconds", 6));

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
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(`http://127.0.0.1:${PORT}/games/inkblood.html`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__INK && window.__INK.ready, null, { timeout: 60000 });

// Build the heavy state. The player is invulnerable but carries NO
// weapons, so the horde survives and stays on screen for the whole
// measurement instead of being deleted in the first second.
await page.evaluate(() => {
  const ink = window.__INK;
  const game = ink.game;
  ink.newRun();
  ink.god(true);
  ink.sim(8);
  game.weapons.length = 0;
  for (const t of ["gaki", "kamaitachi", "mukade", "yurei", "tsukumo"]) ink.spawn(t, 64, 640);
  for (let i = 0; i < 150; i++) {
    game.fx.stain(
      game.player.x + (Math.random() - 0.5) * 1400,
      game.player.y + (Math.random() - 0.5) * 900,
      1.2,
    );
  }
  // Worst case also means a full pickup field and a live boss.
  for (let i = 0; i < 300; i++) {
    game.dropPickup("gem", game.player.x + (Math.random() - 0.5) * 1200,
      game.player.y + (Math.random() - 0.5) * 800, 1);
  }
  ink.boss("gashadokuro");
  game.fx.focusTarget = 0.5;
});

await delay(SECONDS * 1000);

const out = await page.evaluate(() => {
  const game = window.__INK.game;
  return {
    fps: Math.round(game.fps),
    enemies: game.enemies.length,
    decals: game.fx.decals.length,
    pickups: game.pickups.length,
    dpr: game.dpr,
    canvas: `${game.canvas.width}x${game.canvas.height}`,
  };
});

console.log(JSON.stringify({ ...out, errors: errs }, null, 2));
await browser.close();
if (proc) proc.kill();
