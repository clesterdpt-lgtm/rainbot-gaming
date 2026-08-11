#!/usr/bin/env node
/* ============================================================
   BLACKSAND - contact blob reachability diagnostic

   The close-range probe says the merged `structures-contact` mesh
   carries 17.8% darkening at a prop's silhouette and that removing the
   mesh entirely changes the framebuffer at that spot by 0.0%. Both
   cannot be true, so this answers the only question that matters
   first: does the geometry reach the frame at all?

   Method, deliberately crude - the round-2 post-mortem's "put a grey
   box next to it" move. Drive the whole colour attribute to a value
   nothing could miss and ask whether ANY pixel over the blob moves.
   Sampling the blob's own 64 vertices rather than one centre pixel
   matters: the first version of this script read the centre, and the
   centre of a rooftop water tank's blob is underneath the tank.

   If nothing moves, the fault is upstream of any falloff curve, and
   the interventions below name which stage is eating it. Each one is
   applied to a clean state and undone afterwards - a cumulative run
   reports the first intervention's result four times.
   ============================================================ */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 46000 + (process.pid % 1500);
const BASE = `http://127.0.0.1:${PORT}`;
const qi = process.argv.indexOf("--quality");
const QUALITY = qi >= 0 ? process.argv[qi + 1] : "ultra";
const OUT = path.resolve(root, "output/blacksand-contact/diag");

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
async function grab(page) {
  const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(buf).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const read = (u, v) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.round(u * (info.width - 1))));
    const y = Math.min(info.height - 1, Math.max(0, Math.round(v * (info.height - 1))));
    const i = (y * info.width + x) * 3;
    return 0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1]) + 0.0722 * toLinear(data[i + 2]);
  };
  read.png = buf;
  return read;
}

/* --------------------- page-side helpers --------------------- */

function install() {
  const T = window.__BS;
  const THREE = T.THREE;
  const scene = T.ctx.render.scene;
  const N = 8;
  const per = N * N;

  const meshes = [];
  scene.traverse((o) => { if (o.name === "structures-contact") meshes.push(o); });

  window.__blob = {
    meshes,
    material: meshes.length ? meshes[0].material : null,
    saved: null,

    /** Blobs that sit on TERRAIN (so nothing of their own prop is
     *  between them and a camera looking down) and are small enough to
     *  frame. Returns centre plus every vertex, in world space. */
    list(n) {
      const out = [];
      for (const mesh of meshes) {
        const pos = mesh.geometry.attributes.position;
        const blobs = Math.floor(pos.count / per);
        for (let b = 0; b < blobs; b += 1) {
          const k = b * per;
          let cx = 0; let cy = 0; let cz = 0;
          let minX = Infinity; let maxX = -Infinity;
          const verts = [];
          for (let i = k; i < k + per; i += 1) {
            const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
            cx += x; cy += y; cz += z;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            verts.push([x, y, z]);
          }
          cx /= per; cy /= per; cz /= per;
          const half = (maxX - minX) * 0.5;
          const ground = T.ctx.terrain.heightAt(cx, cz);
          if (half > 2.6 || Math.abs(cy - ground) > 0.25) continue;
          out.push({ x: cx, y: cy, z: cz, half, verts });
          if (out.length >= n) return out;
        }
      }
      return out;
    },

    /** Overwrite every contact vertex colour. null restores. */
    force(value) {
      for (const mesh of meshes) {
        const c = mesh.geometry.attributes.color;
        if (!mesh.userData.origColour) mesh.userData.origColour = c.array.slice();
        if (value === null) c.array.set(mesh.userData.origColour);
        else for (let i = 0; i < c.array.length; i += 1) c.array[i] = value;
        c.needsUpdate = true;
      }
    },

    /** Frame a blob from straight above and hand back its vertices in
     *  screen uv, dropping any the renderer would hide behind the
     *  prop itself. */
    frame(blob) {
      T.lookAt([blob.x, blob.y + 7, blob.z + 0.02], [blob.x, blob.y, blob.z], 40);
      for (let k = 0; k < 4; k += 1) T.renderOnce(1 / 60);
      const cam = T.ctx.render.camera;
      const v = new THREE.Vector3();
      return blob.verts.map(([x, y, z]) => {
        v.set(x, y, z).project(cam);
        if (Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) return null;
        return [v.x * 0.5 + 0.5, 1 - (v.y * 0.5 + 0.5)];
      }).filter(Boolean);
    },

    save() {
      const m = window.__blob.material;
      window.__blob.saved = {
        depthTest: m.depthTest, blending: m.blending, premultipliedAlpha: m.premultipliedAlpha,
        transparent: m.transparent, y: meshes.map((o) => o.position.y),
        order: meshes.map((o) => o.renderOrder), toneMapped: m.toneMapped,
      };
    },
    restore() {
      const s = window.__blob.saved;
      const m = window.__blob.material;
      m.depthTest = s.depthTest; m.blending = s.blending;
      m.premultipliedAlpha = s.premultipliedAlpha; m.transparent = s.transparent;
      m.toneMapped = s.toneMapped;
      m.needsUpdate = true;
      meshes.forEach((o, i) => {
        o.position.y = s.y[i]; o.renderOrder = s.order[i];
        o.updateMatrix(); o.updateMatrixWorld(true);
      });
      for (let k = 0; k < 3; k += 1) T.renderOnce(1 / 60);
    },
  };
  return { meshes: meshes.length };
}

const TRIALS = {
  "baseline (forced 0.2)": "",
  "depthTest off": "window.__blob.material.depthTest = false; window.__blob.material.needsUpdate = true;",
  "lifted +0.6m": "for (const m of window.__blob.meshes) { m.position.y += 0.6; m.updateMatrix(); m.updateMatrixWorld(true); }",
  "NormalBlending black": "const m = window.__blob.material; m.blending = window.__BS.THREE.NormalBlending; m.premultipliedAlpha = false; m.needsUpdate = true;",
  "renderOrder 999": "for (const m of window.__blob.meshes) m.renderOrder = 999;",
  "toneMapped on": "window.__blob.material.toneMapped = true; window.__blob.material.needsUpdate = true;",
};

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
    });
    await fs.mkdir(OUT, { recursive: true });
    await page.evaluate(`(${install.toString()})()`);

    const blobs = await page.evaluate(() => window.__blob.list(4));
    console.log(`\n${blobs.length} ground-standing blobs picked`);

    for (let i = 0; i < blobs.length; i += 1) {
      const uv = await page.evaluate((b) => window.__blob.frame(b), blobs[i]);
      console.log(`\n  blob ${i} half ${blobs[i].half.toFixed(2)}m  ${uv.length}/64 vertices on screen`);

      await page.evaluate(() => { window.__blob.force(null); window.__blob.save(); for (let k = 0; k < 3; k += 1) window.__BS.renderOnce(1 / 60); });
      const authored = await grab(page);
      if (i === 0) await fs.writeFile(path.join(OUT, "blob0-authored.png"), authored.png);

      for (const [label, js] of Object.entries(TRIALS)) {
        await page.evaluate((src) => {
          window.__blob.restore();
          window.__blob.force(0.2);
          // eslint-disable-next-line no-new-func
          if (src) new Function(src)();
          for (let k = 0; k < 4; k += 1) window.__BS.renderOnce(1 / 60);
        }, js);
        const g = await grab(page);
        if (i === 0) await fs.writeFile(path.join(OUT, `blob0-${label.replace(/\W+/g, "-")}.png`), g.png);
        // Biggest drop at any of the blob's own vertices. Forcing 0.2
        // is an 80% multiply; anything reaching the frame shows here.
        let worst = 0;
        for (const [u, v] of uv) worst = Math.max(worst, authored(u, v) - g(u, v));
        console.log(`    ${label.padEnd(24)} max luma drop ${worst.toFixed(4)}`
          + `  ${worst > 0.02 ? "<-- REACHES THE FRAME" : ""}`);
      }
      await page.evaluate(() => { window.__blob.restore(); window.__blob.force(null); });
    }
    console.log(`\n  wrote ${OUT}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
