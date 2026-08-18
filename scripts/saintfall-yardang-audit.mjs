#!/usr/bin/env node
/* ============================================================
   SAINTFALL - yardang audit

   The fifteen wind-carved fins in the open desert (world.js's
   "Carving the yardangs" step) are the only rock formations big
   enough to fill a frame from a hundred metres out, and they are
   the ones a player reports as "that large boulder".

   This finds them in the live scene by their own size - nothing
   else in `scatter-rock` spans more than ~6m - then measures the
   two things a screenshot cannot prove on its own:

     - is the underside CLOSED?  (a hollow shell reads as
       see-through from below, with no geometry bug visible from
       any other angle)
     - does the base ever leave the sand?  (a 200m object placed
       from ONE centre height sits on a dune like a plank on a
       pillow: middle down, both ends in the air)

   Usage:  node scripts/saintfall-yardang-audit.mjs --out output/saintfall/yardang/before
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
    if (!t.startsWith("--")) continue;
    const k = t.slice(2);
    const n = argv[i + 1];
    if (n === undefined || n.startsWith("--")) args[k] = true;
    else { args[k] = n; i += 1; }
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(root, args.out || "output/saintfall/yardang/latest");
const PORT = 49900 + (process.pid % 600);
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

  const found = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const heightAt = T.ctx.terrain.heightAt;
    const mesh = T.ctx.scene.getObjectByName("scatter-rock");
    if (!mesh) return { error: "no scatter-rock mesh" };
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const v = new THREE.Vector3();

    /* Cluster on a coarse grid: yardangs are hundreds of metres
       long and hundreds of metres apart, so a 6m cell separates
       them from each other and from every 3m scatter rock without
       tearing one fin into pieces. */
    const CELL = 6;
    const grid = new Map();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const k = `${Math.round(v.x / CELL)},${Math.round(v.z / CELL)}`;
      let b = grid.get(k);
      if (!b) { b = []; grid.set(k, b); }
      b.push(i);
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
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            const nk = `${gx + dx},${gz + dz}`;
            if (visited.has(nk) || !grid.has(nk)) continue;
            visited.add(nk);
            stack.push(nk);
          }
        }
      }
      if (members.length < 60) continue;
      let cx = 0, cz = 0, topY = -Infinity, botY = Infinity;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const i of members) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        cx += v.x; cz += v.z;
        topY = Math.max(topY, v.y); botY = Math.min(botY, v.y);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      }
      cx /= members.length; cz /= members.length;
      const span = Math.max(maxX - minX, maxZ - minZ);
      if (span < 40) continue;   // not a yardang
      clusters.push({
        x: +cx.toFixed(1), z: +cz.toFixed(1), span: +span.toFixed(1),
        topY: +topY.toFixed(2), botY: +botY.toFixed(2),
        verts: members.length, members,
        bbox: [+minX.toFixed(1), +minZ.toFixed(1), +maxX.toFixed(1), +maxZ.toFixed(1)],
      });
    }

    /* -------- the two measurements -------- */
    const memberSet = new Set();
    for (const c of clusters) for (const i of c.members) memberSet.add(i);
    // Downward-facing triangle area per cluster: a closed solid has
    // roughly as much downward-facing area as upward. A shell with
    // no bottom cap has almost none.
    const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    const owner = new Map();
    clusters.forEach((c, ci) => { for (const i of c.members) owner.set(i, ci); });
    const upArea = new Array(clusters.length).fill(0);
    const downArea = new Array(clusters.length).fill(0);
    for (let t = 0; t < idx.count; t += 3) {
      const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
      const ci = owner.get(i0);
      if (ci === undefined) continue;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      cc.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      ab.subVectors(b, a); ac.subVectors(cc, a);
      n.crossVectors(ab, ac);
      const area = n.length() * 0.5;
      if (n.y > 0) upArea[ci] += area; else downArea[ci] += area;
    }

    const out = [];
    clusters.forEach((c, ci) => {
      // Sample the base ring: lowest vertex per angular bin, and how
      // far it sits above the sand there.
      let worstGap = -Infinity, worstAt = null;
      let buried = 0, floating = 0, samples = 0;
      for (const i of c.members) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.y > c.botY + (c.topY - c.botY) * 0.10) continue;   // lower band only
        const g = heightAt(v.x, v.z);
        const gap = v.y - g;
        samples += 1;
        if (gap > 0.25) floating += 1; else buried += 1;
        if (gap > worstGap) { worstGap = gap; worstAt = [+v.x.toFixed(1), +v.z.toFixed(1)]; }
      }
      out.push({
        x: c.x, z: c.z, span: c.span, topY: c.topY, botY: c.botY,
        groundAtCentre: +heightAt(c.x, c.z).toFixed(2),
        height: +(c.topY - heightAt(c.x, c.z)).toFixed(2),
        verts: c.verts,
        upArea: Math.round(upArea[ci]), downArea: Math.round(downArea[ci]),
        downRatio: +(downArea[ci] / (upArea[ci] || 1)).toFixed(3),
        baseSamples: samples,
        baseFloatingPct: +(100 * floating / (samples || 1)).toFixed(1),
        worstGap: +worstGap.toFixed(2), worstAt,
        bbox: c.bbox,
      });
    });
    out.sort((a2, b2) => b2.span - a2.span);
    return out;
  });

  if (found.error) throw new Error(found.error);
  console.log(`Found ${found.length} yardang-scale formations.\n`);
  for (const y of found) {
    console.log(`  (${y.x}, ${y.z})  span=${y.span}m  h=${y.height}m  ` +
      `down/up area=${y.downRatio}  base floating ${y.baseFloatingPct}% (worst gap ${y.worstGap}m)`);
  }
  await writeFile(path.join(OUT, "_yardangs.json"), JSON.stringify(found, null, 2));

  const settle = async () => {
    for (let i = 0; i < 3; i += 1) await page.evaluate(() => window.__SF.renderOnce(1 / 60));
  };

  const picks = found.slice(0, Number(args.shots || 4));
  let n = 0;
  for (const y of picks) {
    n += 1;
    const tag = `yardang-${String(n).padStart(2, "0")}`;
    const midY = (y.topY + y.groundAtCentre) / 2;
    const r = y.span * 0.8;

    // Broadside hero, the framing the player had.
    await page.evaluate(({ x, z, yy, radius }) =>
      window.__SF.safeOrbit(x, z, yy, 0.7, radius, 0.16, 55), { x: y.x, z: y.z, yy: midY, radius: r });
    await settle();
    await page.screenshot({ path: path.join(OUT, `${tag}-a-hero.png`) });

    // End-on, down the wind axis.
    await page.evaluate(({ x, z, yy, radius }) =>
      window.__SF.safeOrbit(x, z, yy, 2.9, radius, 0.12, 55), { x: y.x, z: y.z, yy: midY, radius: r });
    await settle();
    await page.screenshot({ path: path.join(OUT, `${tag}-b-endon.png`) });

    /* THE PLAYER'S FRAMING. Eye height on the sand, far enough out
       that the whole fin is in frame - which is the shot the report
       came in on, and the only one that judges the silhouette the
       way a player meets it. */
    for (let bi = 0; bi < 4; bi += 1) {
      const bearing = (bi / 4) * Math.PI * 2 + 0.5;
      await page.evaluate(({ x, z, bearing: bg, d, aimY }) => {
        const T = window.__SF;
        const cx = x + Math.cos(bg) * d;
        const cz = z + Math.sin(bg) * d;
        const cy = T.ctx.terrain.heightAt(cx, cz) + 1.7;
        T.lookAt([cx, cy, cz], [x, aimY, z], 60);
      }, { x: y.x, z: y.z, bearing, d: y.span * 0.95 + 30, aimY: y.groundAtCentre + (y.topY - y.groundAtCentre) * 0.35 });
      await settle();
      await page.screenshot({ path: path.join(OUT, `${tag}-c-eye${bi}.png`) });
    }

    /* THE UNDERNEATH SHOT. Stand at the worst measured base gap -
       the point the base ring came closest to leaving the sand - at
       crouch height, and look ACROSS the fin's foot. If the shell is
       open, or the base has lifted, this is the frame that shows
       sky where the rock should meet the ground. */
    if (y.worstAt) {
      const [wx, wz] = y.worstAt;
      for (let bi = 0; bi < 3; bi += 1) {
        const bearing = (bi / 3) * Math.PI * 2;
        await page.evaluate(({ wx: ax, wz: az, bearing: bg, cxT, czT }) => {
          const T = window.__SF;
          const d = 30;
          const cx = ax + Math.cos(bg) * d;
          const cz = az + Math.sin(bg) * d;
          const cy = T.ctx.terrain.heightAt(cx, cz) + 0.9;
          T.lookAt([cx, cy, cz], [cxT, T.ctx.terrain.heightAt(cxT, czT) + 2, czT], 62);
        }, { wx, wz, bearing, cxT: y.x, czT: y.z });
        await settle();
        await page.screenshot({ path: path.join(OUT, `${tag}-d-under${bi}.png`) });
      }
    }
  }
  console.log(`\nWrote frames to ${path.relative(root, OUT)}`);
  await browser.close();
} finally {
  server.kill();
}
