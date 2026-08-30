#!/usr/bin/env node
/* Movement probe: where can the tardigrade actually not go?
 *
 * Every earlier attempt at this measured a PROXY - is a collider present, is
 * a mesh drawn there - and each proxy disagreed with what a player feels.
 * This drives the real controller: teleport to a point, hold a movement
 * direction for a fixed time, and measure how far the animal actually got.
 * A direction it cannot move in is a wall, visible or not.
 *
 * Reports the fraction of (point, direction) pairs that are blocked, and the
 * worst offenders with the collider that stopped them.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const STEP = Number(process.env.STEP || 60);
const HOLD = Number(process.env.HOLD || 1.1);
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

const result = await page.evaluate(({ step, hold }) => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const world = ctx.world;
  const HALF = 450;

  const DIRS = [
    [0, -1], [0.71, -0.71], [1, 0], [0.71, 0.71],
    [0, 1], [-0.71, 0.71], [-1, 0], [-0.71, -0.71],
  ];

  const pos = () => {
    const p = ctx.tardigrade.focusPoint();
    return { x: p.x, z: p.z };
  };

  const blocked = [];
  const dists = [];
  let tried = 0;

  for (let x = -HALF + 40; x <= HALF - 40; x += step) {
    for (let z = -HALF + 40; z <= HALF - 40; z += step) {
      const y = world.heightAt(x, z) + 2;
      // qaMove is CAMERA-relative, so the world direction the hero takes is
      // not the vector passed in - profiling the ground along (mx, mz) was
      // therefore measuring the wrong bearing. What matters to a player is
      // simpler anyway: from here, can the animal get anywhere at all? Take
      // the best of all eight, and a point is stuck only if every one fails.
      let bestMove = 0;
      let bestKind = "none";
      for (const [mx, mz] of DIRS) {
        T.teleportHero(x, y, z);
        ctx.advanceTime(0.3);            // settle onto the ground
        const from = pos();
        ctx.input.qaMove(mx, mz);
        ctx.advanceTime(hold);
        ctx.input.qaMove(0, 0);
        const to = pos();
        const moved = Math.hypot(to.x - from.x, to.z - from.z);
        if (moved > bestMove) {
          bestMove = moved;
          try {
            const r = ctx.physics.raycast(
              { x: from.x, y: world.heightAt(from.x, from.z) + 0.9, z: from.z },
              { x: mx, y: 0, z: mz }, 6, { filter: 1 | (1 << 1) });
            bestKind = (r && r.hit !== false) ? ((r.record && r.record.kind) || "untagged") : "none";
          } catch (e) { bestKind = "?"; }
        }
        continue;
      }

      tried += 1;
      dists.push(bestMove);
      const h0 = world.heightAt(x, z);
      const prof = [];
      for (let d = 1; d <= 7; d += 1) prof.push(Number(world.heightAt(x + d, z).toFixed(1)));
      blocked.push({
        x, z, moved: Number(bestMove.toFixed(2)), kind: bestKind,
        h0: Number(h0.toFixed(1)), prof,
      });
    }
  }

  dists.sort((a, b) => a - b);
  const q = (f) => dists[Math.min(dists.length - 1, Math.floor(f * dists.length))];
  // "Blocked" = moved far less than the typical traverse. A quarter of the
  // median is a body being held, not a body walking.
  const cut = q(0.5) * 0.25;
  const real = blocked.filter((b) => b.moved < cut);
  const byKind = {};
  for (const b of real) byKind[b.kind] = (byKind[b.kind] || 0) + 1;


  return {
    tried,
    p05: Number(q(0.05).toFixed(2)),
    median: Number(q(0.5).toFixed(2)),
    p95: Number(q(0.95).toFixed(2)),
    cut: Number(cut.toFixed(2)),
    blocked: real.length,
    byKind,
    sample: real.sort((a, b) => a.moved - b.moved).slice(0, 12),
  };
}, { step: STEP, hold: HOLD });

console.log("=== WALK PROBE ===");
console.log(`points tried : ${result.tried}  (step ${STEP}, hold ${HOLD}s)`);
console.log(`distance moved: p05 ${result.p05}  median ${result.median}  p95 ${result.p95}`);
console.log(`blocked (< ${result.cut} units)        : ${result.blocked} (${((result.blocked / result.tried) * 100).toFixed(2)}%)`);
console.log("collider hit    :", JSON.stringify(result.byKind));
result.sample.forEach((b) => console.log(
  `   (${b.x}, ${b.z}) best move ${b.moved} [${b.kind}] h0=${b.h0} east ${b.prof.join(",")}`));

await browser.close();
server.kill("SIGTERM");
