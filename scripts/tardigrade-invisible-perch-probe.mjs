#!/usr/bin/env node
/* Invisible perch probe.
 *
 * The second reported fault: the animal climbed something it could not see
 * and stood on top of it. A tardigrade is meant to climb grass, so the
 * climb itself is right - what is wrong is WHERE the grass is solid.
 *
 * Each collided blade gets one straight vertical capsule at its base, but
 * the drawn blade is a curved ribbon that leans away along its own local
 * +Z (bend 0.26*t^2, scaled by h*0.55, so up to ~15 units at the top) and
 * whose instance matrix is composed in YXZ while the collider is built in
 * the default XYZ. So the upper half of every grass collider stands in open
 * air, and climbing one leaves you perched on nothing.
 *
 * This walks the bare hero capsule into grass, and whenever it ends up
 * elevated it fires a VISUAL raycast straight down. Ground drawn under the
 * capsule means it is standing on something visible; nothing drawn means an
 * invisible perch.
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

const result = await page.evaluate((step) => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const THREE = T.THREE;
  const phys = ctx.physics;
  const world = ctx.world;
  const rworld = phys.world;

  const RADIUS = 0.32, HALF = 0.07, SKIN = 0.02;
  const FOOT = RADIUS + HALF;
  const SPEED = 13.5, DT = 1 / 60, GRAV = 19.6;
  const RUN = 120;

  // Chunked scatter hides what the camera cannot see, so a visual raycast
  // finds nothing almost everywhere unless everything is forced visible.
  const hidden = [];
  ctx.scene.traverse((o) => { if (o.visible === false) { hidden.push(o); o.visible = true; } });

  const heroRoot = (ctx.tardigrade && ctx.tardigrade.root) || null;
  const isHero = (o) => { for (let n = o; n; n = n.parent) if (n === heroRoot) return true; return false; };
  const rc = new THREE.Raycaster();

  /** Nearest drawn surface below `p`, or null. */
  function drawnBelow(p, maxDist) {
    rc.set(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(0, -1, 0));
    rc.far = maxDist;
    for (const h of rc.intersectObject(ctx.scene, true)) {
      const o = h.object;
      if (!o.visible || o.name === "Sky" || o.isPoints || isHero(o)) continue;
      let vis = true;
      for (let n = o; n; n = n.parent) if (n.visible === false) { vis = false; break; }
      if (vis) return h.distance;
    }
    return null;
  }

  const ch = phys.createCharacter({ radius: RADIUS, halfHeight: HALF, offset: SKIN, position: [0, 200, 0] });
  const commit = (p) => { ch.body.setTranslation(p, true); rworld.propagateModifiedBodyPositionsToColliders(); };

  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  let samples = 0, elevated = 0, perched = 0, sumRise = 0, maxRise = 0;
  const worst = [];

  for (let x = -420; x <= 420; x += step) {
    for (let z = -420; z <= 420; z += step) {
      for (const [dx, dz] of DIRS) {
        const y0 = world.heightAt(x, z);
        ch.teleport(x, y0 + FOOT + 0.05, z);
        rworld.propagateModifiedBodyPositionsToColliders();
        let vy = 0;
        for (let i = 0; i < 24; i += 1) {
          vy -= GRAV * DT;
          const s = ch.move({ x: 0, y: vy * DT, z: 0 }, DT);
          if (s.grounded) vy = 0;
          commit(s.position);
        }
        let touchedFoliage = false;
        for (let i = 0; i < RUN; i += 1) {
          vy -= GRAV * DT;
          const s = ch.move({ x: dx * SPEED * DT, y: vy * DT, z: dz * SPEED * DT }, DT);
          if (s.grounded) vy = 0;
          for (const c of s.collisions) {
            if (c.record && c.record.kind === "foliage") touchedFoliage = true;
          }
          commit(s.position);
        }
        samples += 1;
        if (!touchedFoliage) continue;

        const p = ch.body.translation();
        const ground = world.heightAt(p.x, p.z);
        const height = p.y - FOOT - ground;   // how far the feet are above the ground
        if (height <= 1.5) continue;
        elevated += 1;
        sumRise += height;
        if (height > maxRise) maxRise = height;

        // Is anything DRAWN between the feet and the ground below?
        const d = drawnBelow({ x: p.x, y: p.y - FOOT + 0.05, z: p.z }, height + 2);
        if (d === null) {
          perched += 1;
          if (worst.length < 14) {
            worst.push({ x, z, dir: [dx, dz],
                         at: [Number(p.x.toFixed(1)), Number(p.z.toFixed(1))],
                         height: Number(height.toFixed(2)) });
          }
        }
      }
    }
  }

  ch.dispose();
  for (const o of hidden) o.visible = false;

  return {
    samples, elevated, perched,
    meanRise: elevated ? sumRise / elevated : 0,
    maxRise,
    worst,
  };
}, STEP);

console.log("=== INVISIBLE PERCH PROBE ===");
console.log(`samples ${result.samples}`);
console.log(`ended elevated on grass : ${result.elevated}  (mean ${result.meanRise.toFixed(2)} units up, max ${result.maxRise.toFixed(2)})`);
console.log(`  ...with NOTHING drawn underneath : ${result.perched}  <-- invisible perches`);
result.worst.forEach((w) => console.log(
  `   from (${w.x}, ${w.z}) dir ${w.dir} -> stood at (${w.at[0]}, ${w.at[1]}) ${w.height} units above the ground, nothing drawn below`));

await browser.close();
server.kill("SIGTERM");
