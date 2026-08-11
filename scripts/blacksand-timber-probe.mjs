#!/usr/bin/env node
/* ============================================================
   BLACKSAND - built-surface chroma probe

   Answers one question with numbers: how far apart in HUE are the two
   ends of a generator's colour ramp, and what does the structures tint
   do to that separation before it reaches the screen.

   The metal generator was diagnosed this way - sound paint and rust
   sat ~150 degrees apart, mixed by a field with 25cm features, which
   is two-colour DPM at any tile scale - so the same instrument is
   pointed at the rest of the library rather than a new one being
   invented per material.

   Three populations are measured, and they are deliberately different
   things:

     map     the generator's own albedo texels, decoded to linear
     albedo  map * the vertex tint STRUCTURES actually merged into the
             buffer (tint x albedoScale), i.e. the surface's real
             reflectance in the scene
     screen  graded framebuffer pixels that a raycast says are that
             material, from a gameplay pose

   "Ramp endpoints" are the mean linear colour of the darkest 2% and
   the brightest 2% of the population by luminance. That is the
   measurable analogue of the two constants a generator lerps between,
   and it survives the generator being rewritten.

   Usage:
     node scripts/blacksand-timber-probe.mjs
     node scripts/blacksand-timber-probe.mjs --pose market --json out.json
   ============================================================ */

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
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
const QUALITY = String(args.quality || "ultra");
const POSE = String(args.pose && args.pose !== true ? args.pose : "market");
const PORT = Number(args.port || 44000 + (process.pid % 9000));
const BASE = `http://127.0.0.1:${PORT}`;
const SURFACES = String(args.surfaces && args.surfaces !== true
  ? args.surfaces
  : "wood,sandbag,metal,corrugated,blockwall,plaster,concrete,rubble,sand,dirt").split(",");

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* --------------------------- reporting --------------------------- */

function fmtStat(s) {
  if (!s || !s.n) return "        (no samples)";
  return `n ${String(s.n).padStart(7)}  lum ${s.lum.toFixed(4)}`
    + `  sat ${s.sat.toFixed(3)}  chroma ${s.chroma.toFixed(4)}`
    + `  hue p50 ${s.hue50.toFixed(1)}  hueSpan ${s.hueSpan.toFixed(1)}`;
}

function fmtRamp(r) {
  if (!r) return "        (no samples)";
  const d = r.dark; const l = r.light;
  return `dark (${d.rgb.map((v) => v.toFixed(3)).join(",")}) hue ${d.hue.toFixed(1)} sat ${d.sat.toFixed(2)}`
    + `   light (${l.rgb.map((v) => v.toFixed(3)).join(",")}) hue ${l.hue.toFixed(1)} sat ${l.sat.toFixed(2)}`
    + `   SEP ${r.separation.toFixed(1)} deg   contrast ${r.contrast.toFixed(2)}x`;
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
    })).newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`${BASE}/games/blacksand.html?qa=1&probe=1&quality=${QUALITY}`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(),
      null, { timeout: 240000 });
    await page.evaluate(() => {
      window.__BS.maximize();
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    /* ---- shared colour maths, installed once in the page ---- */
    await page.evaluate(() => {
      const W = window;
      W.__CH = {
        toLinear(v) {
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        },
        hueOf(r, g, b) {
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const c = mx - mn;
          if (c < 1e-6) return null;
          let h;
          if (mx === r) h = ((g - b) / c) % 6;
          else if (mx === g) h = (b - r) / c + 2;
          else h = (r - g) / c + 4;
          h *= 60;
          return h < 0 ? h + 360 : h;
        },
        /** Circular mean of hues, so 359 and 1 average to 0. */
        hueMean(list) {
          let sx = 0; let sy = 0;
          for (const h of list) {
            const a = h * Math.PI / 180;
            sx += Math.cos(a); sy += Math.sin(a);
          }
          if (!list.length) return null;
          const a = Math.atan2(sy / list.length, sx / list.length) * 180 / Math.PI;
          return a < 0 ? a + 360 : a;
        },
        sep(a, b) {
          if (a === null || b === null) return null;
          const d = Math.abs(a - b) % 360;
          return d > 180 ? 360 - d : d;
        },
        /** Summarise an array of linear rgb triples. */
        summarise(rgb) {
          const n = rgb.length;
          if (!n) return null;
          const hues = [];
          let lum = 0; let sat = 0; let chroma = 0;
          for (const [r, g, b] of rgb) {
            lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
            chroma += mx - mn;
            sat += mx > 1e-6 ? (mx - mn) / mx : 0;
            const h = W.__CH.hueOf(r, g, b);
            if (h !== null) hues.push(h);
          }
          hues.sort((a, b) => a - b);
          const pick = (p) => (hues.length ? hues[Math.min(hues.length - 1,
            Math.floor(p * hues.length))] : 0);
          return {
            n,
            lum: lum / n,
            sat: sat / n,
            chroma: chroma / n,
            hue5: pick(0.05),
            hue50: pick(0.50),
            hue95: pick(0.95),
            hueSpan: pick(0.95) - pick(0.05),
          };
        },
        /** Mean colour of the darkest and brightest `frac` by luminance,
         *  and the hue angle between them. */
        ramp(rgb, frac) {
          const n = rgb.length;
          if (n < 50) return null;
          const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
          const sorted = rgb.slice().sort((a, b) => lum(a) - lum(b));
          const k = Math.max(1, Math.floor(n * frac));
          const mean = (from, to) => {
            let r = 0; let g = 0; let b = 0;
            for (let i = from; i < to; i += 1) {
              r += sorted[i][0]; g += sorted[i][1]; b += sorted[i][2];
            }
            const m = to - from;
            return [r / m, g / m, b / m];
          };
          const dark = mean(0, k);
          const light = mean(n - k, n);
          const stat = (c) => {
            const mx = Math.max(...c); const mn = Math.min(...c);
            return { rgb: c, hue: W.__CH.hueOf(...c), sat: mx > 1e-6 ? (mx - mn) / mx : 0 };
          };
          const d = stat(dark); const l = stat(light);
          return {
            dark: d,
            light: l,
            separation: W.__CH.sep(d.hue, l.hue),
            // Value ratio between the ends of the ramp, in LINEAR light,
            // which is the space the renderer multiplies in. Authoring
            // this ratio in sRGB understates it by about 1.45x.
            contrast: lum(light) / Math.max(1e-5, lum(dark)),
          };
        },
      };
    });

    /* ---- 1. the generator maps, and what structures merged ---- */
    const surfaces = await page.evaluate((names) => {
      const CH = window.__CH;
      const c = window.__BS.ctx;
      const out = {};
      // Vertex tints, read straight off the buffers the scene draws.
      const tints = {};
      for (const mesh of (c.structures.group.children || [])) {
        if (!mesh.isMesh || !mesh.geometry.attributes.color) continue;
        const name = mesh.name.replace("structures-", "");
        if (name === "contact") continue;
        const a = mesh.geometry.attributes.color.array;
        const bucket = tints[name] || (tints[name] = { sum: [0, 0, 0], n: 0, uniq: new Map() });
        // Stride: a wall has thousands of identical vertices; the
        // distinct tint values are what matter, not their vertex count.
        for (let i = 0; i < a.length; i += 3 * 29) {
          bucket.sum[0] += a[i]; bucket.sum[1] += a[i + 1]; bucket.sum[2] += a[i + 2];
          bucket.n += 1;
          const key = `${a[i].toFixed(2)}|${a[i + 1].toFixed(2)}|${a[i + 2].toFixed(2)}`;
          bucket.uniq.set(key, (bucket.uniq.get(key) || 0) + 1);
        }
      }

      for (const name of names) {
        const set = c.textures.get(name);
        if (!set || !set.map || !set.map.image) { out[name] = null; continue; }
        const data = set.map.image.data;
        const map = [];
        // Every 7th texel of a 512-1024 square is tens of thousands of
        // samples - far past where any of these statistics move.
        for (let i = 0; i < data.length; i += 4 * 7) {
          map.push([CH.toLinear(data[i] / 255), CH.toLinear(data[i + 1] / 255),
            CH.toLinear(data[i + 2] / 255)]);
        }
        const meanLin = map.reduce((s, p) => s + (p[0] + p[1] + p[2]) / 3, 0) / map.length;
        // Mirrors albedoScaleFor() in structures.js. Keep the cap in
        // step with it - this printed 6.00 for a full round after the
        // engine moved to 12, which reads as "the clamp is still
        // binding" when it no longer is.
        const albedoScale = Math.min(12, Math.max(1, 1 / Math.max(meanLin, 1e-4)));

        const tint = tints[name];
        let tinted = null;
        let tintMean = null;
        let clipped = 0;
        if (tint && tint.n) {
          tintMean = tint.sum.map((v) => v / tint.n);
          tinted = map.map((p) => {
            const r = p[0] * tintMean[0]; const g = p[1] * tintMean[1]; const b = p[2] * tintMean[2];
            if (r > 1 || g > 1 || b > 1) clipped += 1;
            return [Math.min(1, r), Math.min(1, g), Math.min(1, b)];
          });
        }

        out[name] = {
          meanLin,
          albedoScale,
          tintMean,
          tintDistinct: tint ? tint.uniq.size : 0,
          clipFrac: tinted ? clipped / tinted.length : null,
          map: { stat: CH.summarise(map), ramp: CH.ramp(map, 0.02) },
          albedo: tinted
            ? { stat: CH.summarise(tinted), ramp: CH.ramp(tinted, 0.02) }
            : null,
        };
      }
      return out;
    }, SURFACES);

    /* ---- 2. the same materials on screen, from a gameplay pose ---- */
    const staged = await page.evaluate((poseId) => {
      const T = window.__BS;
      const c = T.ctx;
      const pose = (c.world.getBeautyShots() || []).find((p) => p.id === poseId);
      if (!pose) return null;
      T.releaseCamera();
      T.hideHud(true);
      if (c.viewmodel && c.viewmodel.setVisible) c.viewmodel.setVisible(true);
      const dx = pose.target[0] - pose.position[0];
      const dz = pose.target[2] - pose.position[2];
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len; const uz = dz / len;
      // Matches blacksand-gameplay-shots.mjs, including its standoff, so
      // the pixels measured here are the pixels in the published frame.
      const sx = pose.target[0] - ux * 14;
      const sz = pose.target[2] - uz * 14;
      T.teleport(sx, T.heightAt(sx, sz) + 1.2, sz);
      c.player.state.yaw = Math.atan2(-ux, -uz);
      c.player.state.pitch = -0.06;
      if (pose.timeOfDay !== undefined) T.setTimeOfDay(pose.timeOfDay);
      return { x: sx, z: sz, tod: pose.timeOfDay };
    }, POSE);

    await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
    await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });
    // Same standoff loop as the shots harness.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const near = await page.evaluate(() => {
        const c = window.__BS.cameraClearance();
        return c && typeof c.nearest === "number" ? c.nearest : 99;
      });
      if (near >= 2.5) break;
      await page.evaluate(({ poseId, back }) => {
        const T = window.__BS; const c = T.ctx;
        const pose = (c.world.getBeautyShots() || []).find((p) => p.id === poseId);
        const dx = pose.target[0] - pose.position[0]; const dz = pose.target[2] - pose.position[2];
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len; const uz = dz / len;
        const sx = pose.target[0] - ux * (14 + back);
        const sz = pose.target[2] - uz * (14 + back);
        T.teleport(sx, T.heightAt(sx, sz) + 1.2, sz);
        c.player.state.yaw = Math.atan2(-ux, -uz);
      }, { poseId: POSE, back: 4 + attempt * 4 });
      await page.evaluate(() => window.__BS.advanceTime(1.2, 1 / 60));
      await page.evaluate(() => { for (let i = 0; i < 4; i += 1) window.__BS.renderOnce(1 / 60); });
    }

    const screen = await page.evaluate(() => {
      const CH = window.__CH;
      const T = window.__BS;
      const c = T.ctx;
      const url = T.captureDataURL("image/png");
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = img.width; cv.height = img.height;
          const g2 = cv.getContext("2d");
          g2.drawImage(img, 0, 0);
          const px = g2.getImageData(0, 0, cv.width, cv.height).data;
          const COLS = 120; const ROWS = 68;
          const groups = {};
          let hits = 0;
          for (let iy = 0; iy < ROWS; iy += 1) {
            for (let ix = 0; ix < COLS; ix += 1) {
              const ndcX = (ix + 0.5) / COLS * 2 - 1;
              const ndcY = 1 - (iy + 0.5) / ROWS * 2;
              const hit = c.structures.probe(ndcX, ndcY);
              if (!hit || !hit.object.startsWith("structures-")) continue;
              const name = hit.object.replace("structures-", "");
              const sxp = Math.floor((ndcX * 0.5 + 0.5) * cv.width);
              const syp = Math.floor((1 - (ndcY * 0.5 + 0.5)) * cv.height);
              const o = (syp * cv.width + sxp) * 4;
              const rgb = [CH.toLinear(px[o] / 255), CH.toLinear(px[o + 1] / 255),
                CH.toLinear(px[o + 2] / 255)];
              (groups[name] || (groups[name] = [])).push(rgb);
              hits += 1;
            }
          }
          const out = { hits, width: cv.width, height: cv.height, by: {} };
          for (const [name, list] of Object.entries(groups)) {
            out.by[name] = { stat: CH.summarise(list), ramp: CH.ramp(list, 0.08) };
          }
          resolve(out);
        };
        img.src = url;
      });
    });

    const report = await page.evaluate(() => window.__BS.report());

    /* ------------------------------ print ------------------------------ */
    console.log(`pose ${POSE}   quality ${QUALITY}   `
      + `screen samples ${screen ? screen.hits : 0}\n`);
    console.log("GENERATOR MAP - linear texels, no tint");
    for (const name of SURFACES) {
      const s = surfaces[name];
      if (!s) { console.log(`  ${name.padEnd(11)} (absent)`); continue; }
      console.log(`  ${name.padEnd(11)}${fmtStat(s.map.stat)}`);
      console.log(`  ${" ".padEnd(11)}${fmtRamp(s.map.ramp)}`);
      console.log(`  ${" ".padEnd(11)}meanLin ${s.meanLin.toFixed(4)}  `
        + `albedoScale ${s.albedoScale.toFixed(2)}  `
        + `tint ${s.tintMean ? s.tintMean.map((v) => v.toFixed(2)).join(",") : "-"}  `
        + `distinct tints ${s.tintDistinct}`);
    }
    console.log("\nEFFECTIVE ALBEDO - map x merged vertex tint");
    for (const name of SURFACES) {
      const s = surfaces[name];
      if (!s || !s.albedo) continue;
      console.log(`  ${name.padEnd(11)}${fmtStat(s.albedo.stat)}  clip ${(s.clipFrac * 100).toFixed(1)}%`);
      console.log(`  ${" ".padEnd(11)}${fmtRamp(s.albedo.ramp)}`);
    }
    console.log("\nON SCREEN - graded framebuffer, raycast-classified");
    for (const [name, s] of Object.entries(screen ? screen.by : {})) {
      console.log(`  ${name.padEnd(11)}${fmtStat(s.stat)}`);
      console.log(`  ${" ".padEnd(11)}${fmtRamp(s.ramp)}`);
    }
    console.log(`\ndraw calls ${report.render ? report.render.calls : "?"}  `
      + `triangles ${report.render ? report.render.triangles : "?"}  `
      + `structure meshes ${report.structures ? report.structures.meshes : "?"}  `
      + `pieces ${report.structures ? report.structures.pieces : "?"}`);
    if (errors.length) console.log(`\n!! ${errors.length} console error(s): ${errors[0]}`);

    if (args.json) {
      await writeFile(path.resolve(root, String(args.json)),
        JSON.stringify({ pose: POSE, staged, surfaces, screen, report }, null, 2));
    }
    await page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
