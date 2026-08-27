#!/usr/bin/env node
/* ============================================================
   SAINTFALL - NEAR-FIELD SCATTER PROBE

   "atoll-world.js already places 1917 shingle, 471 driftwood and
   147 boulders - find out why none of them are landing where the
   arrival and strand cameras are standing."

   A total is not a density. Every one of those three scatters is
   gated on tide band, height, seaward side and locus distance, and
   a gate that excludes one arena excludes it silently: the count
   still prints 1917.

   So this stands at each authored camera and asks the FIELD what
   it says there - height, tide band, seaward, locus distance, the
   surface mix - and then counts, per prop bin, how much geometry
   actually lands inside 8 / 16 / 32 m of the lens.

   Batched props are merged into one geometry per bin, so instances
   cannot be counted directly. VERTICES inside the radius are
   counted instead. It is a proxy and it is a good one: every bin
   here is built from the same kit primitives, so vertices are
   proportional to instances within a bin, and zero means zero.

     node scripts/saintfall-nearfield-probe.mjs
     node scripts/saintfall-nearfield-probe.mjs --poses arrival,strand
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const t = process.argv[i];
  if (!t.startsWith("--")) continue;
  const n = process.argv[i + 1];
  if (n === undefined || n.startsWith("--")) args[t.slice(2)] = true;
  else { args[t.slice(2)] = n; i += 1; }
}
const POSES = String(args.poses || "arrival,strand,nave,bone-reef").split(",");
const TIME = String(args.time || "trade");
const QUALITY = String(args.quality || "high");
const PORT = Number(args.port || 44100 + (process.pid % 6000));
const PAGE = "saintfall-green-antiphon.html";
const URL = `http://127.0.0.1:${PORT}/games/${PAGE}?qa=1&quality=${QUALITY}&time=${TIME}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let browser;
try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(URL, { cache: "no-store" }); if (r.ok) break; } catch (_) {}
    await delay(100);
  }
  browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--hide-scrollbars", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__SF && !!window.__SF.atoll, null, { timeout: 240000 });

  const out = await page.evaluate(({ poses }) => {
    const T = window.__SF;
    T.maximize();
    const A = T.atoll;
    const scene = T.render.scene;
    const rows = [];

    /* Every mesh in the scene, with its world-space vertex list
       cached once. The terrain, the water and the sky are bulk and
       are not dressing. */
    const BULK = /^terrain|^apron|^water|^sea|^foam|^spray|^weather|^sky|^cloud|^pollen|^rain|^flora-canopy-oct/;
    const meshes = [];
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (!o.visible) return;
      if (!(o.isMesh || o.isInstancedMesh)) return;
      const name = o.name || o.type;
      if (BULK.test(name)) return;
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      meshes.push({ name, obj: o, count: g.attributes.position.count });
    });

    function nearCounts(cx, cz, radii) {
      const byBin = {};
      for (const m of meshes) {
        const pos = m.obj.geometry.attributes.position;
        const mat = m.obj.matrixWorld.elements;
        /* Sample the vertex list: a merged bin can carry 200k
           vertices and the exact number is not the question. */
        const step = Math.max(1, Math.floor(pos.count / 30000));
        const hits = radii.map(() => 0);
        const inst = m.obj.isInstancedMesh ? m.obj.count : 0;
        if (inst) {
          /* An InstancedMesh: measure instance origins, which is
             what an instance actually is. */
          const im = m.obj.instanceMatrix.array;
          for (let i = 0; i < inst; i += 1) {
            const x = im[i * 16 + 12], z = im[i * 16 + 14];
            const wx = mat[0] * x + mat[8] * z + mat[12];
            const wz = mat[2] * x + mat[10] * z + mat[14];
            const d = Math.hypot(wx - cx, wz - cz);
            for (let k = 0; k < radii.length; k += 1) if (d <= radii[k]) hits[k] += 1;
          }
        } else {
          for (let i = 0; i < pos.count; i += step) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            const wx = mat[0] * x + mat[4] * y + mat[8] * z + mat[12];
            const wz = mat[2] * x + mat[6] * y + mat[10] * z + mat[14];
            const d = Math.hypot(wx - cx, wz - cz);
            for (let k = 0; k < radii.length; k += 1) if (d <= radii[k]) hits[k] += step;
          }
        }
        if (hits[hits.length - 1] > 0) {
          const key = m.name.replace(/-\d+$/, "");
          if (!byBin[key]) byBin[key] = radii.map(() => 0);
          for (let k = 0; k < radii.length; k += 1) byBin[key][k] += hits[k];
        }
      }
      return byBin;
    }

    for (const id of poses) {
      T.setPose(id);
      T.renderStill();
      const cam = T.render.camera;
      const cx = cam.position.x, cz = cam.position.z;
      const s = A.surfaceAt(cx, cz) || {};
      const w = T.api && T.api.world;
      rows.push({
        pose: id,
        cam: [+cx.toFixed(1), +cam.position.y.toFixed(2), +cz.toFixed(1)],
        r: +Math.hypot(cx, cz).toFixed(1),
        groundY: +(A.terrainAt(cx, cz)).toFixed(2),
        tideBand: A.tideBandAt(cx, cz),
        seaward: w && w.seawardAt ? w.seawardAt(cx, cz) : null,
        surface: Object.fromEntries(Object.entries(s)
          .filter(([k, v]) => typeof v === "number" && v > 0.02)
          .map(([k, v]) => [k, +v.toFixed(2)])),
        bins: nearCounts(cx, cz, [8, 16, 32]),
      });
    }
    return { rows, worldStats: A.worldStats ? A.worldStats() : null };
  }, { poses: POSES });

  for (const r of out.rows) {
    console.log(`\n=== ${r.pose}  cam ${r.cam.join(", ")}  r=${r.r}`);
    console.log(`    groundY ${r.groundY}  tideBand ${r.tideBand}  seaward ${r.seaward}`);
    console.log(`    surface ${JSON.stringify(r.surface)}`);
    const keys = Object.keys(r.bins).sort();
    if (!keys.length) console.log("    NOTHING WITHIN 32 m");
    for (const k of keys) {
      const b = r.bins[k];
      console.log(`      ${k.padEnd(46)} 8m ${String(b[0]).padStart(7)}  16m ${String(b[1]).padStart(7)}  32m ${String(b[2]).padStart(7)}`);
    }
  }
  if (out.worldStats) console.log(`\nworldStats ${JSON.stringify(out.worldStats)}`);
  if (errs.length) console.log(`\npage errors:\n${errs.slice(0, 6).join("\n")}`);
} finally {
  if (browser) await browser.close();
  server.kill();
}
