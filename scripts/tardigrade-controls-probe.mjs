#!/usr/bin/env node
/* Control-scheme probe: does WASD do what the player expects?
 *
 * The asked-for scheme is camera-relative in the shooter sense:
 *   W  walk the way the camera is pointing
 *   S  BACKPEDAL - move away from the camera without turning round
 *   A  strafe left, D strafe right - again without turning
 *
 * The failure it replaces is subtle enough that reading the code does not
 * catch it: the body used to turn to face its own travel direction, so S
 * spun the animal 180 degrees and A/D swung it sideways. Movement was
 * already camera-relative; only the FACING was wrong. So this measures two
 * things per key and they must both hold - which way the body travelled,
 * and which way the body is pointing while it does.
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

const out = await page.evaluate(() => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const world = ctx.world;

  // A flat, open patch, so nothing the animal bumps into can be mistaken
  // for the control scheme misbehaving.
  let spot = null;
  for (let x = -300; x <= 300; x += 20) {
    for (let z = -300; z <= 300; z += 20) {
      const h = world.heightAt(x, z);
      let rough = 0;
      for (const [ox, oz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
        rough = Math.max(rough, Math.abs(world.heightAt(x + ox, z + oz) - h));
      }
      if (!spot || rough < spot.rough) spot = { x, z, h, rough };
    }
  }

  const KEYS = [
    ["W", 0, -1, "forward"],
    ["S", 0, 1, "back"],
    ["A", -1, 0, "left"],
    ["D", 1, 0, "right"],
  ];

  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const rows = [];
  let controller = "?";

  for (const [key, mx, my, want] of KEYS) {
    T.teleportHero(spot.x, spot.h + 2, spot.z);
    ctx.advanceTime(0.4);
    const r0 = ctx.player.report();
    controller = r0.controller;
    const camYaw = r0.camYaw;
    const fX = -Math.sin(camYaw);
    const fZ = -Math.cos(camYaw);
    const rX = Math.cos(camYaw);
    const rZ = -Math.sin(camYaw);

    const p0 = ctx.tardigrade.focusPoint();
    const s0 = { x: p0.x, z: p0.z };
    ctx.input.qaMove(mx, my);
    ctx.advanceTime(1.3);
    ctx.input.qaMove(0, 0);
    const p1 = ctx.tardigrade.focusPoint();
    const r1 = ctx.player.report();

    const dX = p1.x - s0.x;
    const dZ = p1.z - s0.z;
    const dist = Math.hypot(dX, dZ);
    // Travel resolved onto the camera's own axes.
    const alongF = dist > 0.01 ? (dX * fX + dZ * fZ) / dist : 0;
    const alongR = dist > 0.01 ? (dX * rX + dZ * rZ) / dist : 0;

    // The body should point along the CAMERA's forward the whole time,
    // whichever key is held. yaw's forward basis is (sin, cos).
    const wantYaw = Math.atan2(fX, fZ);
    const yawErr = Math.abs(norm(r1.yaw - wantYaw)) * 180 / Math.PI;

    rows.push({
      key, want, dist: Number(dist.toFixed(1)),
      alongF: Number(alongF.toFixed(2)),
      alongR: Number(alongR.toFixed(2)),
      yawErr: Number(yawErr.toFixed(1)),
    });
  }
  return { spot, controller, rows };
});

console.log("=== CONTROLS PROBE ===");
console.log(`flat test patch (${out.spot.x}, ${out.spot.z})   controller: ${out.controller}\n`);
console.log("key  intent    moved   along-fwd  along-right   body-vs-camera");
let bad = 0;
for (const r of out.rows) {
  // Which axis component should dominate, and with which sign.
  const want = { forward: ["alongF", 1], back: ["alongF", -1], left: ["alongR", -1], right: ["alongR", 1] }[r.want];
  const got = r[want[0]] * want[1];
  const moveOk = r.dist > 3 && got > 0.7;
  const faceOk = r.yawErr < 25;
  if (!moveOk || !faceOk) bad += 1;
  const notes = [moveOk ? "" : "WRONG DIRECTION", faceOk ? "" : `TURNED ${r.yawErr.toFixed(0)}deg`]
    .filter(Boolean).join(" + ");
  console.log(`  ${r.key}  ${r.want.padEnd(8)} ${String(r.dist).padStart(6)}  ${String(r.alongF).padStart(9)}  ${String(r.alongR).padStart(11)}   ${String(r.yawErr).padStart(5)}deg  ${notes}`);
}
console.log(`\n${bad === 0 ? "PASS - all four keys move and face as asked" : `FAIL - ${bad} key(s) wrong`}`);

await browser.close();
server.kill("SIGTERM");
