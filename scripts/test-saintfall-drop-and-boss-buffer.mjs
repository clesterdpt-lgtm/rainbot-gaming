#!/usr/bin/env node
/* ============================================================
   Verification Script:
   1. Drop ship safe buffer: No enemies immediately aggro at landfall / drop site.
   2. Wandering engagement: Enemies aggro when wandering away down the causeway.
   3. Boss defeat 1-minute buffer: 60s cooldown enforced on breach waves after boss kill.
   ============================================================ */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 49000 + (process.pid % 4000);

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".avif": "image/avif",
  ".webp": "image/webp",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let filePath = path.join(root, urlPath === "/" ? "index.html" : urlPath);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  if (fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime, "Access-Control-Allow-Origin": "*" });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1120, height: 700 } })).newPage();

  page.on("pageerror", (e) => console.error("Page error:", e.message));

  await page.goto(`http://127.0.0.1:${port}/games/saintfall.html?qa=1&quality=high`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 120000 });

  // 1. Test Drop Site Clearance & Landfall Aggro
  const landfallState = await page.evaluate(() => {
    const T = window.__SF;
    T.hideHud(true);
    T.setTime("golden");

    // Advance 1 second at spawn
    T.advanceTime(1);

    const ps = T.playerState();
    const liveEnemies = T.ctx.enemies.live;
    const podPos = { x: -1.0, z: 876.0 };

    // Check enemies in drop area (within 60m of pod)
    const inDropArea = liveEnemies.filter((e) => {
      const d = Math.hypot(e.x - podPos.x, e.z - podPos.z);
      return d < 60;
    });

    // Check alerted enemies
    const alertedAtSpawn = liveEnemies.filter((e) => e.alerted || (e.suspicion || 0) > 0.1);

    return {
      playerPos: { x: ps.x, z: ps.z },
      inDropAreaCount: inDropArea.length,
      alertedCount: alertedAtSpawn.length,
      totalLiveEnemies: liveEnemies.length,
    };
  });

  check(
    "No enemies spawned immediately in drop ship area",
    landfallState.inDropAreaCount === 0,
    `enemies within 60m of pod: ${landfallState.inDropAreaCount}`
  );

  check(
    "No enemies immediately aggro at drop sequence / landfall",
    landfallState.alertedCount === 0,
    `alerted enemies at spawn: ${landfallState.alertedCount}`
  );

  // 2. Test Wandering Away Engagement
  const wanderState = await page.evaluate(() => {
    const T = window.__SF;
    // Walk down the causeway towards cathedral (z = 790)
    T.teleport(16, 790, 0);

    // Step simulation for 2 seconds
    T.advanceTime(2);

    const liveEnemies = T.ctx.enemies.live;
    const alertedAfterWander = liveEnemies.filter((e) => e.alerted || (e.suspicion || 0) > 0.1);

    return {
      alertedAfterWanderCount: alertedAfterWander.length,
      alertedKeys: alertedAfterWander.map((e) => e.key),
    };
  });

  check(
    "Enemies aggro closely after wandering away from drop ship",
    wanderState.alertedAfterWanderCount > 0,
    `alerted enemies after walking down causeway: ${wanderState.alertedAfterWanderCount} (${wanderState.alertedKeys.join(", ")})`
  );

  // 3. Test Post-Boss 1-Minute Wave Cooldown Buffer
  const bossBufferState = await page.evaluate(() => {
    const T = window.__SF;
    T.setBreachAuto(true);
    // Keep player alive at safe distance
    T.teleport(-1, 876, 0);
    T.ctx.combat.player.health = 999999;
    T.ctx.combat.player.dead = false;

    const breaches = T.ctx.breaches;

    // Reset breach timer to 0 so wave would normally trigger immediately
    breaches.state.timer = 0;
    breaches.state.phase = "dormant";

    // Defeat a district boss (e.g. Winnower)
    const winnowerInst = T.ctx.enemies.live.find((e) => e.key === "winnower");
    if (winnowerInst) {
      winnowerInst.health = 0;
      winnowerInst.state = "death";
    }
    breaches.notifyBossDefeated("censer");

    const timerImmediatelyAfterDefeat = breaches.state.timer;

    // Advance 30 seconds of game simulation
    T.advanceTime(30);

    const phaseAt30s = breaches.state.phase;
    const timerAt30s = breaches.state.timer;

    // Advance another 35 seconds (total 65s > 60s buffer)
    T.advanceTime(35);

    const phasePast60s = breaches.state.phase;
    const timerPast60s = breaches.state.timer;

    return {
      timerImmediatelyAfterDefeat,
      timerAt30s,
      phaseAt30s,
      phasePast60s,
      timerPast60s,
    };
  });

  check(
    "Boss defeat sets wave cooldown to at least 60 seconds",
    bossBufferState.timerImmediatelyAfterDefeat >= 60,
    `timer immediately after boss defeat: ${bossBufferState.timerImmediatelyAfterDefeat}s`
  );

  check(
    "Waves do not spawn during 1-minute buffer (at 30s)",
    bossBufferState.phaseAt30s === "dormant" && bossBufferState.timerAt30s > 25,
    `phase at 30s: ${bossBufferState.phaseAt30s}, timer at 30s: ${bossBufferState.timerAt30s.toFixed(1)}s`
  );

  check(
    "Wave progression triggers after 60-second buffer expires",
    bossBufferState.phasePast60s === "warning" || bossBufferState.phasePast60s === "active",
    `phase past 60s: ${bossBufferState.phasePast60s}`
  );

  await browser.close();
} catch (err) {
  console.error("Test failed with error:", err);
  process.exit(1);
} finally {
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nResults: ${results.length - failed}/${results.length} passed.`);
if (failed > 0) process.exit(1);
