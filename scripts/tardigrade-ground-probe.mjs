#!/usr/bin/env node
/* Ground collision probe.
 *
 * Walks a grid over the whole map and, at each point, compares three things:
 *
 *   visual   - world.heightAt(x, z), which reads the same triangle the
 *              renderer draws
 *   physics  - a downward raycast from high above, i.e. what the player
 *              controller will actually stand on
 *   drop     - a capsule dropped from above and simulated, which is the
 *              only test that catches a collider the ray hits but that a
 *              moving body tunnels straight through
 *
 * A hole in the floor shows up as a missing physics hit, and a mismatched
 * floor shows up as a large |physics - visual|. Both make the hero fall
 * through the world, but they have completely different causes, so the
 * probe reports them separately.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const STEP = Number(process.env.STEP || 24);
const DROP = Number(process.env.DROP || 110);
const URL_ = `${BASE}/games/tardigrade-simulator.html?qa=1&quality=${process.env.Q || "ultra"}`;

const server = spawn("/opt/homebrew/bin/python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: root, stdio: ["ignore", "ignore", "ignore"],
});

async function waitForServer() {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${BASE}/games/tardigrade-simulator.html`)).ok) return; } catch (_) {}
    await delay(100);
  }
  throw new Error("server never started");
}

await waitForServer();
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.stack || e.message));

await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__TSIM && window.__TSIM.isReady(), null, { timeout: 90000 });

const result = await page.evaluate(({ step, drop }) => {
  const ctx = window.__TSIM.ctx;
  const world = ctx.world;
  const phys = ctx.physics;
  // world.bounds.min/max are ARRAYS ([x, z]), not Vector3s.
  const bounds = world.bounds || {};
  const rd = (v, i, dflt) => (Array.isArray(v) ? v[i] : v && typeof v === "object" ? (i === 0 ? v.x : v.z) : dflt);
  const minX = rd(bounds.min, 0, -450);
  const maxX = rd(bounds.max, 0, 450);
  const minZ = rd(bounds.min, 1, -450);
  const maxZ = rd(bounds.max, 1, 450);

  // Start the ray just ABOVE the surface the renderer draws, not at the
  // skyline. A ray from 1200 units up reports the highest collider at that
  // column, so it lands on the plant pot's rim and calls a 260 unit
  // difference a "mismatch" when the ground underneath is perfectly fine.
  // The question that matters is narrower: standing where the renderer says
  // there is ground, is there a collider there.
  const START_ABOVE = 6;
  const REACH = 90;
  const shoot = (x, z, fromY) => {
    // Exclude the player capsule: it sits at the spawn point and otherwise
    // answers the spawn probe with "you are standing on yourself".
    const r = phys.raycast({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }, REACH, {
      filter: 1 | (1 << 1), // TERRAIN | STATIC_PROP
    });
    if (!r || r.hit === false || !r.point) return null;
    return { y: r.point.y, kind: (r.record && r.record.kind) || (r.collider ? "terrain?" : null) };
  };

  const samples = [];
  const kinds = {};
  let miss = 0;
  let big = 0;
  const deltas = [];

  for (let x = minX; x <= maxX; x += step) {
    for (let z = minZ; z <= maxZ; z += step) {
      const visual = world.heightAt(x, z);
      let r = null;
      try { r = shoot(x, z, visual + START_ABOVE); } catch (e) { /* reported via miss */ }

      if (r === null) { miss += 1; samples.push({ x, z, visual, phys: null, d: null, kind: null }); continue; }
      const physY = r.y;
      kinds[r.kind || "null"] = (kinds[r.kind || "null"] || 0) + 1;
      const d = physY - visual;
      deltas.push(d);
      if (Math.abs(d) > 1.0) big += 1;
      samples.push({ x, z, visual, phys: physY, d, kind: r.kind });
    }
  }

  deltas.sort((a, b) => a - b);
  const q = (p) => (deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))] : null);

  // Worst offenders, so the report points at coordinates worth looking at.
  const worst = samples
    .filter((s) => s.d !== null)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 12);
  const holes = samples.filter((s) => s.phys === null).slice(0, 20);
  // Landing on the fallback slab means the terrain collider was not there.
  const onFallback = samples.filter((s) => s.kind === "fallback-ground");

  const spawn = world.spawnPoint ? world.spawnPoint() : null;
  let spawnInfo = null;
  if (spawn) {
    const visual = world.heightAt(spawn.x, spawn.z);
    const r = shoot(spawn.x, spawn.z, visual + START_ABOVE);
    spawnInfo = { x: spawn.x, y: spawn.y, z: spawn.z, visual, phys: r ? r.y : null, on: r ? r.kind : null };
  }

  // ---- Drop test ----
  // The raycast proves a collider exists. It does not prove a moving body
  // stays on top of it: a character controller can still tunnel, snap to
  // the wrong surface, or be pushed under by a penetrating collider. So
  // teleport the hero across the map, let the sim run, and check where he
  // actually ends up relative to the surface the renderer draws.
  const drops = [];
  if (ctx.player && typeof ctx.player.teleport === "function" && ctx.tardigrade) {
    const grid = [];
    for (let x = minX + 20; x <= maxX - 20; x += drop) {
      for (let z = minZ + 20; z <= maxZ - 20; z += drop) grid.push([x, z]);
    }
    for (const [x, z] of grid) {
      const visual = world.heightAt(x, z);
      ctx.player.teleport(x, visual + 3, z);
      ctx.advanceTime(2.6);
      const p = ctx.tardigrade.focusPoint ? ctx.tardigrade.focusPoint() : null;
      if (!p) continue;
      const restVisual = world.heightAt(p.x, p.z);
      drops.push({
        x, z,
        px: p.x, pz: p.z,
        y: p.y,
        surface: restVisual,
        below: restVisual - p.y,   // positive == hero is UNDER the ground
        drift: Math.hypot(p.x - x, p.z - z),
      });
    }
  }

  return {
    total: samples.length,
    drops,
    miss,
    big,
    median: q(0.5),
    p02: q(0.02),
    p98: q(0.98),
    min: deltas[0] ?? null,
    max: deltas[deltas.length - 1] ?? null,
    worst,
    holes,
    spawnInfo,
    kinds,
    onFallback: onFallback.length,
    fallbackSample: onFallback.slice(0, 12),
    extent: { minX, maxX, minZ, maxZ },
    physicsReport: typeof phys.report === "function" ? phys.report() : null,
    worldReport: typeof world.report === "function" ? world.report() : null,
  };
}, { step: STEP, drop: DROP });

const pct = (n) => `${((n / result.total) * 100).toFixed(2)}%`;
console.log("=== GROUND PROBE ===");
console.log(`samples ${result.total} (step ${STEP})`);
console.log(`no physics hit at all : ${result.miss} (${pct(result.miss)})   <- holes in the floor`);
console.log(`|phys-visual| > 1.0   : ${result.big} (${pct(result.big)})   <- mismatched floor`);
console.log(`delta  min ${result.min?.toFixed(2)}  p02 ${result.p02?.toFixed(2)}  median ${result.median?.toFixed(2)}  p98 ${result.p98?.toFixed(2)}  max ${result.max?.toFixed(2)}`);
console.log("\nspawn:", JSON.stringify(result.spawnInfo));
console.log("\nworst mismatches:");
result.worst.forEach((w) => console.log(`  (${w.x}, ${w.z})  visual ${w.visual.toFixed(2)}  phys ${w.phys.toFixed(2)}  delta ${w.d.toFixed(2)}  on ${w.kind}`));
if (result.holes.length) {
  console.log("\nholes (no hit):");
  result.holes.forEach((h) => console.log(`  (${h.x}, ${h.z})  visual ${h.visual.toFixed(2)}`));
}
console.log(`landed on the fallback slab : ${result.onFallback} (${pct(result.onFallback)})   <- terrain collider absent here`);
result.fallbackSample.forEach((w) => console.log(`  (${w.x}, ${w.z})  visual ${w.visual.toFixed(2)}  phys ${w.phys.toFixed(2)}`));
if (result.drops && result.drops.length) {
  const sunk = result.drops.filter((d) => d.below > 0.6);
  const fell = result.drops.filter((d) => d.below > 8);
  console.log(`\n=== DROP TEST === ${result.drops.length} placements`);
  console.log(`hero ended up UNDER the rendered ground : ${sunk.length}`);
  console.log(`hero fell right through (>8 units under): ${fell.length}`);
  const worstDrops = [...result.drops].sort((a, b) => b.below - a.below).slice(0, 10);
  worstDrops.forEach((d) => console.log(
    `  from (${d.x}, ${d.z}) -> (${d.px.toFixed(0)}, ${d.pz.toFixed(0)})  hero y ${d.y.toFixed(2)}  surface ${d.surface.toFixed(2)}  under-by ${d.below.toFixed(2)}`));
}
console.log("\nwhat the rays landed on:", JSON.stringify(result.kinds));
console.log("probe extent:", JSON.stringify(result.extent));
console.log("\nphysics report:", JSON.stringify(result.physicsReport));
console.log("world report:", JSON.stringify(result.worldReport)?.slice(0, 600));
if (pageErrors.length) console.log("\nPAGE ERRORS:\n" + pageErrors.slice(0, 3).join("\n---\n"));

await browser.close();
server.kill("SIGTERM");
