#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49955;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const findings = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) findings.push(label);
};

try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE}/games/saintfall.html`); if (r.ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

  const results = await page.evaluate(async () => {
    const T = window.__SF;
    const ctx = T.ctx;
    const player = ctx.player;
    const collide = ctx.collide;

    // 1. Initial baseline check
    const startPos = { x: player.state.x, y: player.state.y, z: player.state.z };
    const startYaw = player.state.yaw;

    // 2. Legal grounded movement must not be judged by the airborne
    // capsule. The shipped landing approach is walking-clear while its
    // terrain footprint is intentionally flight-blocked, which previously
    // reset speed and gait on the auto-recovery clock every 2.5 seconds.
    const legalGround = collide.groundHeight(startPos.x, startPos.z);
    const legalWalkingBlocked = collide.blocked(
      startPos.x, startPos.z, legalGround, collide.radius);
    const legalFlightBlocked = collide.flightBlocked(
      startPos.x, startPos.z, startPos.y, collide.radius, 2.0);
    player.input.inject(0, -1);
    let gaitResets = 0;
    let previousGait = player.state.gait;
    let lowestWarmSpeed = Infinity;
    for (let frame = 0; frame < 200; frame += 1) {
      player.update(0.016, ctx.camera);
      if (frame > 40) lowestWarmSpeed = Math.min(lowestWarmSpeed, player.state.speed);
      if (player.state.gait + 0.01 < previousGait) gaitResets += 1;
      previousGait = player.state.gait;
    }
    const legalPathEnd = {
      x: player.state.x,
      y: player.state.y,
      z: player.state.z,
      speed: player.state.speed,
      gait: player.state.gait,
    };
    player.input.inject(null);
    player.spawn(startPos.x, startPos.z, startYaw);

    // 3. Direct player.unstuck() invocation test
    const manualResult = player.unstuck?.("manual-test");
    const afterManualPos = { x: player.state.x, y: player.state.y, z: player.state.z, grounded: player.state.grounded };
    const manualBlocked = collide?.blocked?.(afterManualPos.x, afterManualPos.z, afterManualPos.y);

    // 4. Test Auto Unstuck when placed inside blocked geometry / obstacle
    // Place player at an obstructed pillar/wall location (e.g. Cathedral masonry pillar)
    // Find a solid cell to test:
    let testBlockedX = 0, testBlockedZ = 0;
    for (let r = 50; r < 500; r += 20) {
      for (let a = 0; a < Math.PI * 2; a += 0.5) {
        const cx = Math.cos(a) * r;
        const cz = Math.sin(a) * r;
        const gy = collide.groundHeight(cx, cz);
        if (collide.blocked(cx, cz, gy)) {
          testBlockedX = cx;
          testBlockedZ = cz;
          break;
        }
      }
      if (testBlockedX !== 0) break;
    }

    if (testBlockedX === 0) {
      testBlockedX = 100;
      testBlockedZ = 100;
    }

    // Force player into blocked state and simulate holding W key
    player.state.x = testBlockedX;
    player.state.z = testBlockedZ;
    player.state.y = collide.groundHeight(testBlockedX, testBlockedZ);
    player.input.inject(0, -1); // holding W forward

    const trappedStart = { x: player.state.x, y: player.state.y, z: player.state.z };

    // Simulate update frames across 3.2 seconds (200 frames at 16ms)
    for (let frame = 0; frame < 200; frame += 1) {
      player.update(0.016, ctx.camera);
    }
    player.input.inject(null);

    const afterAutoPos = { x: player.state.x, y: player.state.y, z: player.state.z, grounded: player.state.grounded };
    const autoBlocked = collide?.blocked?.(afterAutoPos.x, afterAutoPos.z, afterAutoPos.y);
    const movedFromTrapped = Math.hypot(afterAutoPos.x - trappedStart.x, afterAutoPos.z - trappedStart.z);

    // 5. Test airborne / roof hover stall auto unstuck
    // Place player in airborne ungroundable state without jetpack
    player.state.grounded = false;
    player.state.y = collide.groundHeight(afterAutoPos.x, afterAutoPos.z) + 6.0;
    player.state.vy = 0;
    ctx.jetpack?.reset?.(true);

    for (let frame = 0; frame < 200; frame += 1) {
      player.update(0.016, ctx.camera);
    }

    const afterRoofPos = { x: player.state.x, y: player.state.y, z: player.state.z, grounded: player.state.grounded };
    const roofBlocked = collide?.blocked?.(afterRoofPos.x, afterRoofPos.z, afterRoofPos.y);

    return {
      startPos,
      legalWalkingBlocked,
      legalFlightBlocked,
      gaitResets,
      lowestWarmSpeed,
      legalPathEnd,
      manualResult,
      afterManualPos,
      manualBlocked,
      trappedStart,
      afterAutoPos,
      autoBlocked,
      movedFromTrapped,
      afterRoofPos,
      roofBlocked,
    };
  });

  console.log("\n=== SAINTFALL UNSTUCK SYSTEM CHECKS ===");
  check(!results.legalWalkingBlocked && results.legalFlightBlocked,
    "Landing approach reproduces grounded-clear / flight-blocked collision split",
    `walkingBlocked=${results.legalWalkingBlocked} flightBlocked=${results.legalFlightBlocked}`);
  check(results.gaitResets === 0 && results.lowestWarmSpeed > 4,
    "Legal grounded movement never triggers the 2.5s recovery reset",
    `gaitResets=${results.gaitResets} lowestWarmSpeed=${results.lowestWarmSpeed.toFixed(2)} end=${JSON.stringify(results.legalPathEnd)}`);
  check(results.manualResult && Number.isFinite(results.manualResult.x), "player.unstuck() function exists and executes", `result=${JSON.stringify(results.manualResult)}`);
  check(results.afterManualPos.grounded === true, "Player is grounded after unstuck", `grounded=${results.afterManualPos.grounded}`);
  check(!results.manualBlocked, "Player is not inside collision geometry after unstuck", `blocked=${results.manualBlocked}`);

  check(results.movedFromTrapped > 0.05 && !results.autoBlocked, "Auto-recovery cleared obstacle penetration", `moved=${results.movedFromTrapped.toFixed(2)}m blocked=${results.autoBlocked}`);
  check(results.afterAutoPos.grounded === true, "Player is grounded after auto-recovery", `grounded=${results.afterAutoPos.grounded}`);
  check(!results.autoBlocked, "Auto-recovered position is not blocked by collision", `blocked=${results.autoBlocked}`);

  check(results.afterRoofPos.grounded === true, "Airborne / roof stall auto-recovers to grounded terrain", `grounded=${results.afterRoofPos.grounded}`);
  check(!results.roofBlocked, "Roof recovery location is legal open ground", `blocked=${results.roofBlocked}`);

  check(pageErrors.length === 0, "Zero page errors during unstuck operations", pageErrors.join("; "));

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (findings.length > 0) {
  console.error(`\nFAILED: ${findings.length} check(s)`);
  process.exit(1);
} else {
  console.log("\nALL UNSTUCK CHECKS PASSED!");
  process.exit(0);
}
