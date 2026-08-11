#!/usr/bin/env node
/* ============================================================
   BLACKSAND - built-surface scale and repetition probe

   Answers one question no beauty shot can: how big, in centimetres of
   world space, is a single masonry unit on our walls?

   Brick is the only object in a game frame whose true size every
   viewer knows by heart, so it silently calibrates the whole scene. If
   our courses are double size, every building reads as a doll's house
   and the viewer feels it without being able to name it. That fault is
   authoring, not rendering - no lighting change reaches it.

   What it measures:

   1. METRES PER UV UNIT, per structures material, read off the merged
      geometry the scene actually draws. For each triangle, the world
      length of an edge divided by its UV length. Multiplied by the
      generator's own grid (blockwall is 4 columns x 8 rows per tile)
      this gives the block's world size directly. Reported as a
      histogram, because the interesting failure is not a wrong median
      but a WIDE SPREAD: a sill sampling the same masonry at 2.5x the
      rate of the wall it sits in is a wall whose bricks change size.

   2. TILE REPETITION, by autocorrelation of the rendered luma along a
      wall's own horizontal axis. A perfectly periodic wall spikes at
      the tile period; a wall with macro variation does not.

   3. Wall-filling captures at 3, 6 and 15m with an exact scale ruler
      composited in - 1.8m (a soldier), 2.0m (a door) and 0.88m (an oil
      drum) at the wall's own distance, computed from the camera's fov
      and the measured standoff. That is the honest version of "count
      the courses against something you know".

   Usage:
     node scripts/blacksand-scale-probe.mjs
     node scripts/blacksand-scale-probe.mjs --out output/blacksand-scale/after
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

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
const OUT = path.resolve(root, String(args.out || "output/blacksand-scale/latest"));
const QUALITY = String(args.quality || "ultra");
const HOUR = args.hour === undefined ? 8.6 : Number(args.hour);
const PORT = Number(args.port || 43000 + (process.pid % 9000));
const BASE = `http://127.0.0.1:${PORT}`;
const URL_GAME = `${BASE}/games/blacksand.html?qa=1&quality=${QUALITY}`;
const WIDTH = 1280;
const HEIGHT = 900;

/** The generator grid each texture was authored on: [cols, rows] per
 *  tile. Kept in step with UV_PHASE in structures.js and with the
 *  ROWS/COLS constants in textures.js. */
const GRID = {
  blockwall: { cols: 4, rows: 8, unit: "block", realCm: [39, 19] },
  concrete: { cols: 2, rows: 7, unit: "board bay", realCm: [null, 20] },
};

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const r = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (r.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* ------------------------ in-page measurement ------------------------ */

/**
 * Metres of world space per UV unit, per structures mesh.
 *
 * Runs on the merged buffers, so it reports what is drawn rather than
 * what a call site intended. Sampling every Nth triangle rather than
 * all of them: a town is a million triangles and the distribution
 * converges in a few thousand.
 */
function measureUvRate() {
  const T = window.__BS;
  const out = {};
  T.ctx.render.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.name.startsWith("structures-")) return;
    const name = obj.name.replace("structures-", "");
    if (name === "contact") return;
    const g = obj.geometry;
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    if (!pos || !uv) return;
    const index = g.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    const stride = Math.max(1, Math.floor(triCount / 4000));
    const rates = out[name] || (out[name] = []);
    for (let t = 0; t < triCount; t += stride) {
      const a = index ? index.getX(t * 3) : t * 3;
      const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      // Two edges per triangle, so a box face contributes both its u
      // and its v rate; a single edge would miss an anisotropic UV.
      for (const [i, j] of [[a, b], [b, index ? index.getX(t * 3 + 2) : t * 3 + 2]]) {
        const dx = pos.getX(i) - pos.getX(j);
        const dy = pos.getY(i) - pos.getY(j);
        const dz = pos.getZ(i) - pos.getZ(j);
        const du = uv.getX(i) - uv.getX(j);
        const dv = uv.getY(i) - uv.getY(j);
        const world = Math.hypot(dx, dy, dz);
        const tex = Math.hypot(du, dv);
        if (world > 1e-3 && tex > 1e-5) rates.push(world / tex);
      }
    }
  });
  return out;
}

/**
 * Camera poses that fill the frame with one wall.
 *
 * Picks triangles whose normal is within 15 degrees of horizontal
 * (a wall face, not a roof or a sill top), then stands on the normal
 * at `standoff` metres at eye height. Rejects anything with something
 * else in the way, because a probe that photographs a parked truck
 * proves nothing about masonry.
 */
function findWallPoses(material, standoffs) {
  const T = window.__BS;
  const THREE = T.THREE;
  const mesh = (() => {
    let found = null;
    let best = 0;
    T.ctx.render.scene.traverse((o) => {
      if (o.isMesh && o.name === `structures-${material}`) {
        const n = o.geometry.attributes.position.count;
        if (n > best) { best = n; found = o; }
      }
    });
    return found;
  })();
  if (!mesh) return [];

  const g = mesh.geometry;
  const pos = g.attributes.position;
  const index = g.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const targets = [];
  T.ctx.render.scene.traverse((o) => {
    if (o.isMesh && o.visible && o.userData.qaOpaque !== false) targets.push(o);
  });

  const results = [];
  const stride = Math.max(1, Math.floor(triCount / 2500));
  for (let t = 0; t < triCount && results.length < standoffs.length; t += stride) {
    const ia = index ? index.getX(t * 3) : t * 3;
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    A.fromBufferAttribute(pos, ia);
    B.fromBufferAttribute(pos, ib);
    C.fromBufferAttribute(pos, ic);
    ab.subVectors(B, A);
    ac.subVectors(C, A);
    n.crossVectors(ab, ac);
    if (n.lengthSq() < 1e-6) continue;
    n.normalize();
    if (Math.abs(n.y) > 0.26) continue;                       // not a wall face
    if (ab.length() < 2 || ac.length() < 2) continue;         // not a big panel
    centre.copy(A).add(B).add(C).multiplyScalar(1 / 3);

    const standoff = standoffs[results.length];
    const eye = centre.clone().addScaledVector(n, standoff);
    eye.y = T.ctx.terrain.heightAt(eye.x, eye.z) + 1.65;
    const aim = centre.clone();
    aim.y = eye.y;

    // Reject if the line of sight is blocked, or if the wall is not
    // actually where we think it is.
    const dir = aim.clone().sub(eye).normalize();
    raycaster.set(eye, dir);
    raycaster.far = standoff * 1.6;
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) continue;
    if (hits[0].object !== mesh) continue;
    if (Math.abs(hits[0].distance - standoff) > standoff * 0.45) continue;

    results.push({
      standoff,
      distance: Number(hits[0].distance.toFixed(3)),
      position: eye.toArray(),
      target: aim.toArray(),
    });
  }
  return results;
}

/* --------------------------- image analysis --------------------------- */

async function decode(dataUrl) {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(buf).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const luma = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    luma[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
  }
  return { w: info.width, h: info.height, luma, png: buf };
}

/**
 * Normalised autocorrelation of the mean column profile.
 *
 * A tiled wall is periodic in screen space, and the period is where
 * the correlation spikes. Reported as the strongest peak beyond a
 * 12px lag and the lag it sits at, so "the module repeats with a
 * visible seam" becomes a number.
 */
function tilePeriodicity(img, band = 0.5) {
  const y0 = Math.floor(img.h * (0.5 - band * 0.5));
  const y1 = Math.floor(img.h * (0.5 + band * 0.5));
  const col = new Float64Array(img.w);
  for (let x = 0; x < img.w; x += 1) {
    let s = 0;
    for (let y = y0; y < y1; y += 1) s += img.luma[y * img.w + x];
    col[x] = s / (y1 - y0);
  }
  let mean = 0;
  for (let x = 0; x < img.w; x += 1) mean += col[x];
  mean /= img.w;
  let energy = 0;
  for (let x = 0; x < img.w; x += 1) { col[x] -= mean; energy += col[x] * col[x]; }
  if (energy < 1e-6) return { peak: 0, lag: 0 };
  let best = 0;
  let bestLag = 0;
  const maxLag = Math.floor(img.w * 0.45);
  for (let lag = 12; lag < maxLag; lag += 1) {
    let s = 0;
    for (let x = 0; x + lag < img.w; x += 1) s += col[x] * col[x + lag];
    const r = s / energy;
    if (r > best) { best = r; bestLag = lag; }
  }
  return { peak: Number(best.toFixed(4)), lag: bestLag };
}

/** A scale ruler at the wall's own distance, so a course count can be
 *  checked against something whose height nobody argues about. */
async function annotate(png, w, h, distance, fovDeg, file) {
  const halfH = Math.tan((fovDeg * Math.PI) / 360) * distance;
  const pxPerMetre = (h * 0.5) / halfH;
  const refs = [
    { m: 2.0, label: "door 2.0m", fill: "#ff3b30" },
    { m: 1.8, label: "soldier 1.8m", fill: "#ffcc00" },
    { m: 0.88, label: "oil drum 0.88m", fill: "#34c759" },
  ];
  let x = 26;
  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`;
  for (const r of refs) {
    const px = r.m * pxPerMetre;
    const y = h - 30 - px;
    svg += `<rect x="${x}" y="${y}" width="12" height="${px}" fill="${r.fill}" fill-opacity="0.85"/>`
      + `<rect x="${x - 8}" y="${y - 2}" width="28" height="3" fill="${r.fill}"/>`
      + `<rect x="${x - 8}" y="${h - 31}" width="28" height="3" fill="${r.fill}"/>`
      + `<text x="${x + 22}" y="${y + 14}" font-family="monospace" font-size="15"`
      + ` fill="${r.fill}" stroke="#000" stroke-width="0.6">${r.label}</text>`;
    x += 150;
  }
  svg += `<text x="26" y="26" font-family="monospace" font-size="15" fill="#fff"`
    + ` stroke="#000" stroke-width="0.6">wall at ${distance.toFixed(2)}m,`
    + ` ${pxPerMetre.toFixed(1)} px/m</text></svg>`;
  await sharp(png)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toFile(file);
}

/* ------------------------------- stats ------------------------------- */

function summarise(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    p05: at(0.05), p25: at(0.25), median: at(0.5), p75: at(0.75), p95: at(0.95),
  };
}

/** How many distinct sampling rates a material is drawn at, and what
 *  share of its surface sits at each. The wall/sill mismatch shows up
 *  here as two fat modes rather than one. */
function modes(values, tolerance = 0.06) {
  const buckets = new Map();
  for (const v of values) {
    const k = Math.round(Math.log(v) / tolerance);
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  return [...buckets.entries()]
    .map(([k, n]) => ({ metres: Math.exp(k * tolerance), share: n / values.length }))
    .filter((m) => m.share > 0.02)
    .sort((a, b) => b.share - a.share)
    .slice(0, 6);
}

/* -------------------------------- run -------------------------------- */

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  const report = { quality: QUALITY, hour: HOUR, materials: {}, poses: [] };

  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: [
        "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--force-device-scale-factor=1",
        "--hide-scrollbars", "--mute-audio",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(URL_GAME, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 240000 });
    await page.evaluate(() => {
      window.__BS.maximize();
      window.__BS.hideHud(true);
      window.__BS.hideViewmodel(true);
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await page.evaluate((h) => {
      window.__BS.setTimeOfDay(h);
      window.__BS.advanceTime(3, 1 / 60);
    }, HOUR);

    // Ship the pose finder into the page. It walks a million-triangle
    // merged buffer, which is far too much to hand back over the CDP
    // bridge one vertex at a time.
    await page.evaluate(`window.__bsFindWalls = ${findWallPoses.toString()}`);

    /* ---- 1. UV rate, i.e. how big a masonry unit really is ---- */

    const rates = await page.evaluate(measureUvRate);
    for (const [name, values] of Object.entries(rates)) {
      const stats = summarise(values);
      if (!stats) continue;
      const entry = { tileMetres: stats, modes: modes(values) };
      const grid = GRID[name];
      if (grid) {
        entry.unit = grid.unit;
        entry.unitCm = {
          long: Number((stats.median / grid.cols * 100).toFixed(1)),
          high: Number((stats.median / grid.rows * 100).toFixed(1)),
        };
        entry.realCm = grid.realCm;
        entry.spreadCm = {
          long: entry.modes.map((m) => Number((m.metres / grid.cols * 100).toFixed(1))),
          high: entry.modes.map((m) => Number((m.metres / grid.rows * 100).toFixed(1))),
        };
      }
      report.materials[name] = entry;
    }

    /* ---- 2 and 3. wall-filling captures with a scale ruler ---- */

    const fov = 55;
    for (const material of ["blockwall", "concrete", "plaster"]) {
      const poses = await page.evaluate(
        ([m, s]) => window.__bsFindWalls(m, s), [material, [3, 6, 15]]
      ).catch(() => []);
      for (const pose of poses) {
        await page.evaluate((p) => {
          window.__BS.lookAt(p.position, p.target, 55);
          for (let i = 0; i < 4; i += 1) window.__BS.renderOnce(1 / 60);
        }, pose);
        const img = await decode(await page.evaluate(() => window.__BS.captureDataURL()));
        const file = path.join(OUT, `${material}-${pose.standoff}m.png`);
        await annotate(img.png, img.w, img.h, pose.distance, fov, file);
        report.poses.push({
          material,
          standoff: pose.standoff,
          distance: pose.distance,
          periodicity: tilePeriodicity(img),
          file: path.relative(root, file),
        });
      }
    }

    /* Draw cost from FIXED poses, not from wherever the last capture
     * left the camera: calls and triangles are per-frame and frustum
     * culled, so a close-up of a wall and a wide vista differ by 2x for
     * reasons that have nothing to do with the change under test. */
    report.draw = {};
    for (const pose of ["establishing", "street", "market"]) {
      const ok = await page.evaluate((p) => window.__BS.setPose(p), pose);
      if (!ok) continue;
      await page.evaluate(() => { for (let i = 0; i < 4; i += 1) window.__BS.renderOnce(1 / 60); });
      const s = await page.evaluate(() => window.__BS.report().render);
      report.draw[pose] = { calls: s.calls, triangles: s.triangles, textures: s.textures };
    }
    /* The grade is being reworked by another agent this round. Recording
     * it makes a "why did that move?" answerable instead of a guess. */
    report.grade = await page.evaluate(() => window.__BS.grade());
    report.structures = await page.evaluate(() => window.__BS.ctx.structures.report());
    report.pageErrors = errors;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }

  await writeFile(path.join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log("\n--- world-space sampling rate (metres of wall per texture tile) ---");
  for (const [name, m] of Object.entries(report.materials)) {
    const t = m.tileMetres;
    console.log(`${name.padEnd(11)} tile ${t.median.toFixed(3)}m`
      + `  p05..p95 ${t.p05.toFixed(2)}..${t.p95.toFixed(2)}`);
    if (m.unitCm) {
      console.log(`${"".padEnd(11)} ${m.unit}: ${m.unitCm.long}cm long x ${m.unitCm.high}cm high`
        + `   (real ${m.realCm[0] ?? "-"} x ${m.realCm[1]}cm)`);
      console.log(`${"".padEnd(11)} modes: `
        + m.modes.map((mm, i) => `${(mm.share * 100).toFixed(0)}% @${m.spreadCm.high[i]}cm`).join("  "));
    }
  }
  console.log("\n--- tile periodicity in the rendered frame (1.0 = perfectly repeating) ---");
  for (const p of report.poses) {
    console.log(`${p.material.padEnd(11)} ${String(p.standoff).padStart(2)}m`
      + `  peak ${p.periodicity.peak.toFixed(3)} @ lag ${p.periodicity.lag}px`);
  }
  if (report.structures) {
    const s = report.structures;
    console.log(`\nstructures: ${s.pieces} pieces, ${s.triangles} triangles,`
      + ` ${s.chamfered} chamfered (+${s.chamferTriangles} tris)`);
    console.log(`  merged meshes by material: ${JSON.stringify(s.meshesByMaterial)}`);
  }
  console.log("\n--- draw cost at fixed poses ---");
  for (const [pose, d] of Object.entries(report.draw)) {
    console.log(`${pose.padEnd(13)} calls ${String(d.calls).padStart(4)}`
      + `   triangles ${String(d.triangles).padStart(8)}   textures ${d.textures}`);
  }
  if (report.pageErrors.length) {
    console.error(`\n${report.pageErrors.length} page error(s):`);
    for (const e of report.pageErrors) console.error(`  ${e}`);
  }
  console.log(`\nartifacts -> ${path.relative(root, OUT)}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
