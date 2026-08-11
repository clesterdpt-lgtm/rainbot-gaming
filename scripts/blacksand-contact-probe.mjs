#!/usr/bin/env node
/* ============================================================
   BLACKSAND - close-range contact / seating probe

   The reviewer's strongest complaint is about the ONE thing no beauty
   shot ever frames: what a prop looks like in the last 30cm before it
   meets the ground. "Objects are shadowed but not seated. Where props
   meet ground there is a hard seam and no darkening."

   Contact-shadow code exists in structures.js and foliage.js, so the
   useful question is not "is there a system" but "how many millivalues
   of darkening actually land on the sand at the prop's own edge". This
   measures that two independent ways, because each catches a different
   failure:

   1. ANALYTIC. Walk the merged `structures-contact` mesh directly and
      read the vertex colour stream as a function of normalised radius.
      This is the authored intent with the renderer taken out of the
      loop - if the authored curve puts all its darkening under the
      prop, no amount of shading work will make the edge read.

   2. FRAMEBUFFER. Park the camera 3m from a prop, low, and sample
      ground luma on a radial fan out from the prop's footprint: at the
      edge, then 0.15 / 0.4 / 0.8 / 2.0m out. Samples in the sun's cast
      shadow are DISCARDED, so what is left is pure ambient occlusion -
      the term the reviewer says is missing. A seated object shows a
      monotone ramp from dark at the edge to full value at 2m.

   Both are reported per archetype, and a close-range PNG is written
   per prop so the numbers can be checked against an actual image.

   Usage:
     node scripts/blacksand-contact-probe.mjs
     node scripts/blacksand-contact-probe.mjs --out output/blacksand-contact/r1
     node scripts/blacksand-contact-probe.mjs --quality high --shots 0
   ============================================================ */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
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
const PORT = Number(args.port || 47000 + (process.pid % 1500));
const BASE = `http://127.0.0.1:${PORT}`;
const QUALITY = String(args.quality || "ultra");
const OUT = path.resolve(root, String(args.out || "output/blacksand-contact/latest"));
const SHOTS = args.shots === "0" ? 0 : Number(args.shots || 6);
const AB = Boolean(args.ab);
const BIG = Boolean(args.big);

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (r.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

function toLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

async function grab(page) {
  const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(buf).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const read = (u, v, spread = 1) => {
    const cx = Math.round(u * (info.width - 1));
    const cy = Math.round(v * (info.height - 1));
    let sum = 0;
    let n = 0;
    for (let dy = -spread; dy <= spread; dy += 1) {
      for (let dx = -spread; dx <= spread; dx += 1) {
        const x = Math.min(info.width - 1, Math.max(0, cx + dx));
        const y = Math.min(info.height - 1, Math.max(0, cy + dy));
        const i = (y * info.width + x) * 3;
        sum += 0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1])
          + 0.0722 * toLinear(data[i + 2]);
        n += 1;
      }
    }
    return sum / n;
  };
  read.png = buf;
  return read;
}

/* ---------------------------------------------------------------
   1: analytic - what does the authored blob curve actually deliver
   --------------------------------------------------------------- */

function analyseBlobs() {
  const T = window.__BS;
  const scene = T.ctx.render.scene;
  const out = { structures: null, foliage: null };

  // Structures merge per material PER 176m CELL, so there is one
  // `structures-contact` mesh per populated cell, not one in total.
  const meshes = [];
  scene.traverse((o) => { if (o.name === "structures-contact") meshes.push(o); });
  if (meshes.length) {
    // 8x8: four skirt rows and the silhouette row, mirrored. Must match
    // the row list in structures.js buildContactShadows().
    const N = 8;
    const perBlob = N * N;
    let blobs = 0;
    // Darkening (1 - green channel) binned by normalised radius, where
    // radius is max(|u|,|v|) on the blob's own grid - the same quantity
    // the falloff is authored against.
    // Binned by RING index rather than by a normalised radius, so the
    // readout survives a change of grid resolution or row spacing:
    // ring 0 is the outer rim, the innermost ring is the plateau under
    // the object. `metres` is that ring's own inset from the rim, which
    // is what decides whether a viewer can see the gradient at all.
    const bins = new Map();
    const halves = [];
    for (const mesh of meshes) {
      const pos = mesh.geometry.attributes.position;
      const col = mesh.geometry.attributes.color;
      const n = Math.floor(pos.count / perBlob);
      blobs += n;
      for (let b = 0; b < n; b += 1) {
        const base = b * perBlob;
        let minX = Infinity; let maxX = -Infinity;
        for (let k = base; k < base + perBlob; k += 1) {
          minX = Math.min(minX, pos.getX(k));
          maxX = Math.max(maxX, pos.getX(k));
        }
        const half = (maxX - minX) * 0.5;
        halves.push(half);
        for (let j = 0; j < N; j += 1) {
          for (let i = 0; i < N; i += 1) {
            const k = base + j * N + i;
            const ring = Math.min(i, j, N - 1 - i, N - 1 - j);
            if (!bins.has(ring)) bins.set(ring, { dark: [], inset: [] });
            const e = bins.get(ring);
            e.dark.push(1 - col.getY(k));
            e.inset.push(half - Math.abs(pos.getX(k) - (minX + half)));
          }
        }
      }
    }
    halves.sort((a, b) => a - b);
    const mid = (list) => {
      list.sort((a, b) => a - b);
      return list[Math.floor(list.length / 2)];
    };
    const curve = [...bins.entries()]
      .map(([ring, e]) => ({
        ring: Number(ring),
        median: mid(e.dark),
        inset: mid(e.inset),
      }))
      .sort((a, b) => a.ring - b.ring);
    out.structures = {
      meshes: meshes.length,
      blobs,
      medianHalfExtent: halves[Math.floor(halves.length / 2)] || 0,
      minHalfExtent: halves[0] || 0,
      maxHalfExtent: halves[halves.length - 1] || 0,
      curve,
    };
  }

  let fol = null;
  scene.traverse((o) => { if (o.name === "foliage-contact") fol = o; });
  if (fol) {
    const m = new (T.THREE.Matrix4)();
    const s = new (T.THREE.Vector3)();
    const p = new (T.THREE.Vector3)();
    const q = new (T.THREE.Quaternion)();
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < fol.count; i += 1) {
      fol.getMatrixAt(i, m);
      m.decompose(p, q, s);
      sum += s.x; min = Math.min(min, s.x); max = Math.max(max, s.x);
    }
    out.foliage = {
      instances: fol.count,
      meanWidth: sum / Math.max(1, fol.count),
      minWidth: min === Infinity ? null : min,
      maxWidth: max === -Infinity ? null : max,
      visible: fol.visible,
    };
  }
  return out;
}

/* ---------------------------------------------------------------
   2: pick props worth photographing
   --------------------------------------------------------------- */

/** Small static colliders standing on open, near-flat sand. */
function pickProps(limit, BIG) {
  const T = window.__BS;
  const THREE = T.THREE;
  const physics = T.ctx.physics;
  const terrain = T.ctx.terrain;
  const sun = T.ctx.sky.sunDirection.clone().normalize();

  const found = [];
  for (const c of physics.colliders) {
    if (!c.active) continue;
    if (!(c.layer & physics.LAYER.STATIC)) continue;
    const h = c.halfExtents;
    if (BIG) {
      // Wall slabs: tall, long, thin. A building's base is the largest
      // "meets the ground" surface in any frame and no prop-sized
      // filter reaches it.
      if (h.y < 1.3) continue;
      if (Math.max(h.x, h.z) < 2.0) continue;
      if (Math.min(h.x, h.z) > 0.9) continue;
    } else {
      if (h.y < 0.25 || h.y > 2.2) continue;
      if (h.x > 2.2 || h.z > 2.2) continue;
    }
    const ground = terrain.heightAt(c.center.x, c.center.z);
    const base = c.center.y - h.y;
    if (Math.abs(base - ground) > 0.35) continue;      // must sit ON the sand
    if (terrain.slopeAt(c.center.x, c.center.z) > 0.28) continue;

    // Open ground: nothing else large within 4m, or the reading is a
    // measurement of the neighbour's shadow.
    const near = physics.queryBox(
      new THREE.Vector3(c.center.x - 4, c.center.y - 3, c.center.z - 4),
      new THREE.Vector3(c.center.x + 4, c.center.y + 3, c.center.z + 4),
      physics.LAYER.STATIC
    ) || [];
    const crowd = BIG ? 0 : near.filter((n) => n.id !== c.id
      && (n.halfExtents.x > 1.6 || n.halfExtents.z > 1.6 || n.halfExtents.y > 2.4)).length;
    if (crowd > 0) continue;

    found.push({
      id: c.id,
      x: c.center.x, y: base, z: c.center.z,
      hx: h.x, hy: h.y, hz: h.z,
      quat: c.quaternion.toArray(),
      surface: c.surface,
      radius: Math.max(h.x, h.z),
    });
  }

  // Spread the picks over the map so one dense compound cannot supply
  // every sample.
  found.sort((a, b) => (a.x * 31 + a.z * 17) - (b.x * 31 + b.z * 17));
  const step = Math.max(1, Math.floor(found.length / limit));
  const picks = [];
  for (let i = 0; i < found.length && picks.length < limit; i += step) picks.push(found[i]);
  return { picks, total: found.length, sun: [sun.x, sun.y, sun.z] };
}

/**
 * Frame one prop from close range and hand back the screen-uv of a
 * radial fan of ground samples, each tagged lit / shadowed.
 *
 * Only points the camera can actually see are returned (a raycast
 * from the eye must reach them), so a sample hidden behind the prop
 * cannot contribute the prop's own dark pixels to the "ground" mean.
 */
function frameProp(prop, offsets) {
  const T = window.__BS;
  const THREE = T.THREE;
  const physics = T.ctx.physics;
  const terrain = T.ctx.terrain;
  const camera = T.ctx.render.camera;
  const sun = T.ctx.sky.sunDirection.clone().normalize();

  // Stand on the sun side, so the prop's cast shadow falls AWAY from
  // the camera and the near ground is sunlit. Anything dark there is
  // occlusion, not a shadow.
  const flat = new THREE.Vector3(sun.x, 0, sun.z).normalize();
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
  // Far enough back that the 2m reference ring is still in frame -
  // at 2.2m and 42 degrees the reference samples all landed behind the
  // camera and half the props reported n/a.
  const dist = Math.max(4.6, prop.radius * 2.6 + 4.0);
  const eye = new THREE.Vector3(
    prop.x + flat.x * dist, 0, prop.z + flat.z * dist
  );
  eye.y = terrain.heightAt(eye.x, eye.z) + 1.35;
  T.lookAt([eye.x, eye.y, eye.z], [prop.x, prop.y + prop.hy * 0.35, prop.z], 52);

  /* Offsets are measured from the prop's own SURFACE, walking outward
   * along the box's face normal - not from its centre along a circle.
   * The circular version quietly reported "the contact blob does
   * nothing" for every elongated prop in the set: a jersey barrier is
   * 2.4m by 0.66m, so a ring at centre+1.22m is on the sand at the
   * ends and a metre clear of the sides, sampling ground the blob was
   * never supposed to cover. */
  const perimeter = [];
  const SEG = 7;
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let s = 0; s < SEG; s += 1) {
      const t = (s + 0.5) / SEG * 2 - 1;
      perimeter.push(nx !== 0
        ? { lx: nx * prop.hx, lz: t * prop.hz, nx, nz: 0 }
        : { lx: t * prop.hx, lz: nz * prop.hz, nx: 0, nz });
    }
  }

  const samples = [];
  const rings = [];
  for (const off of offsets) {
    const ring = { off, lit: [], shade: [] };
    for (const p of perimeter) {
      const lx = p.lx + p.nx * off;
      const lz = p.lz + p.nz * off;
      const local = new THREE.Vector3(lx, 0, lz)
        .applyQuaternion(new THREE.Quaternion().fromArray(prop.quat));
      const px = prop.x + local.x;
      const pz = prop.z + local.z;
      const py = terrain.heightAt(px, pz);
      const point = new THREE.Vector3(px, py, pz);

      const screen = point.clone().project(camera);
      if (Math.abs(screen.x) > 0.92 || Math.abs(screen.y) > 0.92) continue;

      // Visible from the eye?
      const toPoint = point.clone().sub(camera.position);
      const len = toPoint.length();
      toPoint.divideScalar(len);
      const block = physics.raycast(camera.position, toPoint, len - 0.12,
        { layer: physics.LAYER.STATIC });
      if (block.hit) continue;

      // In the sun's own shadow?
      const above = point.clone().addScaledVector(new THREE.Vector3(0, 1, 0), 0.05);
      const shadowed = physics.raycast(above, sun, 120,
        { layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC }).hit;

      const uv = [screen.x * 0.5 + 0.5, 1 - (screen.y * 0.5 + 0.5)];
      (shadowed ? ring.shade : ring.lit).push(uv);
      samples.push(uv);
    }
    rings.push(ring);
  }
  return { rings, eye: [eye.x, eye.y, eye.z], total: samples.length };
}

/* ------------------------------ main ------------------------------ */

const OFFSETS = [0.02, 0.15, 0.4, 0.8, 2.0];

function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    })).newPage();
    page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

    await page.goto(`${BASE}/games/blacksand.html?qa=1&quality=${QUALITY}`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 180000 });
    await page.evaluate(() => {
      window.__BS.maximize();
      window.__BS.hideHud(true);
      window.__BS.hideViewmodel(true);
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    // Auto-exposure and film grain both move the answer by more than
    // the effect being measured: hiding the contact blobs brightens the
    // frame, the meter compensates, and the "no blobs" capture came
    // back DARKER at the prop's base than the one with blobs in it.
    // Every capture in this probe is taken at one locked stop.
    await page.evaluate(() => {
      const e = window.__BS.grade({}).exposure;
      window.__BS.grade({ autoExposure: false, exposure: e, exposureBias: 1, grain: 0 });
      for (let i = 0; i < 4; i += 1) window.__BS.renderOnce(1 / 60);
    });
    await fs.mkdir(OUT, { recursive: true });

    /* ---- 1: analytic ---- */
    const blobs = await page.evaluate(analyseBlobs);
    console.log("\n=== authored contact curve (structures) ===");
    if (!blobs.structures) console.log("  no structures-contact mesh in the scene");
    else {
      const s = blobs.structures;
      console.log(`  ${s.blobs} blobs across ${s.meshes} merged meshes, half-extent `
        + `${s.minHalfExtent.toFixed(2)} / ${s.medianHalfExtent.toFixed(2)} / ${s.maxHalfExtent.toFixed(2)}m`);
      console.log("  ring 0 = blob rim; inset = median metres in from the rim");
      for (const p of s.curve) {
        const pct = (p.median * 100).toFixed(2).padStart(6);
        const bar = "#".repeat(Math.round(p.median * 120));
        console.log(`    ring ${p.ring}  inset ${p.inset.toFixed(2)}m   darkening ${pct}%  ${bar}`);
      }
    }
    if (blobs.foliage) {
      const f = blobs.foliage;
      console.log(`\n  foliage-contact: ${f.instances} instances, `
        + `width ${f.minWidth.toFixed(2)}-${f.maxWidth.toFixed(2)}m `
        + `(mean ${f.meanWidth.toFixed(2)}m), visible=${f.visible}`);
    }

    /* ---- 2: framebuffer ---- */
    await page.evaluate(`window.__pickProps = ${pickProps.toString()}`);
    const { picks, total, sun } = await page.evaluate(
      ([n, b]) => window.__pickProps(n, b), [SHOTS || 6, BIG]
    );
    console.log(`\n=== close-range framebuffer probe ===`);
    console.log(`  ${total} candidate props on open sand; sampling ${picks.length}`);
    console.log(`  sun ${sun.map((v) => v.toFixed(2)).join(", ")}`);

    await page.evaluate(`window.__frameProp = ${frameProp.toString()}`);

    const rows = [];
    for (let i = 0; i < picks.length; i += 1) {
      const prop = picks[i];
      const framed = await page.evaluate(
        ([p, o]) => {
          const r = window.__frameProp(p, o);
          for (let k = 0; k < 4; k += 1) window.__BS.renderOnce(1 / 60);
          return r;
        },
        [prop, OFFSETS]
      );
      const read = await grab(page);
      const name = `prop-${String(i + 1).padStart(2, "0")}-r${prop.radius.toFixed(2)}`;
      await fs.writeFile(path.join(OUT, `${name}.png`), read.png);

      const profile = (r) => framed.rings.map((ring) => ({
        off: ring.off,
        lit: median(ring.lit.map(([u, v]) => r(u, v, 1))),
        n: ring.lit.length,
      }));
      const ring = profile(read);

      // Attribution A/B. The reviewer says "no AO / contact term", and
      // there are two independent sources of one: the screen-space AO
      // in the post stack and the merged multiply blobs in this module.
      // Turning each off in isolation says which is actually carrying
      // the load, instead of assuming.
      let noBlob = null;
      let noAo = null;
      if (AB) {
        await page.evaluate(() => {
          const s = window.__BS.ctx.render.scene;
          window.__hid = [];
          s.traverse((o) => {
            if (o.name === "structures-contact" || o.name === "foliage-contact") {
              window.__hid.push(o); o.visible = false;
            }
          });
          for (let k = 0; k < 3; k += 1) window.__BS.renderOnce(1 / 60);
        });
        noBlob = profile(await grab(page));
        await page.evaluate(() => {
          for (const o of window.__hid) o.visible = true;
          window.__ao = window.__BS.grade({}).ao.strength;
          window.__BS.grade({ ao: 0 });
          for (let k = 0; k < 3; k += 1) window.__BS.renderOnce(1 / 60);
        });
        noAo = profile(await grab(page));
        await page.evaluate(() => {
          window.__BS.grade({ ao: window.__ao });
          for (let k = 0; k < 3; k += 1) window.__BS.renderOnce(1 / 60);
        });
      }

      const rat = (p) => {
        if (!p) return null;
        const f = p[p.length - 1].lit;
        const n0 = p[0].lit;
        return f && n0 ? n0 / f : null;
      };
      rows.push({ name, prop, ring, noBlob, noAo, ratio: rat(ring) });

      const line = ring.map((r) => `${r.off.toFixed(2)}m ${r.lit === null ? "  n/a" : r.lit.toFixed(4)}(${r.n})`).join("  ");
      console.log(`  ${name} hx${prop.hx.toFixed(2)} hy${prop.hy.toFixed(2)}  ${line}`
        + `   base/2m ${rat(ring) === null ? "n/a" : rat(ring).toFixed(3)}`);
      if (AB) {
        // The attribution that matters is the RAW luma at the prop's
        // own base with each source removed, not a ratio of ratios.
        const at = (p) => (p && p[0].lit !== null ? p[0].lit : null);
        const cut = (p) => {
          const a = at(ring); const b = at(p);
          return a && b ? `${((1 - a / b) * 100).toFixed(1)}%` : "n/a";
        };
        console.log(`      base luma  full ${at(ring)?.toFixed(4)}`
          + `  no-blob ${at(noBlob)?.toFixed(4)} (blob ${cut(noBlob)})`
          + `  no-ssao ${at(noAo)?.toFixed(4)} (ssao ${cut(noAo)})`);
      }
    }

    const ratios = rows.map((r) => r.ratio).filter((v) => v !== null && Number.isFinite(v));
    if (ratios.length) {
      console.log(`\n  MEDIAN base/2m luma ratio ${median(ratios).toFixed(3)}`
        + `   (1.000 = no contact darkening at all)`);
      console.log(`  range ${Math.min(...ratios).toFixed(3)} - ${Math.max(...ratios).toFixed(3)}`);
    }

    const report = await page.evaluate(() => {
      const r = window.__BS.report();
      const c = window.__BS.ctx;
      return {
        calls: r.render.calls, triangles: r.render.triangles, frame: r.frame,
        structures: c.structures && c.structures.report ? c.structures.report() : null,
        foliage: c.foliage && c.foliage.report ? c.foliage.report() : null,
      };
    });
    console.log(`\n  draw calls ${report.calls}   triangles ${report.triangles}`);
    if (report.structures) {
      const st = report.structures;
      console.log(`  structures: ${st.buildings} buildings  ${st.pieces} pieces  ${st.colliders} colliders`
        + `  ${st.meshes} merged meshes  ${st.triangles} tris`);
      console.log(`  contact: ${st.contactBlobs} blobs in ${st.contactMeshes} meshes`
        + `   props refused by seat(): ${st.unseated}`);
    }
    if (report.foliage) {
      console.log(`  foliage: ${report.foliage.instances} instances  ${report.foliage.drawCalls} calls`);
    }

    await fs.writeFile(path.join(OUT, "contact.json"),
      JSON.stringify({ blobs, rows, report }, null, 2));
    console.log(`\n  wrote ${OUT}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
