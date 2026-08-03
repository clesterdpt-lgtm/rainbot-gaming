#!/usr/bin/env node
/* Invisible-barrier and visual-gap probe.
 *
 * Two mismatches between what is drawn and what is solid:
 *
 *   BARRIER  physics blocks horizontal movement at walking height, but a
 *            visual raycast from the same point finds no mesh there. The
 *            player walks into a wall that is not on screen.
 *
 *   GAP      the renderer draws no surface under a point where the physics
 *            says there is ground (a hole you can see through but not fall
 *            into), or vice versa.
 *
 * Physics is queried through ctx.physics.raycast; visuals through a
 * THREE.Raycaster against the scene graph, so the two answers are genuinely
 * independent.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const STEP = Number(process.env.STEP || 18);
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
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__TSIM && window.__TSIM.isReady(), null, { timeout: 90000 });

const result = await page.evaluate((step) => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const THREE = T.THREE;
  const world = ctx.world;
  const phys = ctx.physics;
  const HALF = 450;

  // The world culls chunks by toggling `visible`, and only what the QA
  // camera can see is on. A visual raycast therefore finds NOTHING almost
  // everywhere - the first run of this probe reported "100% visual gaps",
  // which was the instrument, not the world. Force everything visible for
  // the duration of the probe and restore it afterwards.
  const hidden = [];
  ctx.scene.traverse((o) => {
    if (o.visible === false) { hidden.push(o); o.visible = true; }
  });

  const rc = new THREE.Raycaster();
  rc.far = 400;
  const dir = new THREE.Vector3();
  const org = new THREE.Vector3();

  // Identity, not name matching. Testing ancestor NAMES against
  // /tardigrade|hero/ matched a parent container - the whole world sits
  // under one - so every hit was classified as the hero and discarded, and
  // the probe reported "100% visual gaps" twice. Compare against the hero's
  // actual root object instead.
  const heroRoot = (ctx.tardigrade && ctx.tardigrade.root) || null;
  const isHeroPart = (o) => {
    if (!heroRoot) return false;
    for (let n = o; n; n = n.parent) if (n === heroRoot) return true;
    return false;
  };

  /** Nearest visible mesh along a ray, ignoring sky and the hero. */
  function visualHit(ox, oy, oz, dx, dy, dz, maxDist) {
    org.set(ox, oy, oz);
    dir.set(dx, dy, dz).normalize();
    rc.set(org, dir);
    rc.far = maxDist;
    const hits = rc.intersectObject(ctx.scene, true);
    for (const h of hits) {
      const o = h.object;
      if (!o.visible || o.name === "Sky" || o.isPoints || isHeroPart(o)) continue;
      let vis = true;
      for (let n = o; n; n = n.parent) if (n.visible === false) { vis = false; break; }
      if (vis) return h;
    }
    return null;
  }

  const barriers = [];
  const gaps = [];
  const DIRS = [[1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7], [0, -1], [0.7, -0.7]];
  const REACH = 9;          // a bit over one hero length
  const EYE = 0.9;          // walking height above the surface
  let samples = 0;

  for (let x = -HALF + 20; x <= HALF - 20; x += step) {
    for (let z = -HALF + 20; z <= HALF - 20; z += step) {
      const surf = world.heightAt(x, z);
      const y = surf + EYE;
      samples += 1;

      // --- visual gap: is the GROUND drawn beneath this point? ---
      // Take every hit, not the first: scatter (a pebble, a moss tuft) sits
      // several units proud of the surface, and stopping at the nearest hit
      // reported those as "the ground is 4 units too high". A gap is only a
      // gap if NO drawn surface lies near where heightAt says the ground is.
      org.set(x, surf + 12, z);
      dir.set(0, -1, 0);
      rc.set(org, dir);
      rc.far = 80;
      let nearest = null;
      for (const h of rc.intersectObject(ctx.scene, true)) {
        const o = h.object;
        if (!o.visible || o.name === "Sky" || o.isPoints || isHeroPart(o)) continue;
        const d = Math.abs(h.point.y - surf);
        if (nearest === null || d < nearest) nearest = d;
      }
      if (nearest === null) gaps.push({ x, z, surf: Number(surf.toFixed(2)) });
      else if (nearest > 1.5) gaps.push({ x, z, surf: Number(surf.toFixed(2)), off: Number(nearest.toFixed(2)) });

      // --- invisible barrier: physics blocks, nothing drawn ---
      for (const [dx, dz] of DIRS) {
        let r = null;
        try {
          r = phys.raycast({ x, y, z }, { x: dx, y: 0, z: dz }, REACH, { filter: 1 | (1 << 1) });
        } catch (e) { continue; }
        if (!r || r.hit === false || !r.point) continue;
        const d = Math.hypot(r.point.x - x, r.point.z - z);
        if (d < 0.35) continue;                      // starting inside something
        const v = visualHit(x, y, z, dx, 0, dz, d + 2.5);
        if (!v || v.distance > d + 2.0) {
          barriers.push({
            x, z,
            dir: [dx, dz],
            solidAt: Number(d.toFixed(2)),
            drawnAt: v ? Number(v.distance.toFixed(2)) : null,
            kind: (r.record && r.record.kind) || "?",
          });
        }
        break;                                        // one report per point
      }
    }
  }

  for (const o of hidden) o.visible = false;

  const byKind = {};
  for (const b of barriers) byKind[b.kind] = (byKind[b.kind] || 0) + 1;

  return {
    restored: hidden.length,
    samples,
    barriers: barriers.length,
    byKind,
    barrierSample: barriers.slice(0, 14),
    gaps: gaps.length,
    gapSample: gaps.slice(0, 14),
  };
}, STEP);

const pct = (n) => `${((n / result.samples) * 100).toFixed(2)}%`;
console.log("=== BARRIER / GAP PROBE ===");
console.log(`samples ${result.samples} (step ${STEP})`);
console.log(`invisible barriers : ${result.barriers} (${pct(result.barriers)})`);
console.log("  by collider kind :", JSON.stringify(result.byKind));
result.barrierSample.forEach((b) => console.log(
  `   (${b.x}, ${b.z}) dir ${b.dir}  solid at ${b.solidAt}  drawn at ${b.drawnAt === null ? "NOTHING" : b.drawnAt}  [${b.kind}]`));
console.log(`\nvisual gaps        : ${result.gaps} (${pct(result.gaps)})`);
result.gapSample.forEach((g) => console.log(
  `   (${g.x}, ${g.z}) surface ${g.surf}  drawn ${g.drawn === undefined ? "NOTHING" : g.drawn}`));

await browser.close();
server.kill("SIGTERM");
