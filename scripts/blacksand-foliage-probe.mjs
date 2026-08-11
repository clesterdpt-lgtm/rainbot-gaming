#!/usr/bin/env node
/* ============================================================
   BLACKSAND - foliage read probe

   Two reviewer findings live here, and both name a mechanism:

   - "distant alpha-tested props collapse to black scribbles - fog is
     applied before the alpha cut, and there's no alpha-to-coverage"
   - "uniform-yaw cross-billboards, no per-instance scale/rotation
     jitter, no translucency, no wind"

   Magnifying a capture showed something neither claim predicts: a
   SINGLE acacia at 40m is green on one side of its crown and a pure
   black scribble on the other. That cannot be fog (three applies fog
   after the alpha test - the chunk order makes the stated mechanism
   impossible) and it cannot be a mip/coverage problem, which would
   thin a crown evenly rather than split it.

   So this measures the split directly: frame one plant, count how
   much of its crown is crushed near black, and re-measure with each
   candidate shading term switched off one at a time.

   It also reports the per-instance variation actually present in the
   buffers - yaw, scale, stretch and bend - because "no jitter" is a
   claim about data, and the data can simply be read.

   Usage:
     node scripts/blacksand-foliage-probe.mjs
     node scripts/blacksand-foliage-probe.mjs --species acacia --dist 40
   ============================================================ */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const PORT = 45000 + (process.pid % 1500);
const BASE = `http://127.0.0.1:${PORT}`;
const QUALITY = arg("quality", "ultra");
const OUT = path.resolve(root, arg("out", "output/blacksand-foliage/latest"));
const SPECIES = String(arg("species", "acacia,palm,tamarisk,thorn")).split(",");
const DISTANCES = String(arg("dist", "18,45,110,240")).split(",").map(Number);

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}
async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try { const r = await fetch(`${BASE}/games/blacksand.html`); if (r.ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}
function toLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Statistics over the crown's screen rect. "Plant" pixels are the ones
 * that differ from the same rect captured with the foliage hidden, so
 * sky and terrain never enter the mean.
 */
async function crownStats(page, rect) {
  const shot = async () => {
    const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    return sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const { data, info } = await shot();
  await page.evaluate(() => window.__fol.hide(true));
  const { data: bg } = await shot();
  await page.evaluate(() => window.__fol.hide(false));

  const x0 = Math.max(0, Math.round(rect[0] * info.width));
  const x1 = Math.min(info.width - 1, Math.round(rect[2] * info.width));
  const y0 = Math.max(0, Math.round(rect[1] * info.height));
  const y1 = Math.min(info.height - 1, Math.round(rect[3] * info.height));
  /* Everything here is expressed RELATIVE to the ground the plant is
   * standing in front of, measured in the same pixels of the same
   * frame. Absolute luma is not comparable between runs: the exposure
   * meter settles over a variable number of frames, and two runs of
   * the same build came back 6 points apart on crush for that reason
   * alone. A ratio against the backdrop cancels the stop. */
  let n = 0; let sum = 0;
  let bgSum = 0; let bgN = 0;
  const lumas = [];
  const lin = (buf, i) => 0.2126 * toLinear(buf[i]) + 0.7152 * toLinear(buf[i + 1])
    + 0.0722 * toLinear(buf[i + 2]);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * info.width + x) * 3;
      bgSum += lin(bg, i); bgN += 1;
      const diff = Math.abs(data[i] - bg[i]) + Math.abs(data[i + 1] - bg[i + 1])
        + Math.abs(data[i + 2] - bg[i + 2]);
      if (diff < 12) continue;                      // not a plant pixel
      const l = lin(data, i);
      lumas.push(l);
      sum += l; n += 1;
    }
  }
  lumas.sort((a, b) => a - b);
  const bgMean = bgN ? bgSum / bgN : 1;
  // "Crushed" is under 5% of the backdrop - a value at which a leaf
  // has stopped being a leaf and become a hole.
  const cut = bgMean * 0.05;
  const dark = lumas.filter((l) => l < cut).length;
  return {
    pixels: n,
    coverage: n / Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1)),
    bg: bgMean,
    mean: n ? sum / n / bgMean : null,
    p10: n ? lumas[Math.floor(n * 0.1)] / bgMean : null,
    p90: n ? lumas[Math.floor(n * 0.9)] / bgMean : null,
    crushedPct: n ? (dark / n) * 100 : null,
  };
}

/* --------------------- page-side helpers --------------------- */

function install() {
  const T = window.__BS;
  const THREE = T.THREE;
  const foliage = T.ctx.foliage;
  const group = foliage.group || null;

  const meshes = [];
  T.ctx.render.scene.traverse((o) => {
    if ((o.isInstancedMesh || o.isMesh) && o.material
      && typeof o.material.name === "string" && o.material.name.startsWith("bs-foliage")) meshes.push(o);
  });

  window.__fol = {
    meshes,
    hide(v) { for (const m of meshes) m.visible = !v; for (let k = 0; k < 3; k += 1) T.renderOnce(1 / 60); },

    /** Uniform overrides on every foliage program. `__env` scales the
     *  scene probe instead, which is the only knob that reaches the
     *  ambient arriving at a leaf from outside this module. */
    set(patch) {
      const scene = T.ctx.render.scene;
      if (window.__envBase === undefined) window.__envBase = scene.environmentIntensity;
      scene.environmentIntensity = window.__envBase * (patch.__env || 1);
      for (const m of meshes) {
        const sh = m.material.userData && m.material.userData.shader;
        if (!sh) continue;
        for (const [k, v] of Object.entries(patch)) if (sh.uniforms[k]) sh.uniforms[k].value = v;
      }
      for (let k = 0; k < 3; k += 1) T.renderOnce(1 / 60);
    },
    read(name) {
      for (const m of meshes) {
        const sh = m.material.userData && m.material.userData.shader;
        if (sh && sh.uniforms[name]) return sh.uniforms[name].value;
      }
      return null;
    },

    /** Frame one plant of `species` from `dist` metres, and return the
     *  crown's screen rect. */
    frame(species, dist) {
      const list = foliage.samplePositions(species, 12);
      if (!list.length) return null;
      const sun = T.ctx.sky.sunDirection.clone().normalize();
      const flat = new THREE.Vector3(sun.x, 0, sun.z).normalize();
      // Cross-light: the crown's shaded half has to be in frame, which
      // is the whole point - looking down-sun hides the defect.
      const side = new THREE.Vector3(-flat.z, 0, flat.x);
      const [x, y, z, s] = list[Math.min(3, list.length - 1)];
      const h = 5.5 * (s || 1);
      const eye = new THREE.Vector3(
        x + side.x * dist * 0.8 + flat.x * dist * 0.6, 0,
        z + side.z * dist * 0.8 + flat.z * dist * 0.6);
      eye.y = T.ctx.terrain.heightAt(eye.x, eye.z) + Math.max(1.7, h * 0.55);
      const fov = Math.max(6, Math.min(60, 2 * Math.atan((h * 0.9) / dist) * 180 / Math.PI));
      T.lookAt([eye.x, eye.y, eye.z], [x, y + h * 0.62, z], fov);
      for (let k = 0; k < 4; k += 1) T.renderOnce(1 / 60);

      const cam = T.ctx.render.camera;
      const box = new THREE.Box3(
        new THREE.Vector3(x - h * 0.5, y, z - h * 0.5),
        new THREE.Vector3(x + h * 0.5, y + h * 1.15, z + h * 0.5));
      let u0 = 1; let v0 = 1; let u1 = 0; let v1 = 0;
      const p = new THREE.Vector3();
      for (let i = 0; i < 8; i += 1) {
        p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        p.project(cam);
        const u = p.x * 0.5 + 0.5;
        const v = 1 - (p.y * 0.5 + 0.5);
        u0 = Math.min(u0, u); u1 = Math.max(u1, u);
        v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      return { rect: [u0, v0, u1, v1], dist, species, pos: [x, y, z] };
    },

    /** Per-instance variation actually present in the buffers. */
    variation() {
      const out = [];
      const m = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      for (const mesh of meshes) {
        if (!mesh.isInstancedMesh || !mesh.count) continue;
        const yaws = []; const scales = [];
        const n = Math.min(mesh.count, 900);
        for (let i = 0; i < n; i += 1) {
          mesh.getMatrixAt(i, m);
          m.decompose(pos, q, sc);
          const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
          yaws.push(((e.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
          scales.push(sc.x);
        }
        const sd = (a) => {
          const mu = a.reduce((s2, v) => s2 + v, 0) / a.length;
          return Math.sqrt(a.reduce((s2, v) => s2 + (v - mu) * (v - mu), 0) / a.length);
        };
        const inst = mesh.geometry.getAttribute("aInst");
        let stretch = null; let bend = null;
        if (inst && inst.itemSize >= 4) {
          const st = []; const bd = [];
          for (let i = 0; i < Math.min(inst.count, 900); i += 1) { st.push(inst.getZ(i)); bd.push(inst.getW(i)); }
          stretch = { min: Math.min(...st), max: Math.max(...st), sd: sd(st) };
          bend = { min: Math.min(...bd), max: Math.max(...bd), sd: sd(bd) };
        }
        out.push({
          name: mesh.name, count: mesh.count,
          yawSd: sd(yaws), yawMin: Math.min(...yaws), yawMax: Math.max(...yaws),
          scaleMin: Math.min(...scales), scaleMax: Math.max(...scales), scaleSd: sd(scales),
          stretch, bend,
        });
      }
      return out;
    },
  };
  return { meshes: meshes.length, hasGroup: Boolean(group) };
}

/* Each trial removes ONE candidate source of the crush. If a trial
 * that removes every foliage-side occlusion still leaves the crown
 * crushed, the limit is the scene's own ambient and no amount of
 * tuning in this module reaches it. */
const TRIALS = [
  ["as shipped", null],
  ["no foliage occlusion", { uSkyOcclude: 0, uAoDepth: 0 }],
  ["translucency 0", { uTranslucency: 0 }],
  ["scene ambient x3", { __env: 3 }],
];

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
      window.__BS.maximize(); window.__BS.hideHud(true); window.__BS.hideViewmodel(true);
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
      const e = window.__BS.grade({}).exposure;
      window.__BS.grade({ autoExposure: false, exposure: e, exposureBias: 1, grain: 0 });
      window.__BS.ctx.foliage.setWind(0.0);
    });
    await fs.mkdir(OUT, { recursive: true });
    const info = await page.evaluate(`(${install.toString()})()`);
    console.log(`\nfoliage meshes: ${info.meshes}`);

    console.log("\n=== per-instance variation (claim 4: 'uniform yaw, no jitter') ===");
    const varn = await page.evaluate(() => window.__fol.variation());
    for (const v of varn) {
      const sb = v.stretch
        ? `  stretch ${v.stretch.min.toFixed(2)}..${v.stretch.max.toFixed(2)} sd ${v.stretch.sd.toFixed(3)}`
          + `  bend ${v.bend.min.toFixed(2)}..${v.bend.max.toFixed(2)} sd ${v.bend.sd.toFixed(3)}`
        : "  (no aInst)";
      console.log(`  ${v.name.padEnd(22)} n=${String(v.count).padStart(5)}`
        + `  yaw sd ${v.yawSd.toFixed(3)} rad over ${v.yawMin.toFixed(2)}..${v.yawMax.toFixed(2)}`
        + `  scale ${v.scaleMin.toFixed(2)}..${v.scaleMax.toFixed(2)} sd ${v.scaleSd.toFixed(3)}${sb}`);
    }

    console.log("\n=== crown crush by distance (claim 5: 'black scribbles') ===");
    for (const species of SPECIES) {
      for (const dist of DISTANCES) {
        const framed = await page.evaluate(([s, d]) => window.__fol.frame(s, d), [species, dist]);
        if (!framed) { console.log(`  ${species}: no instances`); break; }
        const line = [];
        for (const [label, patch] of TRIALS) {
          if (patch) await page.evaluate((p) => window.__fol.set(p), patch);
          else {
            await page.evaluate(() => window.__fol.set({ uSkyOcclude: 0.30, uTranslucency: 0.46, uAoDepth: 0.62 }));
          }
          const st = await crownStats(page, framed.rect);
          line.push(`${label} crushed ${st.crushedPct === null ? "n/a" : `${st.crushedPct.toFixed(1)}%`}`);
          if (label === "as shipped") {
            const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
            await fs.writeFile(path.join(OUT, `${species}-${dist}m.png`),
              Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
            console.log(`  ${species} @ ${String(dist).padStart(3)}m  px ${String(st.pixels).padStart(6)}`
              + `  cover ${(st.coverage * 100).toFixed(1)}%  bg ${st.bg.toFixed(3)}`
              + `  crown/bg mean ${st.mean === null ? "n/a" : st.mean.toFixed(3)}`
              + `  p10 ${st.p10 === null ? "n/a" : st.p10.toFixed(3)}  p90 ${st.p90 === null ? "n/a" : st.p90.toFixed(3)}`);
          }
        }
        await page.evaluate(() => window.__fol.set({ uSkyOcclude: 0.30, uTranslucency: 0.46, uAoDepth: 0.62 }));
        console.log(`               ${line.join("   ")}`);
      }
    }
    console.log(`\n  wrote ${OUT}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
