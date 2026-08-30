#!/usr/bin/env node
/* ============================================================
   SAINTFALL - pose sight-line probe

   An authored camera pose is a claim that you can SEE the thing
   from there, and terrain does not honour claims. The `saint-scale`
   pose was written at eye height at the pilgrim camp and, on the
   terrain as it now stands, spent 60% of its frame inside the dune
   directly in front of it - a review image nobody could read, held
   in the suite as if it were a picture of the Saint.

   This walks the ground profile from a candidate camera to a target
   and reports the worst obstruction as an ANGLE: how far above the
   camera's horizon the terrain rises, against how far above it the
   target sits. Anything where the ground wins is a pose that cannot
   work, whatever the numbers in the file say.

   Usage:
     node scripts/saintfall-pose-sightline.mjs --poi saint-camp \
       --target 4,56,10 --ring 60,190
   ============================================================ */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) args[k] = true;
      else { args[k] = n; i += 1; }
    } else args._.push(t);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const PORT = 47000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const TARGET = String(args.target || "4,56,10").split(",").map(Number);
const RING = String(args.ring || "60,190").split(",").map(Number);
const EYE = Number(args.eye || 1.7);
/* --check "x,z;x,z" tests specific candidates outright. */
const CHECKS = args.check
  ? String(args.check).split(";").map((s) => s.split(",").map(Number))
  : [];

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

for (let i = 0; i < 150; i += 1) {
  try { const r = await fetch(`${BASE}/games/saintfall.html`); if (r.ok) break; } catch (_) { /* retry */ }
  await delay(100);
}

const browser = await chromium.launch({
  channel: "chromium", headless: true,
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader", "--mute-audio"],
});
const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
  { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__SF && window.__SF.isReady(),
  null, { timeout: 300000 });

const out = await page.evaluate(({ target, ring, eye, checks, poiId }) => {
  const T = window.__SF;
  const g = (x, z) => T.groundHeightAt(x, z);
  const poi = ((T.world && T.world.pois) || []).find((p) => p.id === poiId);
  const cx = poi ? poi.x : 0;
  const cz = poi ? poi.z : 0;

  /* Worst terrain rise along the ray, as an angle above the camera's
     own horizontal. Sampled every 3m, which is under the terrain's
     finest cell so nothing hides between samples. */
  function clearance(px, pz, py) {
    const dx = target[0] - px;
    const dz = target[2] - pz;
    const flat = Math.hypot(dx, dz);
    const targetAngle = Math.atan2(target[1] - py, flat);
    let worst = -Math.PI;
    let worstAt = 0;
    for (let d = 4; d < flat - 6; d += 3) {
      const t = d / flat;
      const h = g(px + dx * t, pz + dz * t);
      const a = Math.atan2(h - py, d);
      if (a > worst) { worst = a; worstAt = d; }
    }
    return {
      targetAngleDeg: targetAngle * 180 / Math.PI,
      terrainAngleDeg: worst * 180 / Math.PI,
      marginDeg: (targetAngle - worst) * 180 / Math.PI,
      worstAtM: Math.round(worstAt),
      distM: Math.round(flat),
    };
  }

  const rows = [];
  // Named candidates get checked directly, so a pose that is being
  // ARGUED for can be tested rather than searched for.
  for (const c of (checks || [])) {
    const y = g(c[0], c[1]) + eye;
    rows.push({
      x: c[0], z: c[1], y: Number(y.toFixed(2)), named: true,
      toCampM: Math.round(Math.hypot(c[0] - cx, c[1] - cz)),
      ...clearance(c[0], c[1], y),
    });
  }
  for (let a = 0; a < 64; a += 1) {
    const ang = (a / 64) * Math.PI * 2;
    for (let r = ring[0]; r <= ring[1]; r += 10) {
      // Candidates are placed around the TARGET, so the framing keeps
      // the subject at a workable distance whatever the camp's own
      // position turned out to be.
      const x = target[0] + Math.cos(ang) * r;
      const z = target[2] + Math.sin(ang) * r;
      const y = g(x, z) + eye;
      const c = clearance(x, z, y);
      rows.push({
        x: Number(x.toFixed(1)), z: Number(z.toFixed(1)),
        y: Number(y.toFixed(2)),
        toCampM: Math.round(Math.hypot(x - cx, z - cz)),
        ...c,
      });
    }
  }
  const named = rows.filter((r) => r.named);
  rows.sort((p, q) => q.marginDeg - p.marginDeg);
  return { camp: { x: Math.round(cx), z: Math.round(cz) },
           named, best: rows.slice(0, 10) };
}, { target: TARGET, ring: RING, eye: EYE, checks: CHECKS,
     poiId: String(args.poi || "saint-camp") });

console.log(`camp at ${out.camp.x}, ${out.camp.z}`);
const line = (r) => `  ${String(r.x).padStart(7)}, ${String(r.z).padStart(7)}  y ${r.y}`
  + `  dist ${String(r.distM).padStart(4)}m  margin ${r.marginDeg.toFixed(1)}deg`
  + `  (ground peaks ${r.terrainAngleDeg.toFixed(1)}deg at ${r.worstAtM}m)`
  + `  camp ${r.toCampM}m`;
if (out.named.length) {
  console.log("named candidates:");
  for (const r of out.named) console.log(line(r));
}
console.log("best sight lines (margin = how far the target clears the ground):");
for (const r of out.best) console.log(line(r));

await browser.close();
server.kill();
