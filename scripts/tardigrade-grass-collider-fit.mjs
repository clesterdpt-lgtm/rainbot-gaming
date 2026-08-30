#!/usr/bin/env node
/* How well does each grass collider fit the blade it stands for?
 *
 * Reads the REAL instance matrices out of the scatter meshes and the REAL
 * blade geometry, reconstructs the capsule world.js builds for that blade,
 * and measures the horizontal gap between the capsule axis and the blade's
 * drawn centreline at a series of heights.
 *
 * A gap larger than the capsule radius means the solid part is not where
 * the blade is drawn: an invisible pole next to a blade that is not solid.
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
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__TSIM && window.__TSIM.isReady(), null, { timeout: 120000 });

const out = await page.evaluate(() => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const THREE = T.THREE;

  // Every GrassForest chunk is an InstancedMesh of the blade geometry.
  const meshes = [];
  ctx.scene.traverse((o) => {
    if (o.isInstancedMesh && /GrassForest/i.test(o.name || (o.parent && o.parent.name) || "")) meshes.push(o);
  });

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const local = new THREE.Vector3();
  const bladePt = new THREE.Vector3();

  // bladeGeometry(4, 0.26): local y = t - 0.06t^2, local z = 0.26 t^2.
  const CURVE = 0.26, DROOP = 0.06;
  // world.js: capsule centre at base + 0.45h, halfHeight 0.42h, radius w*0.16
  const CAP_MID = 0.45, CAP_HALF = 0.42, RAD_K = 0.16;

  const rows = [];
  let n = 0;
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.count && n < 4000; i += 1) {
      mesh.getMatrixAt(i, m4);
      m4.decompose(pos, quat, scl);
      const h = scl.y, w = scl.x;
      if (!(h > 1)) continue;
      n += 1;
      const radius = w * RAD_K;

      // Capsule axis as world.js now builds it: anchored at the blade base,
      // leaning along the chord from base to tip.
      const TOP = 0.87;
      const tipY = (TOP - DROOP * TOP * TOP) * h;
      const tipZ = CURVE * TOP * TOP * (h * 0.55);
      const axis = new THREE.Vector3(0, tipY, tipZ).normalize().applyQuaternion(quat);
      // world.js places the capsule centre at localOffset, in the instance frame.
      const centre = new THREE.Vector3(0, tipY * 0.5, tipZ * 0.375)
        .applyQuaternion(quat).add(pos);
      const rel = new THREE.Vector3();

      for (const t of [0.2, 0.4, 0.6, 0.87]) {
        local.set(0, t - DROOP * t * t, CURVE * t * t).multiply(scl).applyQuaternion(quat);
        bladePt.copy(pos).add(local);
        // OLD: a vertical capsule through the base, so the gap is just the
        // horizontal distance from the base.
        const gapOld = Math.hypot(bladePt.x - pos.x, bladePt.z - pos.z);
        // NEW: perpendicular distance from the blade point to the leaning
        // capsule axis.
        rel.subVectors(bladePt, centre);
        const gapNew = rel.clone().addScaledVector(axis, -rel.dot(axis)).length();
        rows.push({ t, gapOld, gapNew, radius, h });
      }
    }
  }

  const at = (t) => rows.filter((r) => r.t === t);
  const mean = (a, k) => a.reduce((s, r) => s + r[k], 0) / (a.length || 1);
  const summary = [0.2, 0.4, 0.6, 0.87].map((t) => {
    const a = at(t);
    return {
      t,
      meanOld: mean(a, "gapOld"),
      meanNew: mean(a, "gapNew"),
      maxNew: a.reduce((m, r) => Math.max(m, r.gapNew), 0),
      meanRadius: mean(a, "radius"),
      oldPct: (a.filter((r) => r.gapOld > r.radius).length / (a.length || 1)) * 100,
      newPct: (a.filter((r) => r.gapNew > r.radius).length / (a.length || 1)) * 100,
      oldRadii: mean(a.map((r) => ({ v: r.gapOld / r.radius })), "v"),
      newRadii: mean(a.map((r) => ({ v: r.gapNew / r.radius })), "v"),
    };
  });
  return { blades: n, meshes: meshes.length, summary };
});

console.log("=== GRASS COLLIDER FIT ===");
console.log(`${out.blades} blade instances across ${out.meshes} scatter chunks\n`);
console.log("  height    OLD gap  (radii)  miss%      NEW gap  (radii)  miss%    radius");
for (const s of out.summary) {
  console.log(`   ${(s.t * 100).toFixed(0).padStart(3)}%   ${s.meanOld.toFixed(2).padStart(8)}  ${(s.oldRadii.toFixed(1) + "x").padStart(6)}  ${(s.oldPct.toFixed(0) + "%").padStart(5)}   ${s.meanNew.toFixed(2).padStart(10)}  ${(s.newRadii.toFixed(1) + "x").padStart(6)}  ${(s.newPct.toFixed(0) + "%").padStart(5)}   ${s.meanRadius.toFixed(2).padStart(7)}`);
}

await browser.close();
server.kill("SIGTERM");
