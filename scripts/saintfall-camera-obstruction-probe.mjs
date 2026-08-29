#!/usr/bin/env node
/* ============================================================
   SAINTFALL - third-person enemy obstruction probe

   Places a district-scale enemy inside the desired camera boom and
   proves the shipped player camera pulls in before entering its body,
   then eases back to the authored distance after the lane clears.
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 50700 + (process.pid % 10000);
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

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=low&camera-obstruction=1`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });

  const result = await page.evaluate(() => {
    const T = window.__SF;
    const ps = T.player.state;
    const camera = T.render.camera;
    const eye = () => ({ x: ps.x, y: ps.y + 1.62, z: ps.z });
    const distance = () => {
      const at = eye();
      return Math.hypot(camera.position.x - at.x,
        camera.position.y - at.y, camera.position.z - at.z);
    };

    T.clearEnemies();
    T._teleportRaw(300, 430, Math.PI);
    ps.camYaw = Math.PI;
    ps.camPitch = -0.10;
    T.advanceTime(1, 1 / 60);
    const openDistance = distance();

    /* Behind the player and inside the authored 5.2m boom, while leaving
       the eye itself outside the proxy. This is the exact geometry that
       formerly put the lens inside a boss abdomen. */
    const blocker = T.ctx.enemies.spawn("matriarch", ps.x, ps.z + 3.5, {
      id: "camera-obstruction-probe",
      yaw: Math.PI,
    });
    T.advanceTime(0.35, 1 / 60);
    const blockedDistance = distance();
    const blockedState = {
      obstructed: ps.cameraObstructed,
      reach: ps.cameraObstructionReach,
      blocker: ps.cameraBlocker,
    };
    const proxyRadius = blocker.spec.collisionRadius * 1.08 + 0.24;
    const lensClearance = Math.hypot(camera.position.x - blocker.x,
      camera.position.z - blocker.z) - proxyRadius;

    T.ctx.enemies.remove(blocker);
    T.advanceTime(1.25, 1 / 60);
    const recoveredDistance = distance();
    return {
      openDistance,
      blockedDistance,
      recoveredDistance,
      lensClearance,
      blockedState,
      recoveredObstructed: ps.cameraObstructed,
    };
  });

  console.log("\n=== ENEMY CAMERA OBSTRUCTION ===");
  check("open ground keeps the authored third-person boom",
    result.openDistance > 4.8, `${result.openDistance.toFixed(3)}m`);
  check("a giant enemy in the boom is detected",
    result.blockedState.obstructed
      && result.blockedState.blocker === "camera-obstruction-probe",
    JSON.stringify(result.blockedState));
  check("camera pulls in before entering the enemy body",
    result.blockedDistance < result.openDistance * 0.45 && result.lensClearance >= -0.06,
    `${result.blockedDistance.toFixed(3)}m boom, ${result.lensClearance.toFixed(3)}m clearance`);
  check("camera eases back after the lane clears",
    !result.recoveredObstructed && result.recoveredDistance > 4.75,
    `${result.recoveredDistance.toFixed(3)}m`);
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
