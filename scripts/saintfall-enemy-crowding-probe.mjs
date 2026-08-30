#!/usr/bin/env node
/* ============================================================
   SAINTFALL - enemy crowd collision probe

   Spawns an ordinary melee pack at one exact point, runs the shipped
   simulation, and verifies that the bodies separate, remain separated
   while pursuing, and never get pushed into world collision.

   Usage:
     node scripts/saintfall-enemy-crowding-probe.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 49700 + (process.pid % 10000);
const base = `http://127.0.0.1:${port}`;
const checks = [];

function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let browser;
try {
  for (let i = 0; i < 240; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=low&enemy-crowding=1`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });

  const result = await page.evaluate(() => {
    const T = window.__SF;
    const C = T.collide;
    const spawnX = 320;
    const spawnZ = -300;
    const targetX = 320;
    const targetZ = -326;
    T.clearEnemies();
    T._teleportRaw(targetX, targetZ, 0);
    T.ctx.combat.player.maxHp = 1e6;
    T.ctx.combat.player.hp = 1e6;

    /* Spawn directly through the enemy owner so all eight subjects exist at
       the same coordinate before the first simulation step. The public QA
       convenience method deliberately steps once after each spawn. */
    const subjects = [];
    for (let i = 0; i < 8; i += 1) {
      subjects.push(T.ctx.enemies.spawn("thresher", spawnX, spawnZ, {
        id: `crowd-probe-${i}`,
        eventId: "qa-probe",
        yaw: Math.PI,
      }));
    }

    const surfaceGap = () => {
      let minimum = Infinity;
      for (let i = 0; i < subjects.length - 1; i += 1) {
        for (let j = i + 1; j < subjects.length; j += 1) {
          const a = subjects[i];
          const b = subjects[j];
          const ar = a.spec.collisionRadius;
          const br = b.spec.collisionRadius;
          minimum = Math.min(minimum, Math.hypot(b.x - a.x, b.z - a.z) - ar - br);
        }
      }
      return minimum;
    };

    const initialGap = surfaceGap();
    let minimumSettledGap = Infinity;
    let enteredWorldCollision = false;
    for (let frame = 0; frame < 240; frame += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      if (frame < 120) continue;
      minimumSettledGap = Math.min(minimumSettledGap, surfaceGap());
      for (const enemy of subjects) {
        enteredWorldCollision ||= C.blocked(enemy.x, enemy.z,
          C.groundHeight(enemy.x, enemy.z), enemy.spec.collisionRadius);
      }
    }

    let spread = 0;
    for (let i = 0; i < subjects.length - 1; i += 1) {
      for (let j = i + 1; j < subjects.length; j += 1) {
        spread = Math.max(spread,
          Math.hypot(subjects[j].x - subjects[i].x, subjects[j].z - subjects[i].z));
      }
    }
    const centroid = subjects.reduce((sum, enemy) => ({
      x: sum.x + enemy.x / subjects.length,
      z: sum.z + enemy.z / subjects.length,
    }), { x: 0, z: 0 });
    const travel = Math.hypot(centroid.x - spawnX, centroid.z - spawnZ);
    return {
      count: subjects.length,
      initialGap,
      minimumSettledGap,
      finalGap: surfaceGap(),
      spread,
      travel,
      enteredWorldCollision,
      allLive: subjects.every((enemy) => T.ctx.enemies.live.includes(enemy)),
      positions: subjects.map((enemy) => ({
        x: Number(enemy.x.toFixed(3)),
        z: Number(enemy.z.toFixed(3)),
      })),
    };
  });

  console.log("\n=== ENEMY CROWD COLLISION ===");
  check("probe begins with eight fully stacked enemies",
    result.count === 8 && result.initialGap < -1.2,
    `${result.count} enemies, ${result.initialGap.toFixed(3)}m initial gap`);
  check("stacked pack separates to authored collision radii",
    result.finalGap >= -0.025,
    `${result.finalGap.toFixed(3)}m final surface gap`);
  check("moving pack remains separated after settling",
    result.minimumSettledGap >= -0.025,
    `${result.minimumSettledGap.toFixed(3)}m worst settled gap`);
  check("separation forms a readable pack instead of one point",
    result.spread >= 2.4,
    `${result.spread.toFixed(3)}m pack spread`);
  check("collision does not stop enemy pursuit",
    result.travel >= 4,
    `${result.travel.toFixed(3)}m centroid travel`);
  check("crowd correction never enters world collision",
    !result.enteredWorldCollision);
  check("all crowd subjects remain live", result.allLive);
  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  console.log(`\n${checks.filter((row) => row.pass).length}/${checks.length} checks passed`);
  if (checks.some((row) => !row.pass)) {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
