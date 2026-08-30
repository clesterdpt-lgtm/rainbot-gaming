#!/usr/bin/env node
/* How much bigger is the drawn animal than the thing that collides?
 *
 * The controller capsule is radius 0.32 / halfHeight 0.07 - 0.78 units tall
 * and 0.64 across - while the tuning table's own scale note says the hero is
 * 1.6 units long. If the model is materially larger than its capsule then
 * pressing against any surface pushes head, legs and tail THROUGH it, which
 * looks exactly like clipping inside the object even though the capsule is
 * resolving correctly (the walking clip probe found it never ends up inside).
 *
 * Measures the hero's world-space bounds, then drives it flat against each
 * landmark and reports how far the drawn body ends up past the surface.
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
  const THREE = T.THREE;

  const RADIUS = 0.72, HALFH = -0.33;  // round cylinder: 1.44 wide, 0.78 tall
  const heroRoot = ctx.tardigrade && ctx.tardigrade.root;

  function heroBox() {
    const box = new THREE.Box3();
    box.makeEmpty();
    heroRoot.updateWorldMatrix(true, true);
    heroRoot.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (!o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      box.union(b);
    });
    return box;
  }

  // Rest pose on flat ground.
  T.input.stopMove();
  T.teleportHero(-160, ctx.world.heightAt(-160, 240) + 1.2, 240);
  ctx.advanceTime(1.2);
  const box = heroBox();
  const size = new THREE.Vector3();
  box.getSize(size);
  const p = ctx.player.report().position;

  // Now press the animal against landmarks and see how far the drawn body
  // ends up beyond the first solid surface in the direction of travel.
  const LANDMARKS = {
    bottleCap: { x: -158, z: -166, reach: 120 },
    legoBrick: { x: -271, z: 250, reach: 150 },
    shard: { x: 292, z: -232, reach: 250 },
    lolly: { x: 135, z: -148, reach: 200 },
    boulders: { x: 8, z: -320, reach: 130 },
    screw: { x: -166, z: 148, reach: 140 },
  };

  const rows = [];
  for (const [id, L] of Object.entries(LANDMARKS)) {
    let worst = 0;
    let n = 0;
    for (const deg of [0, 90, 180, 270]) {
      const a = (deg * Math.PI) / 180;
      const sx = L.x + Math.cos(a) * L.reach;
      const sz = L.z + Math.sin(a) * L.reach;
      if (Math.abs(sx) > 440 || Math.abs(sz) > 440) continue;
      n += 1;
      T.input.stopMove();
      T.teleportHero(sx, ctx.world.heightAt(sx, sz) + 1.2, sz);
      ctx.advanceTime(0.5);
      const want = Math.atan2(L.x - sx, L.z - sz);
      T.input.look((want - ctx.player.report().camYaw) * 220, 0);
      ctx.advanceTime(0.25);
      T.input.move(0, 1);
      ctx.advanceTime(4.5);
      T.input.stopMove();
      ctx.advanceTime(0.3);

      const pp = ctx.player.report().position;
      const dirx = Math.sin(want), dirz = Math.cos(want);
      // Where is the first solid surface ahead of the capsule centre?
      let surf = null;
      try {
        const r = ctx.physics.raycast({ x: pp.x, y: pp.y + 0.35, z: pp.z }, { x: dirx, y: 0, z: dirz }, 40, { filter: 1 | (1 << 1) });
        if (r && r.hit) surf = r.distance !== undefined ? r.distance : null;
      } catch (e) { /* ignore */ }
      if (surf === null) continue;

      // How far does the DRAWN body reach in that direction past the centre?
      const b = heroBox();
      const corners = [
        new THREE.Vector3(b.min.x, b.min.y, b.min.z), new THREE.Vector3(b.max.x, b.min.y, b.min.z),
        new THREE.Vector3(b.min.x, b.max.y, b.min.z), new THREE.Vector3(b.max.x, b.max.y, b.min.z),
        new THREE.Vector3(b.min.x, b.min.y, b.max.z), new THREE.Vector3(b.max.x, b.min.y, b.max.z),
        new THREE.Vector3(b.min.x, b.max.y, b.max.z), new THREE.Vector3(b.max.x, b.max.y, b.max.z),
      ];
      let reach = 0;
      for (const c of corners) {
        const d = (c.x - pp.x) * dirx + (c.z - pp.z) * dirz;
        if (d > reach) reach = d;
      }
      const past = reach - surf;
      if (past > worst) worst = past;
    }
    rows.push({ id, runs: n, past: worst });
  }

  return {
    capsule: { radius: RADIUS, height: (HALFH + RADIUS) * 2, width: RADIUS * 2 },
    body: { x: size.x, y: size.y, z: size.z },
    footToTop: box.max.y - (p.y - RADIUS - HALFH),
    rows,
  };
});

console.log("=== BODY vs CAPSULE FIT ===\n");
console.log(`  collision capsule : ${out.capsule.width.toFixed(2)} wide x ${out.capsule.height.toFixed(2)} tall`);
console.log(`  drawn body        : ${out.body.x.toFixed(2)} x ${out.body.z.toFixed(2)} wide x ${out.body.y.toFixed(2)} tall`);
const longest = Math.max(out.body.x, out.body.z);
console.log(`  longest axis is ${(longest / out.capsule.width).toFixed(1)}x the capsule width, height ${(out.body.y / out.capsule.height).toFixed(1)}x the capsule height\n`);
console.log("  pressed flat against each landmark, how far the DRAWN body reaches past the solid surface:");
for (const r of out.rows) {
  const flag = r.past > 0.05 ? "  <-- body penetrates" : "";
  console.log(`   ${r.id.padEnd(12)} ${r.runs} runs   ${r.past.toFixed(2).padStart(6)} units past the surface${flag}`);
}

await browser.close();
server.kill("SIGTERM");
