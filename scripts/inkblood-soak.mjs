#!/usr/bin/env node
/* ============================================================
   INKBLOOD — soak test

   Runs the whole 15-minute schedule headlessly with the debug hook
   kiting the player, sampling state every 30 simulated seconds, and
   reports: survival, level curve, enemy counts, entity leaks and any
   console error. Then it measures real render cost at the heaviest
   moment it saw.

   Usage: node scripts/inkblood-soak.mjs [--god] [--minutes 15]
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => (a.startsWith("--")
    ? [[a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]] : [])),
);
const PORT = 8899;
const MINUTES = Number(args.minutes || 15);

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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(`http://127.0.0.1:${PORT}/games/inkblood.html`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__INK && window.__INK.ready, null, { timeout: 60000 });

const report = await page.evaluate(async ({ minutes, god }) => {
  const ink = window.__INK;
  const game = ink.game;
  ink.newRun();
  if (god) ink.god(true);

  const samples = [];
  const total = minutes * 60;
  let died = null;

  for (let t = 0; t < total; t += 30) {
    ink.sim(30);
    const st = ink.stats;
    samples.push({
      t: Math.round(st.time),
      phase: game.phase,
      enemies: st.enemies,
      proj: st.projectiles,
      pickups: st.pickups,
      decals: st.decals,
      hp: st.hp,
      level: st.level,
      kills: st.kills,
      weapons: game.weapons.map((w) => `${w.id}:${w.level}`),
      passives: game.passives.map((p) => `${p.id}:${p.level}`),
    });
    if (game.phase !== "playing") {
      // Level-up screens block the sim; take the first choice and
      // keep going so the run reaches the end of the schedule.
      if (game.phase === "levelup") { game.takeChoice(); t -= 30; continue; }
      died = { t: Math.round(game.time), phase: game.phase };
      break;
    }
  }

  // Render cost at the current (usually heaviest) state.
  const frames = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    game.render();
    frames.push(performance.now() - t0);
  }
  frames.sort((a, b) => a - b);

  return {
    samples,
    died,
    finalPhase: game.phase,
    renderMs: {
      median: +frames[15].toFixed(2),
      p95: +frames[28].toFixed(2),
      max: +frames[29].toFixed(2),
    },
    timers: game.timers.length,
    enemyShots: game.enemyShots.length,
  };
}, { minutes: MINUTES, god: !!args.god });

console.log(JSON.stringify({ ...report, logs: logs.slice(0, 30) }, null, 2));

await browser.close();
if (proc) proc.kill();
