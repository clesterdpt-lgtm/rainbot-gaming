#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Fallen Saint, photographed

   The map's ONE dominant landmark, and the thing every district is
   composed around. It has to survive being looked at from four
   distances, because it is seen from all of them:

     1. from the drop, ~950m out, through haze, against bright sky -
        where only the silhouette exists;
     2. from the road at 200-300m, where the face has to resolve
        into a face;
     3. from the pilgrim camp at its base, where a player stands
        under a hundred metres of bronze and looks up;
     4. from arm's reach, where the surface either has craft on it
        or is a flat-shaded shell.

   Plus its three scattered fragments - the Reaching Hand, the
   Breastplate, the camp - which are the same statue and must read
   as the same METAL.

   Usage:  node scripts/saintfall-saint-shots.mjs
           node scripts/saintfall-saint-shots.mjs --out output/saintfall/saint-shots/after
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
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
const OUT = path.resolve(root, args.out || "output/saintfall/saint-shots/latest");
const PORT = 49610 + (process.pid % 300);
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

  /* Measure the actual pieces rather than restating their authored
     coordinates - a landmark that moves in world.js must not leave
     this harness quietly photographing empty desert. */
  const site = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const scene = T.ctx.scene;
    const out = {};
    for (const name of ["saint-bronze", "saint-rust", "saint-cloth"]) {
      const mesh = scene.getObjectByName(name);
      if (!mesh) continue;
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      out[name] = { min: bb.min.toArray(), max: bb.max.toArray() };
    }
    /* The bronze bin holds head + hand + breastplate merged, so its
       bounding box spans hundreds of metres and is useless as a
       framing target. Cluster its vertices in XZ instead and keep
       the three biggest lumps - which IS the head, the hand and the
       breastplate, without this file having to know where they are. */
    const mesh = scene.getObjectByName("saint-bronze");
    const pos = mesh.geometry.attributes.position;
    const v = new THREE.Vector3();
    mesh.updateWorldMatrix(true, false);
    const CELL = 40;
    const grid = new Map();
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const k = `${Math.round(v.x / CELL)},${Math.round(v.z / CELL)}`;
      let b = grid.get(k);
      if (!b) { b = { n: 0, x: 0, z: 0, top: -Infinity }; grid.set(k, b); }
      b.n += 1; b.x += v.x; b.z += v.z; b.top = Math.max(b.top, v.y);
    }
    // Merge adjacent cells so one object split across a cell
    // boundary is not reported as two.
    const cells = [...grid.entries()].map(([k, b]) => {
      const [gx, gz] = k.split(",").map(Number);
      return { gx, gz, ...b, x: b.x / b.n, z: b.z / b.n };
    });
    const seen = new Set();
    const clusters = [];
    for (const c of cells) {
      const key = `${c.gx},${c.gz}`;
      if (seen.has(key)) continue;
      const stack = [c];
      seen.add(key);
      const members = [];
      while (stack.length) {
        const cur = stack.pop();
        members.push(cur);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nk = `${cur.gx + dx},${cur.gz + dz}`;
          if (seen.has(nk)) continue;
          const nb = cells.find((q) => q.gx === cur.gx + dx && q.gz === cur.gz + dz);
          if (!nb) continue;
          seen.add(nk);
          stack.push(nb);
        }
      }
      let n = 0, x = 0, z = 0, top = -Infinity;
      for (const m of members) { n += m.n; x += m.x * m.n; z += m.z * m.n; top = Math.max(top, m.top); }
      clusters.push({ x: x / n, z: z / n, top, verts: n });
    }
    clusters.sort((a, b) => b.verts - a.verts);
    out.pieces = clusters.slice(0, 3).map((c) => ({
      x: Number(c.x.toFixed(1)), z: Number(c.z.toFixed(1)),
      top: Number(c.top.toFixed(1)),
      ground: Number(T.ctx.terrain.heightAt(c.x, c.z).toFixed(1)),
      verts: c.verts,
    }));
    return out;
  });
  console.log("Saint pieces (biggest first):");
  for (const p of site.pieces) console.log(`  (${p.x}, ${p.z})  top=${p.top}  ground=${p.ground}  verts=${p.verts}`);

  const settle = async () => { for (let i = 0; i < 3; i += 1) await page.evaluate(() => window.__SF.renderOnce(1 / 60)); };
  const shot = async (name) => { await settle(); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };

  // The head is the biggest piece by a wide margin.
  const head = site.pieces[0];
  const headMidY = (head.top + head.ground) / 2;

  /* 01-04: the four distances the landmark is actually seen from.
     Bearing 2.2rad is the road's western approach, which world.js
     says the face was deliberately turned toward. */
  const APPROACH = 2.2;
  for (const [name, radius, pitch, fov] of [
    ["01-from-the-drop", 780, 0.16, 40],
    ["02-from-the-road", 260, 0.14, 46],
    ["03-from-the-camp", 95, 0.10, 62],
    ["04-arms-reach", 46, 0.02, 70],
  ]) {
    await page.evaluate(({ x, z, y, bearing, radius, pitch, fov }) => {
      window.__SF.safeOrbit(x, z, y, bearing, radius, pitch, fov);
    }, { x: head.x, z: head.z, y: headMidY, bearing: APPROACH, radius, pitch, fov });
    await shot(name);
  }

  // 05: looking UP at the face from directly beneath its chin, the
  // angle a player at the camp actually has.
  await page.evaluate(({ x, z, ground, top }) => {
    const T = window.__SF;
    const camX = x + 52;
    const camZ = z + 40;
    const cy = T.ctx.terrain.heightAt(camX, camZ) + 1.7;
    T.lookAt([camX, cy, camZ], [x, ground + (top - ground) * 0.72, z], 74);
  }, { x: head.x, z: head.z, ground: head.ground, top: head.top });
  await shot("05-looking-up");

  // 06-13: a full ring at mid height, so no bearing hides a defect.
  for (let i = 0; i < 8; i += 1) {
    const bearing = (i / 8) * Math.PI * 2;
    await page.evaluate(({ x, z, y, bearing }) => {
      window.__SF.safeOrbit(x, z, y, bearing, 170, 0.12, 48);
    }, { x: head.x, z: head.z, y: headMidY, bearing });
    await shot(`ring-${String(i).padStart(2, "0")}`);
  }

  /* The two scattered fragments, which must read as the same METAL
     as the head - they are pieces of it.

     Framed from the world's own POI table rather than from the
     vertex clustering above. The clusterer chains across any bronze
     debris lying between two landmarks, so at a 40m cell it happily
     merged the Hand and the Breastplate into the head's own blob and
     then offered two stray shards as "the fragments" - which is how
     an earlier run photographed a 17-vertex splinter and reported
     the Breastplate unchanged. */
  const fragments = await page.evaluate(() => {
    const T = window.__SF;
    const wanted = ["saint-hand", "saint-shell"];
    return (T.ctx.world?.pois || [])
      .filter((p) => wanted.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name, x: p.x, z: p.z, ground: T.ctx.terrain.heightAt(p.x, p.z) }));
  });
  for (const f of fragments) console.log(`  fragment ${f.id} at (${f.x}, ${f.z})`);
  for (const [i, f] of fragments.entries()) {
    await page.evaluate(({ x, z, y }) => {
      window.__SF.safeOrbit(x, z, y, 1.1, 78, 0.16, 50);
    }, { x: f.x, z: f.z, y: f.ground + 14 });
    await shot(`2${i}-${f.id}`);
  }

  console.log(`\nWrote frames to ${path.relative(root, OUT)}`);
  await browser.close();
} finally {
  server.kill();
}
