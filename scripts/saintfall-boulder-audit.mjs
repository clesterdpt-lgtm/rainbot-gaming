#!/usr/bin/env node
/* ============================================================
   SAINTFALL - dune boulder audit

   Finds real "scatter-rock" boulder instances in open desert by
   raycasting a grid straight down against the live scene, clusters
   the hit points into distinct rocks, and photographs a spread of
   them from several angles each - including a low, near-ground shot
   aimed back UNDER the rock, which is the only framing that can
   show a hollow or a floating gap for what it actually is.

   Usage:  node scripts/saintfall-boulder-audit.mjs
           node scripts/saintfall-boulder-audit.mjs --out output/saintfall/boulder-audit/after
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) args[k] = true;
      else { args[k] = n; i += 1; }
    }
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(root, args.out || "output/saintfall/boulder-audit/latest");
const PORT = 49200 + (process.pid % 700);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e)));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&time=goldenhour&cycle=0&intro=0`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
    window.__SF.hideHud(true);
    window.__SF.releaseCamera();
  });

  /* --at x,z skips discovery and inspects one known point directly - for
     zooming in on a specific cluster found by a previous run. */
  let manualTarget = null;
  if (args.at) {
    const [mx, mz] = String(args.at).split(",").map(Number);
    manualTarget = await page.evaluate(({ mx, mz }) => {
      const T = window.__SF;
      const THREE = T.THREE;
      const scene = T.ctx.scene;
      const heightAt = T.ctx.terrain.heightAt;
      const mesh = scene.getObjectByName("scatter-rock");
      mesh.updateWorldMatrix(true, false);
      const pos = mesh.geometry.attributes.position;
      const v = new THREE.Vector3();
      let topY = -Infinity, botY = Infinity, cx = 0, cz = 0, n = 0;
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (Math.hypot(v.x - mx, v.z - mz) > 4) continue;
        topY = Math.max(topY, v.y); botY = Math.min(botY, v.y);
        cx += v.x; cz += v.z; n += 1;
      }
      if (!n) return null;
      cx /= n; cz /= n;
      return {
        x: Number(cx.toFixed(1)), z: Number(cz.toFixed(1)),
        topY: Number(topY.toFixed(2)), botY: Number(botY.toFixed(2)),
        groundY: Number(heightAt(cx, cz).toFixed(2)),
        heightAboveGround: Number((topY - heightAt(cx, cz)).toFixed(2)),
        undergroundDepth: Number((heightAt(cx, cz) - botY).toFixed(2)),
        spread: 3, verts: n,
      };
    }, { mx, mz });
    if (!manualTarget) throw new Error(`no scatter-rock vertices found within 4m of ${args.at}`);
    console.log("Manual target:", manualTarget);
  }

  /* -------- find real boulders: sample the merged mesh's own vertices --------
     A raycast grid over hundreds of metres is either too coarse to find
     individual rocks or, fine enough to find them, too many rays against
     a many-thousand-triangle merged mesh to run in reasonable time. The
     scatter pass already merges every "rock" instance in the desert into
     ONE mesh named "scatter-rock" (see world.js's Scattering step) - so
     reading that mesh's own position buffer directly is both the fast
     path and the more honest one: it sees underside vertices a downward
     ray never would, which is exactly the geometry in question. */
  const found = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const scene = T.ctx.scene;
    const heightAt = T.ctx.terrain.heightAt;
    const mesh = scene.getObjectByName("scatter-rock");
    if (!mesh) return { error: "no scatter-rock mesh found in scene" };
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.attributes.position;
    const v = new THREE.Vector3();

    const DISTRICTS = [
      [0, 830, 340], [-600, 545, 460], [0, -20, 350], [-95, -725, 330],
      [645, -640, 340], [790, 95, 320], [655, 700, 300], [-820, -95, 320],
      [-655, -655, 310],
    ];
    const inDistrict = (x, z) => DISTRICTS.some(([dx, dz, r]) =>
      Math.hypot(x - dx, z - dz) < r + 60);

    // Every vertex, transformed to world space once. `scatter-rock`
    // is comfortably small enough (a few hundred thousand verts at
    // most) to hold in memory in full; no stride needed for CLUSTERING
    // accuracy, only for keeping the grid-hash cheap.
    const pts = [];
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (inDistrict(v.x, v.z)) continue;
      pts.push({ x: v.x, y: v.y, z: v.z, ground: heightAt(v.x, v.z) });
    }

    // Grid-hash flood fill in XZ. CELL is deliberately smaller than a
    // single boulder's own radius (max ~2.9m) so two boulders sitting
    // a metre apart still separate, while all of one boulder's own
    // verts - top, sides, underside cap - fall into connected cells.
    const CELL = 0.9;
    const key = (x, z) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
    const grid = new Map();
    for (const p of pts) {
      const k = key(p.x, p.z);
      let bucket = grid.get(k);
      if (!bucket) { bucket = []; grid.set(k, bucket); }
      bucket.push(p);
    }
    const visited = new Set();
    const clusters = [];
    for (const k0 of grid.keys()) {
      if (visited.has(k0)) continue;
      const stack = [k0];
      visited.add(k0);
      const members = [];
      while (stack.length) {
        const k = stack.pop();
        members.push(...grid.get(k));
        const [gx, gz] = k.split(",").map(Number);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nk = `${gx + dx},${gz + dz}`;
          if (visited.has(nk) || !grid.has(nk)) continue;
          visited.add(nk);
          stack.push(nk);
        }
      }
      if (members.length < 12) continue; // a handful of stray verts, not a rock
      let cx = 0, cz = 0, topY = -Infinity, botY = Infinity, groundY = Infinity;
      for (const m of members) {
        cx += m.x; cz += m.z;
        topY = Math.max(topY, m.y);
        botY = Math.min(botY, m.y);
        groundY = Math.min(groundY, m.ground);
      }
      cx /= members.length; cz /= members.length;
      let spread = 0;
      for (const m of members) spread = Math.max(spread, Math.hypot(m.x - cx, m.z - cz));
      clusters.push({
        x: Number(cx.toFixed(1)), z: Number(cz.toFixed(1)),
        topY: Number(topY.toFixed(2)), botY: Number(botY.toFixed(2)),
        groundY: Number(groundY.toFixed(2)),
        heightAboveGround: Number((topY - groundY).toFixed(2)),
        undergroundDepth: Number((groundY - botY).toFixed(2)),
        spread: Number(spread.toFixed(1)),
        verts: members.length,
      });
    }
    clusters.sort((a, b) => b.verts - a.verts);
    return clusters;
  });

  if (found.error) throw new Error(found.error);
  console.log(`Found ${found.length} vertex clusters in open desert.`);
  await writeFile(path.join(OUT, "_clusters.json"), JSON.stringify(found, null, 2));

  if (manualTarget) {
    // Photograph exactly this one point and stop - skip the automatic
    // pick list entirely.
    const b = manualTarget;
    const tag = "manual";
    const r = Math.max(2.2, b.spread);
    const topMidY = (b.topY + b.groundY) / 2;
    const halfHeight = (b.topY - b.groundY) / 2;
    const settle = async () => { for (let i = 0; i < 3; i += 1) await page.evaluate(() => window.__SF.renderOnce(1 / 60)); };
    await page.evaluate(({ x, z, y, radius }) => window.__SF.safeOrbit(x, z, y, 0.9, radius * 2.3, 0.30, 42),
      { x: b.x, z: b.z, y: topMidY, radius: r });
    await settle();
    await page.screenshot({ path: path.join(OUT, `${tag}-a-hero.png`) });
    for (let bi = 0; bi < 8; bi += 1) {
      const bearing = (bi / 8) * Math.PI * 2;
      await page.evaluate(({ x, z, bearing: bg, camDist, targetY }) => {
        const T = window.__SF;
        const cx = x + Math.cos(bg) * camDist;
        const cz = z + Math.sin(bg) * camDist;
        const cy = T.ctx.terrain.heightAt(cx, cz) + 0.35;
        const farX = x - Math.cos(bg) * camDist * 0.35;
        const farZ = z - Math.sin(bg) * camDist * 0.35;
        T.lookAt([cx, cy, cz], [farX, targetY, farZ], 62);
      }, { x: b.x, z: b.z, bearing, camDist: r * 1.05 + 0.6, targetY: b.groundY + halfHeight * 0.5 });
      await settle();
      await page.screenshot({ path: path.join(OUT, `${tag}-d-under${bi}.png`) });
    }
    console.log(`Wrote manual-target frames to ${path.relative(root, OUT)}`);
    await browser.close();
    server.kill();
    process.exit(0);
  }

  /* A genuine single boulder tops out around radius ~2.9m / height
     ~3.7m (see world.js's Scattering loop: s up to ~2.9, height up to
     1.3x that). Anything far past that is several rocks whose vertex
     clouds merged because they sit close together - which, note, is
     itself a fact worth photographing under "repeats too much". */
  const singles = found.filter((c) => c.spread <= 5.5 && c.heightAboveGround <= 5.5 && c.heightAboveGround > 0.5);
  const clumps = found.filter((c) => c.spread > 5.5 && c.spread < 40);

  /* -------- pick a spread: a few big, a few small, well separated -------- */
  const picks = [];
  const tooClose = (c) => picks.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 30);
  const bySize = [...singles].sort((a, b) => b.spread - a.spread);
  for (const c of bySize) { if (picks.length >= 5) break; if (!tooClose(c)) picks.push(c); }
  const smallOnes = [...singles].sort((a, b) => a.spread - b.spread);
  for (const c of smallOnes) { if (picks.length >= 8) break; if (!tooClose(c)) picks.push(c); }
  // One deliberate "clump" pick, for the repetition-among-neighbours shot.
  if (clumps.length) picks.push({ ...clumps[0], isClump: true });

  console.log(`Photographing ${picks.length} boulders:`);
  for (const p of picks) console.log(`  (${p.x}, ${p.z})  top=${p.topY} ground=${p.groundY} h=${p.heightAboveGround}m underGround=${p.undergroundDepth}m spread=${p.spread}m verts=${p.verts}${p.isClump ? "  [CLUMP]" : ""}`);

  const settle = async () => {
    for (let i = 0; i < 3; i += 1) await page.evaluate(() => window.__SF.renderOnce(1 / 60));
  };

  let n = 0;
  for (const b of picks) {
    n += 1;
    const tag = `boulder-${String(n).padStart(2, "0")}`;
    const r = Math.max(2.2, b.spread);
    const topMidY = (b.topY + b.groundY) / 2;
    const halfHeight = (b.topY - b.groundY) / 2;

    await page.evaluate(({ x, z, y, radius }) => {
      window.__SF.safeOrbit(x, z, y, 0.9, radius * 2.3, 0.30, 42);
    }, { x: b.x, z: b.z, y: topMidY, radius: r });
    await settle();
    await page.screenshot({ path: path.join(OUT, `${tag}-a-hero.png`) });

    // Ground-level profile, as a player walking past would see it.
    await page.evaluate(({ x, z, y, radius }) => {
      window.__SF.safeOrbit(x, z, y, 2.4, radius * 2.0, 0.08, 48);
    }, { x: b.x, z: b.z, y: topMidY, radius: r });
    await settle();
    await page.screenshot({ path: path.join(OUT, `${tag}-b-profile.png`) });

    // High wide establishing shot, to judge repetition among neighbours.
    await page.evaluate(({ x, z, y, radius }) => {
      window.__SF.safeOrbit(x, z, y, 4.2, radius * 5.5 + 20, 0.42, 55);
    }, { x: b.x, z: b.z, y: topMidY, radius: r });
    await settle();
    await page.screenshot({ path: path.join(OUT, `${tag}-c-wide.png`) });

    /* THE UNDERNEATH SHOT. Deliberately UNCHECKED (not safeOrbit) -
       the whole point is to place the lens close to and partly under
       the rock's own footprint, which safeOrbit's line-of-sight
       rejection would treat as blocked and refuse. Camera sits at
       near-crawl height just outside the measured footprint, aimed
       back across the rock's own belly at a point near its top on
       the FAR side, so the ray from lens to target grazes under
       whatever overhang or gap the rock actually has. Four compass
       bearings, because a single-sided embed problem often only
       shows from the low side of a slope. */
    for (let bi = 0; bi < 4; bi += 1) {
      const bearing = (bi / 4) * Math.PI * 2;
      await page.evaluate(({ x, z, groundY, bearing: bg, camDist, targetY }) => {
        const T = window.__SF;
        const cx = x + Math.cos(bg) * camDist;
        const cz = z + Math.sin(bg) * camDist;
        const cy = T.ctx.terrain.heightAt(cx, cz) + 0.35;
        const farX = x - Math.cos(bg) * camDist * 0.35;
        const farZ = z - Math.sin(bg) * camDist * 0.35;
        T.lookAt([cx, cy, cz], [farX, targetY, farZ], 62);
      }, { x: b.x, z: b.z, groundY: b.groundY, bearing, camDist: r * 1.05 + 0.6, targetY: b.groundY + halfHeight * 0.5 });
      await settle();
      await page.screenshot({ path: path.join(OUT, `${tag}-d-under${bi}.png`) });
    }
  }

  await writeFile(path.join(OUT, "_picks.json"), JSON.stringify(picks, null, 2));
  console.log(`\nWrote ${picks.length} boulders' worth of frames to ${path.relative(root, OUT)}`);
  await browser.close();
} finally {
  server.kill();
}
