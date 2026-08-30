#!/usr/bin/env node
/* Climb probe: drive the hero INTO things and see whether it gets over them.
 *
 * The walk probe answers "can it move from here", which is not the question a
 * player asks when they run into a paving lip and stop. This one puts the
 * animal a short way from a known obstacle, drives it straight at the
 * obstacle, and reports how much height it gained and how far it got. A wall
 * shows up as height gain near zero with distance near zero.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const URL_ = `${BASE}/games/tardigrade-simulator.html?qa=1&quality=${process.env.Q || "ultra"}`;

const server = spawn("/opt/homebrew/bin/python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: root, stdio: ["ignore", "ignore", "ignore"],
});
for (let i = 0; i < 100; i += 1) {
  try { if ((await fetch(`${BASE}/games/tardigrade-simulator.html`)).ok) break; } catch (_) {}
  await delay(100);
}
const browser = await chromium.launch({
  channel: "chromium", headless: true,
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__TSIM && window.__TSIM.isReady(), null, { timeout: 90000 });

const rows = await page.evaluate(() => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const world = ctx.world;

  // Aim the camera along the travel direction so qaMove(0,-1) - "forward" -
  // maps to that world direction. Movement is camera-relative.
  // qaMove is CAMERA-relative, and releasing the camera lock hands control
  // back to the player - so calling lookAt and then clearing the lock (the
  // first version of this probe) throws the aim away and drives the hero in
  // whatever direction the game's camera happens to face. It measured a run
  // DOWNHILL as a blocked climb. Read the player's own camera yaw instead and
  // solve for the stick vector that produces the world direction we want.
  const run = (fromX, fromZ, dirX, dirZ, seconds) => {
    const len = Math.hypot(dirX, dirZ) || 1;
    const dx = dirX / len;
    const dz = dirZ / len;
    const y = world.heightAt(fromX, fromZ) + 2;
    T.teleportHero(fromX, y, fromZ);
    ctx.advanceTime(0.35);
    const camYaw = ctx.player.report().camYaw || 0;
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    const fX = -Math.sin(camYaw);
    const fZ = -Math.cos(camYaw);
    const rX = Math.cos(camYaw);
    const rZ = -Math.sin(camYaw);
    const mx = dx * rX + dz * rZ;        // component along right
    const my = -(dx * fX + dz * fZ);     // wish uses -move.y for forward
    const p0 = ctx.tardigrade.focusPoint();
    const start = { x: p0.x, y: p0.y, z: p0.z };
    ctx.input.qaMove(mx, my);
    ctx.advanceTime(seconds);
    ctx.input.qaMove(0, 0);
    const p1 = ctx.tardigrade.focusPoint();
    // Distance ALONG the requested direction, so wandering sideways does not
    // count as progress toward the obstacle.
    const along = (p1.x - start.x) * dx + (p1.z - start.z) * dz;
    return { dist: along, rise: p1.y - start.y };
  };

  // Drive at each landmark from a point just outside it.
  const targets = [
    ["bottle cap rim", -158, -166, 80],
    ["LEGO brick side", -271, 250, 92],
    ["screw shaft", -166, 148, 46],
    ["terracotta shard", 292, -232, 210],
    ["boulder stack", 8, -320, 84],
    ["hose coil", 306, 296, 190],
  ];
  const out = [];
  for (const [name, cx, cz, r] of targets) {
    // Approach from the sunlit side so the shot is legible if inspected.
    const ax = cx + r * 0.62;
    const az = cz + r * 0.78;
    const res = run(ax, az, cx - ax, cz - az, 2.6);
    out.push({ name, ...res });
  }

  // And a pure slope test: walk uphill on the steepest terrain we can find.
  let steep = null;
  for (let x = -420; x <= 420; x += 30) {
    for (let z = -420; z <= 420; z += 30) {
      const h = world.heightAt(x, z);
      const g = Math.max(
        Math.abs(world.heightAt(x + 8, z) - h),
        Math.abs(world.heightAt(x, z + 8) - h));
      if (!steep || g > steep.g) steep = { x, z, g, h };
    }
  }
  if (steep) {
    const up = world.heightAt(steep.x + 8, steep.z) > steep.h ? [1, 0] : [-1, 0];
    const res = run(steep.x, steep.z, up[0], up[1], 2.6);
    out.push({ name: `steepest slope (${steep.g.toFixed(1)}u drop per 8u)`, ...res });
  }
  return out;
});

console.log("=== CLIMB PROBE ===");
console.log("driving the hero straight at each obstacle for 2.6s\n");
console.log("obstacle                              travelled   height gained");
for (const r of rows) {
  const verdict = r.dist < 3 ? "  <- BLOCKED" : r.rise > 2 ? "  <- climbed" : "";
  console.log(`  ${r.name.padEnd(36)} ${r.dist.toFixed(1).padStart(6)}   ${r.rise.toFixed(1).padStart(8)}${verdict}`);
}

await browser.close();
server.kill("SIGTERM");
