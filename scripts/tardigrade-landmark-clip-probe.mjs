#!/usr/bin/env node
/* Does the hero end up INSIDE the big objects?
 *
 * Drives the real player straight at each landmark from several bearings
 * and, at the end of each run, decides whether the animal is inside the
 * drawn shell.
 *
 * Two independent inside tests, because the landmark meshes are not all
 * watertight and each test fails differently:
 *   PARITY  one long ray; an odd number of crossings means inside. Exact
 *           for a closed mesh, meaningless for an open one.
 *   CAGE    six axis rays; inside a shell they all hit. Tolerant of small
 *           holes, but a point in a deep concave pocket also scores high.
 * A landmark is reported as penetrated only when both agree.
 *
 * It also asks the PHYSICS what is there, so "no collider at all" is
 * distinguished from "collider present but the controller pushed through".
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

const result = await page.evaluate(() => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const THREE = T.THREE;
  const DT = 1 / 60;

  const LANDMARKS = {
    bottleCap: { x: -158, z: -166, reach: 120, names: /BottleCap|Cap/i },
    legoBrick: { x: -271, z: 250, reach: 150, names: /Lego/i },
    screw: { x: -166, z: 148, reach: 140, names: /Screw/i },
    shard: { x: 292, z: -232, reach: 250, names: /Terracotta|Shard/i },
    lolly: { x: 135, z: -148, reach: 200, names: /Lolly/i },
    hose: { x: 306, z: 296, reach: 230, names: /Hose/i },
    boulders: { x: 8, z: -320, reach: 130, names: /Boulder/i },
    pot: { x: -186, z: -706, reach: 300, names: /Pot/i },
  };

  // Force every chunk visible; the scatter culls by `visible`.
  const hidden = [];
  ctx.scene.traverse((o) => { if (o.visible === false) { hidden.push(o); o.visible = true; } });

  const heroRoot = (ctx.tardigrade && ctx.tardigrade.root) || null;
  const isHero = (o) => { for (let n = o; n; n = n.parent) if (n === heroRoot) return true; return false; };

  /** Collect the meshes belonging to one landmark. */
  function meshesFor(re) {
    const out = [];
    ctx.scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (isHero(o)) return;
      for (let n = o; n; n = n.parent) {
        if (n.name && re.test(n.name)) { out.push(o); return; }
      }
    });
    return out;
  }

  const rc = new THREE.Raycaster();
  const AXES = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
  ];

  function insideTests(p, meshes) {
    if (!meshes.length) return { parity: false, cage: 0, nearest: null };
    const org = new THREE.Vector3(p.x, p.y, p.z);
    // PARITY along +X
    rc.set(org, new THREE.Vector3(1, 0, 0));
    rc.far = 4000;
    const hits = rc.intersectObjects(meshes, false);
    const parity = hits.length % 2 === 1;
    // CAGE
    let cage = 0;
    let nearest = Infinity;
    for (const d of AXES) {
      rc.set(org, d);
      rc.far = 2000;
      const h = rc.intersectObjects(meshes, false);
      if (h.length) { cage += 1; if (h[0].distance < nearest) nearest = h[0].distance; }
    }
    return { parity, cage, nearest: Number.isFinite(nearest) ? nearest : null };
  }

  const BEARINGS = [0, 60, 120, 180, 240, 300];
  const rows = [];

  for (const [id, L] of Object.entries(LANDMARKS)) {
    const meshes = meshesFor(L.names);
    let clipped = 0, runs = 0, deepest = 0;
    let physKinds = {};

    for (const deg of BEARINGS) {
      const a = (deg * Math.PI) / 180;
      const sx = L.x + Math.cos(a) * L.reach;
      const sz = L.z + Math.sin(a) * L.reach;
      if (Math.abs(sx) > 440 || Math.abs(sz) > 440) continue;   // off the map
      runs += 1;

      T.teleportHero(sx, ctx.world.heightAt(sx, sz) + 1.2, sz);
      T.input.stopMove();
      ctx.advanceTime(0.5);

      // Aim the camera at the landmark, then hold forward: the stick is
      // camera-relative, so this walks the animal straight at it.
      const want = Math.atan2(L.x - sx, L.z - sz);
      const cur = ctx.player.report().camYaw;
      T.input.look((want - cur) * 220, 0);
      ctx.advanceTime(0.3);
      T.input.move(0, 1);
      ctx.advanceTime(5.0);
      T.input.stopMove();
      ctx.advanceTime(0.3);

      const p = ctx.player.report().position;
      const t = insideTests(p, meshes);
      if (t.parity && t.cage >= 5) {
        clipped += 1;
        if (t.nearest !== null && t.nearest > deepest) deepest = t.nearest;
      }

      // What does physics think is around the hero?
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        try {
          const r = ctx.physics.raycast({ x: p.x, y: p.y + 0.3, z: p.z }, { x: d[0], y: 0, z: d[1] }, 60, { filter: 1 | (1 << 1) });
          if (r && r.hit && r.record) physKinds[r.record.kind] = (physKinds[r.record.kind] || 0) + 1;
        } catch (e) { /* ignore */ }
      }
    }

    rows.push({ id, meshes: meshes.length, runs, clipped, deepest, physKinds });
  }

  for (const o of hidden) o.visible = false;
  return { rows, landmarksRegistered: (ctx.world.report() || {}).physics };
});

console.log("=== LANDMARK CLIP PROBE ===");
console.log("driving the hero at each landmark from up to 6 bearings, 5s each\n");
console.log("  landmark      meshes  runs  ended INSIDE   depth   what physics finds around the hero");
for (const r of result.rows) {
  const flag = r.clipped ? "  <-- CLIPS" : "";
  console.log(`  ${r.id.padEnd(12)}  ${String(r.meshes).padStart(5)}  ${String(r.runs).padStart(4)}  ${String(r.clipped + "/" + r.runs).padStart(12)}   ${r.deepest.toFixed(1).padStart(5)}   ${JSON.stringify(r.physKinds)}${flag}`);
}
console.log("\nworld physics registration:", JSON.stringify(result.landmarksRegistered));

await browser.close();
server.kill("SIGTERM");
