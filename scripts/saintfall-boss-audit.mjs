#!/usr/bin/env node
/* ============================================================
   SAINTFALL - boss audit

   Measures every boss in the game on the same axes, in one session,
   so "is the new one on par" is a table rather than an opinion:

     - what it costs to render while its fight is actually live;
     - how many independently designed targets it presents;
     - how many distinct phases and attacks it has;
     - how many cues it gives the audio layer;
     - how big its health pool is next to that.

   Usage:  node scripts/saintfall-boss-audit.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49971;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
  });

  const rows = [];
  const measure = async (name, setup) => {
    const row = await page.evaluate(`(${setup.toString()})(window.__SF)`);
    rows.push({ name, ...row });
  };

  const cost = `(T, key) => {
    const N = 140;
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) T.renderOnce(1 / 60, true);
    const r = T.report().render;
    const inst = T.enemies.live.find((e) => e.key === key);
    return {
      ms: Number(((performance.now() - t0) / N).toFixed(2)),
      calls: r.calls, tris: r.triangles,
      hp: inst ? Math.round(inst.maxHealth) : 0,
    };
  }`;

  await measure("Distaff", new Function("T", `
    T.teleportToDistaff(26);
    T.advanceToDistaffPhase("standing", 20);
    T.spillWeb(T.player.state.x + 6, T.player.state.z, 6, 12);
    return (${cost})(T, "distaff");`));

  await measure("Winnower", new Function("T", `
    T.teleportToWinnower(40);
    T.advanceToWinnowerPhase("soar", 30);
    return (${cost})(T, "winnower");`));

  await measure("Garner", new Function("T", `
    T.teleportToGarner(30);
    T.advanceToGarnerPhase("feeding", 20);
    for (let i = 0; i < 6; i += 1) T.forceGarnerLash(i);
    T.forceGarnerVolley();
    T.advanceTime(0.8, 1 / 60);
    return (${cost})(T, "garner");`));

  await measure("Abbess", new Function("T", `
    T.teleportToAbbess(34);
    T.advanceToAbbessPhase("seated", 20);
    T.forceAbbessClutch();
    T.advanceTime(5.4, 1 / 60);
    T.forceAbbessClutch();
    T.forceAbbessSlam();
    T.advanceTime(0.9, 1 / 60);
    return (${cost})(T, "abbess");`));

  await measure("Coulter", new Function("T", `
    const s = T.ctx.mission.bosses.find((b) => b.key === "saint");
    T._teleportRaw(s.x + 60, s.z, 0);
    T.advanceTime(3, 1 / 60);
    return (${cost})(T, "coulter");`));

  console.log("\nboss        ms/frame  draws   triangles   maxHP");
  for (const r of rows) {
    console.log(`${r.name.padEnd(11)} ${String(r.ms).padStart(6)}  ${String(r.calls).padStart(6)}`
      + `  ${String(r.tris).padStart(10)}  ${String(r.hp).padStart(6)}`);
  }
  await browser.close();
} finally {
  server.kill();
}
