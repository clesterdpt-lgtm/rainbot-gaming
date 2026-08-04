#!/usr/bin/env node
/* Can the animal actually climb grass and leaves?
 *
 * Drives the hero into dense foliage and measures height gained, how long
 * it spends in contact with a blade, and whether the climb assist ever
 * arms. Grass capsules are deliberately thin (radius ~1.16) and the hero
 * capsule is only 0.64 across, so one plausible failure is that the animal
 * simply slips BETWEEN blades and never gets a purchase to climb.
 *
 * Reports contact frames alongside height gained so "never touched it" is
 * distinguished from "touched it and slid off".
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
for (let i = 0; i < 200; i += 1) {
  try { if ((await fetch(`${BASE}/games/tardigrade-simulator.html`)).ok) break; } catch (_) {}
  await delay(100);
}

const browser = await chromium.launch({
  channel: "chromium", headless: true,
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  [page error]", m.text()); });
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__TSIM && window.__TSIM.isReady(), null, { timeout: 120000 });

const out = await page.evaluate(() => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const DT = 1 / 60;

  // Find dense grass: sample the physics for foliage colliders and keep the
  // spots with the most blades within reach.
  const spots = [];
  for (let x = -400; x <= 400; x += 40) {
    for (let z = -400; z <= 400; z += 40) {
      let hits = 0;
      for (const d of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7, 0.7], [-0.7, -0.7]]) {
        try {
          const y = ctx.world.heightAt(x, z) + 0.8;
          const r = ctx.physics.raycast({ x, y, z }, { x: d[0], y: 0, z: d[1] }, 26, { filter: 1 | (1 << 1) });
          if (r && r.hit && r.record && r.record.kind === "foliage") hits += 1;
        } catch (e) { /* ignore */ }
      }
      if (hits >= 3) spots.push({ x, z, hits });
    }
  }
  spots.sort((a, b) => b.hits - a.hits);
  const use = spots.slice(0, 14);

  const runs = [];
  for (const s of use) {
    for (const deg of [0, 90, 180, 270]) {
      T.input.stopMove();
      T.teleportHero(s.x, ctx.world.heightAt(s.x, s.z) + 1.2, s.z);
      ctx.advanceTime(0.6);
      const want = (deg * Math.PI) / 180;
      T.input.look((want - ctx.player.report().camYaw) * 220, 0);
      ctx.advanceTime(0.25);

      const start = ctx.player.report();
      const baseY = start.position.y;
      T.input.move(0, 1);
      let climbFrames = 0, maxY = baseY, groundedFrames = 0;
      const frames = Math.round(5 / DT);
      for (let i = 0; i < frames; i += 1) {
        ctx.advanceTime(DT);
        const r = ctx.player.report();
        if (r.climb > 0) climbFrames += 1;
        if (r.grounded) groundedFrames += 1;
        if (r.position.y > maxY) maxY = r.position.y;
      }
      T.input.stopMove();
      ctx.advanceTime(0.4);
      const end = ctx.player.report();
      // Height gained relative to the GROUND under wherever it ended up, so
      // walking up a terrain slope does not count as climbing grass.
      const groundEnd = ctx.world.heightAt(end.position.x, end.position.z);
      runs.push({
        x: s.x, z: s.z, deg,
        peak: maxY - baseY,
        held: end.position.y - groundEnd,
        climb: climbFrames / frames,
      });
    }
  }

  const mean = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
  const climbed = runs.filter((r) => r.peak > 3).length;
  const heldUp = runs.filter((r) => r.held > 3).length;
  return {
    spotsFound: spots.length,
    runs: runs.length,
    meanPeak: mean("peak"),
    meanHeld: mean("held"),
    meanClimb: mean("climb"),
    climbedPct: (climbed / runs.length) * 100,
    heldPct: (heldUp / runs.length) * 100,
    sample: runs.slice(0, 12).map((r) => ({ ...r, peak: Number(r.peak.toFixed(1)), held: Number(r.held.toFixed(1)), climb: Number(r.climb.toFixed(2)) })),
  };
});

console.log("=== FOLIAGE CLIMB PROBE ===");
console.log(`${out.spotsFound} dense-grass spots found; ${out.runs} runs of 5s each\n`);
console.log(`  mean peak height gained : ${out.meanPeak.toFixed(2)} units`);
console.log(`  mean height held at end : ${out.meanHeld.toFixed(2)} units above the ground`);
console.log(`  climb assist armed      : ${(out.meanClimb * 100).toFixed(0)}% of frames`);
console.log(`  runs that got >3 units up : ${out.climbedPct.toFixed(0)}%   still up there at the end: ${out.heldPct.toFixed(0)}%\n`);
console.log("     x     z   dir   peak   held   climb");
for (const r of out.sample) {
  console.log(`  ${String(r.x).padStart(4)} ${String(r.z).padStart(5)}  ${String(r.deg).padStart(4)}  ${String(r.peak).padStart(5)}  ${String(r.held).padStart(5)}   ${r.climb}`);
}

await browser.close();
server.kill("SIGTERM");
