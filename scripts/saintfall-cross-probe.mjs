#!/usr/bin/env node
/* ============================================================
   SAINTFALL - wheel-cross placement probe

   The order's mark now stands on both worlds, and the two ways it
   can silently fail are the same two ways every authored landmark
   in this project has failed before:

     - it loads and is placed, but hangs in the air or is buried,
       because the seat came from a centre-point height rather than
       from the object's own footprint;
     - it is placed and visible and NOT IN THE COLLISION GRID,
       because the Meshy triangulation is finer than collide.js's
       half-metre clutter filter and the `collisionSolid` tag was
       not set.

   Neither is a picture. Both are measured here.

   Usage: node scripts/saintfall-cross-probe.mjs [--shots]
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 45000 + (process.pid % 4000);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.argv.includes("--shots");
const OUT = path.join(root, "output", "saintfall-cross-probe");

const MAPS = [
  { id: "vesper", page: "/games/saintfall.html?qa=1&quality=high" },
  { id: "kenosis", page: "/games/saintfall-white-vigil.html?qa=1&quality=high&time=alpenglow" },
];

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}
async function waitForServer() {
  for (let i = 0; i < 300; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`, { cache: "no-store" })).ok) return; }
    catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

let failures = 0;
function record(name, pass, detail) {
  if (!pass) failures += 1;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}  (${detail})`);
}

async function probe(browser, map) {
  console.log(`\n=== ${map.id} ===`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

  await page.goto(BASE + map.page, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 420000 });

  const rows = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const list = (T.world && T.world.authoredLandmarks) || [];
    const out = [];
    for (const lm of list) {
      if (!/[Cc]ross|choir-wheel|waycross/.test(lm.key)) continue;
      lm.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(lm.root);
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      /* The seat is measured against the surface the PLAYER stands
         on, not against the raw height field: on Kenosis a cross is
         bedded into a drift, and on Vesper the plaza is an authored
         pad. `groundHeight` is the one answer both agree on. */
      /* MEASURED PER VERTEX AGAINST ITS OWN GROUND, not by comparing
         the bounding box's floor to the height under the centre. The
         first version of this probe did the latter and reported every
         upright cross in the Gilded Reach - eighteen shipped objects
         - as five to nine metres buried, because a 25m monument on a
         dune has its lowest bounding corner well below the sand under
         its middle. That is a slope, not a fault. */
      const gaps = [];
      for (const mesh of lm.meshes) {
        const pos = mesh.geometry && mesh.geometry.attributes
          && mesh.geometry.attributes.position;
        if (!pos) continue;
        mesh.updateWorldMatrix(true, false);
        const m = mesh.matrixWorld.elements;
        const stride = Math.max(1, Math.floor(pos.count / 900));
        for (let i = 0; i < pos.count; i += stride) {
          const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
          const wx = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
          const wy = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
          const wz = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
          gaps.push(wy - T.collide.groundHeight(wx, wz));
        }
      }
      gaps.sort((p2, q) => p2 - q);
      const n = gaps.length;
      out.push({
        key: lm.key,
        x: +c.x.toFixed(1), z: +c.z.toFixed(1),
        h: +size.y.toFixed(2),
        /* The closest any part of it comes to the floor. Positive
           means the whole monument is in the air. */
        contact: n ? +gaps[0].toFixed(2) : null,
        /* How much of it is under the floor. A plinth is meant to be
           bedded; a shaft is not. */
        sunkPct: n ? +(100 * gaps.filter((g) => g < -0.2).length / n).toFixed(1) : null,
      });
    }
    return out;
  });

  record("crosses were placed", rows.length > 0, `${rows.length} found`);
  if (rows.length) {
    const hi = rows.reduce((a, b) => (b.contact > a.contact ? b : a));
    /* A monument may sink; it may not hover. 0.35m of exposed
       underside is where a low camera starts to see under a plinth. */
    record("no cross hangs in the air", hi.contact <= 0.35,
      `worst ${hi.key} +${hi.contact}m at ${hi.x},${hi.z}`);
    /* And it may not be swallowed.

       THE THRESHOLD IS CALIBRATED AGAINST THE SHIPPED OBJECTS, not
       chosen. The model's stepped footing is about a third of its
       vertices and is meant to be bedded, so the eighteen crosses
       that have stood in the Gilded Reach since that district was
       built measure 28-40% under the walk floor with nothing wrong
       with any of them. A gate at 30% therefore fails the baseline,
       which is the tell that the number came from an assumption
       rather than from the level. 45% passes every upright monument
       on both worlds and still catches a monument in a hole. */
    const drowned = rows.filter((r) => r.sunkPct > 45);
    const worst = rows.reduce((a, b) => (b.sunkPct > a.sunkPct ? b : a));
    record("no cross is buried", drowned.length === 0,
      drowned.length ? drowned.map((r) => `${r.key} ${r.sunkPct}%`).join(", ")
        : `deepest ${worst.key} ${worst.sunkPct}% under`);
    console.table(rows);
  }

  /* Collision: sample the grid at each cross's own centre. */
  const solid = await page.evaluate((keys) => {
    const T = window.__SF;
    const THREE = T.THREE;
    const list = (T.world && T.world.authoredLandmarks) || [];
    let tested = 0;
    let hit = 0;
    const misses = [];
    for (const lm of list) {
      if (!keys.includes(lm.key)) continue;
      lm.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(lm.root);
      const c = box.getCenter(new THREE.Vector3());
      const y = T.collide.groundHeight(c.x, c.z) + 1.0;
      tested += 1;
      /* Walk into it from four sides and see whether the collider
         stops the capsule. `blocked` is the same query the player's
         own move uses, so this cannot pass on a proxy nobody reads. */
      let stopped = false;
      for (let r = 0; r <= 1.6 && !stopped; r += 0.4) {
        for (let k = 0; k < 8; k += 1) {
          const a = (k / 8) * Math.PI * 2;
          if (T.collide.blocked(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r,
            y - 1.0, 0.42)) { stopped = true; break; }
        }
      }
      if (stopped) hit += 1; else misses.push(lm.key);
    }
    return { tested, hit, misses: misses.slice(0, 8) };
    /* A monument with almost nothing left above the floor has no
       raster to hit and is a siting fault rather than a collision
       one - it is reported by the burial gate above. */
  }, rows.filter((r) => r.sunkPct <= 60).map((r) => r.key));
  if (solid.tested) {
    record("crosses are solid", solid.hit === solid.tested,
      `${solid.hit}/${solid.tested} block the player`
      + (solid.misses.length ? ` - through: ${solid.misses.join(", ")}` : ""));
  }

  record("console stays clean", errors.length === 0,
    errors.slice(0, 3).join(" | ") || "no errors");

  if (SHOTS && rows.length) {
    await mkdir(OUT, { recursive: true });
    const picks = rows.filter((r, i) => i % Math.max(1, Math.floor(rows.length / 4)) === 0).slice(0, 4);
    for (const r of picks) {
      const url = await page.evaluate((spec) => {
        const T = window.__SF;
        const THREE = T.THREE;
        const lm = T.world.authoredLandmarks.find((e) => e.key === spec.key);
        lm.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(lm.root);
        const c = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const rad = Math.max(24, size.y * 1.25);
        const cx = c.x + Math.sin(2.1) * rad;
        const cz = c.z + Math.cos(2.1) * rad;
        const cy = Math.max(T.terrain.heightAt(cx, cz) + 3, c.y + size.y * 0.15);
        T.hideHud && T.hideHud(true);
        T.hidePlayer && T.hidePlayer(true);
        T.lookAt([cx, cy, cz], [c.x, c.y, c.z], 55);
        T.render.render(T.render.camera);
        return T.captureDataURL();
      }, r);
      const b64 = url.split(",")[1];
      await writeFile(path.join(OUT, `${map.id}-${r.key}.png`), Buffer.from(b64, "base64"));
    }
    console.log(`  shots -> ${OUT}`);
  }
  await page.close();
}

const server = startServer();
let browser = null;
try {
  await waitForServer();
  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  for (const m of MAPS) await probe(browser, m);
} finally {
  if (browser) await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
