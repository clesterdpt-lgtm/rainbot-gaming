#!/usr/bin/env node
/* ============================================================
   BLACKSAND - grazing-angle relief probe

   Re-tests one standing reviewer complaint that has never been closed:
   "at grazing angles the walls stay perfectly flat".

   The measurement is an A/B on the thing that is supposed to be
   producing the relief. Capture the frame twice, once with the
   structures' normal maps at their authored strength and once with
   `normalScale` at zero, and bin the per-pixel difference by the
   INCIDENCE ANGLE between the view ray and the surface, taken from a
   raycast rather than guessed from screen position.

   That gives the one number the question actually needs: how much of
   what you see on a wall is the normal map, as a function of how
   obliquely you are looking at it. If it holds up at 80 degrees the
   complaint is about something else; if it collapses, the wall really
   is flat where the reviewer says it is, and the fix is parallax or
   geometry.

   Uses gameplay framing (eye height, weapon in hand) for the same
   reason everything else here does: the beauty poses are wide vistas
   and a wall at 3-15m at a grazing angle only exists in the gameplay
   set.

   Usage:
     node scripts/blacksand-grazing-probe.mjs
     node scripts/blacksand-grazing-probe.mjs --poses street,alley,compound
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
const PORT = Number(args.port || 46000 + (process.pid % 9000));
const BASE = `http://127.0.0.1:${PORT}`;
const POSES = String(args.poses && args.poses !== true
  ? args.poses : "street,alley,compound,checkpoint").split(",");

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

    // Helpers, installed once.
    await page.evaluate(() => {
      const W = window;
      W.__GZ = {
        capture() {
          const url = W.__BS.captureDataURL("image/png");
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const cv = document.createElement("canvas");
              cv.width = img.width; cv.height = img.height;
              const g = cv.getContext("2d");
              g.drawImage(img, 0, 0);
              resolve(g.getImageData(0, 0, cv.width, cv.height));
            };
            img.src = url;
          });
        },
        /** Every structures material, so normalScale can be A/B'd. */
        structMaterials() {
          const out = [];
          for (const mesh of (W.__BS.ctx.structures.group.children || [])) {
            if (mesh.isMesh && mesh.material && mesh.material.normalScale
              && !out.includes(mesh.material)) out.push(mesh.material);
          }
          return out;
        },
      };
    });

    const results = [];
    for (const poseId of POSES) {
      const staged = await page.evaluate((id) => {
        const T = window.__BS; const c = T.ctx;
        const pose = (c.world.getBeautyShots() || []).find((p) => p.id === id);
        if (!pose) return null;
        T.releaseCamera();
        T.hideHud(true);
        if (c.viewmodel && c.viewmodel.setVisible) c.viewmodel.setVisible(true);
        const dx = pose.target[0] - pose.position[0];
        const dz = pose.target[2] - pose.position[2];
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len; const uz = dz / len;
        const sx = pose.target[0] - ux * 14;
        const sz = pose.target[2] - uz * 14;
        T.teleport(sx, T.heightAt(sx, sz) + 1.2, sz);
        c.player.state.yaw = Math.atan2(-ux, -uz);
        c.player.state.pitch = -0.06;
        if (pose.timeOfDay !== undefined) T.setTimeOfDay(pose.timeOfDay);
        return { id };
      }, poseId);
      if (!staged) { console.log(`  ${poseId}: no such pose`); continue; }

      await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
      await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });

      const out = await page.evaluate(async () => {
        const W = window;
        const T = W.__BS;
        const c = T.ctx;
        const A = await W.__GZ.capture();

        // Classify a grid of pixels by incidence angle first, while the
        // scene is untouched.
        const COLS = 150; const ROWS = 86;
        const cells = [];
        for (let iy = 0; iy < ROWS; iy += 1) {
          for (let ix = 0; ix < COLS; ix += 1) {
            const ndcX = (ix + 0.5) / COLS * 2 - 1;
            const ndcY = 1 - (iy + 0.5) / ROWS * 2;
            const hit = c.structures.probe(ndcX, ndcY);
            if (!hit || !hit.object.startsWith("structures-")) continue;
            if (hit.object === "structures-contact" || !hit.normal) continue;
            const n = hit.normal; const r = hit.ray;
            // Incidence measured from the surface NORMAL: 0 is head on,
            // 90 is edge on.
            const dot = Math.abs(n[0] * r[0] + n[1] * r[1] + n[2] * r[2]);
            const inc = Math.acos(Math.min(1, dot)) * 180 / Math.PI;
            const px = Math.floor((ndcX * 0.5 + 0.5) * A.width);
            const py = Math.floor((1 - (ndcY * 0.5 + 0.5)) * A.height);
            cells.push({ px, py, inc, d: hit.distance, name: hit.object.replace("structures-", "") });
          }
        }

        // A/B the normal maps.
        const mats = W.__GZ.structMaterials();
        const saved = mats.map((m) => m.normalScale.clone());
        for (const m of mats) { m.normalScale.set(0, 0); m.needsUpdate = true; }
        for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
        const B = await W.__GZ.capture();
        mats.forEach((m, i) => { m.normalScale.copy(saved[i]); m.needsUpdate = true; });
        for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);

        const luma = (data, o) => 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
        // 3x3 high-pass, as a stand-in for "does this surface have any
        // readable texture at all".
        const highPass = (data, px, py) => {
          if (px < 1 || py < 1 || px >= A.width - 1 || py >= A.height - 1) return null;
          let sum = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              sum += luma(data, ((py + dy) * A.width + (px + dx)) * 4);
            }
          }
          const centre = luma(data, (py * A.width + px) * 4);
          return Math.abs(centre - sum / 9);
        };

        const BANDS = [[0, 30], [30, 50], [50, 65], [65, 75], [75, 83], [83, 90]];
        const acc = BANDS.map(() => ({ n: 0, lumA: 0, diff: 0, hpA: 0, hpB: 0, near: 0 }));
        for (const cell of cells) {
          const bi = BANDS.findIndex((b) => cell.inc >= b[0] && cell.inc < b[1]);
          if (bi < 0) continue;
          const o = (cell.py * A.width + cell.px) * 4;
          const la = luma(A.data, o);
          const lb = luma(B.data, o);
          const ha = highPass(A.data, cell.px, cell.py);
          const hb = highPass(B.data, cell.px, cell.py);
          if (ha === null) continue;
          const a = acc[bi];
          a.n += 1; a.lumA += la; a.diff += Math.abs(la - lb);
          a.hpA += ha; a.hpB += hb;
          if (cell.d >= 3 && cell.d <= 15) a.near += 1;
        }
        return {
          bands: BANDS.map((b, i) => ({
            from: b[0], to: b[1],
            n: acc[i].n,
            near: acc[i].near,
            lum: acc[i].n ? acc[i].lumA / acc[i].n : 0,
            // Normal-map contribution, as a fraction of the band's own
            // brightness. Normalising matters: a grazing wall is also a
            // dimmer wall, and an unnormalised difference would fall for
            // that reason alone.
            normalShare: acc[i].n
              ? (acc[i].diff / acc[i].n) / Math.max(1, acc[i].lumA / acc[i].n) : 0,
            detail: acc[i].n ? (acc[i].hpA / acc[i].n) / Math.max(1, acc[i].lumA / acc[i].n) : 0,
            detailFlat: acc[i].n ? (acc[i].hpB / acc[i].n) / Math.max(1, acc[i].lumA / acc[i].n) : 0,
          })),
          cells: cells.length,
          materials: mats.length,
        };
      });

      out.pose = poseId;
      results.push(out);
      console.log(`\n${poseId}   ${out.cells} structure samples, ${out.materials} materials`);
      console.log("  incidence   n   3-15m    lum   normalShare   detail  detail(flat)");
      for (const b of out.bands) {
        if (!b.n) continue;
        console.log(`  ${String(b.from).padStart(3)}-${String(b.to).padEnd(3)} `
          + `${String(b.n).padStart(5)} ${String(b.near).padStart(6)} `
          + `${b.lum.toFixed(1).padStart(7)} ${b.normalShare.toFixed(4).padStart(12)} `
          + `${b.detail.toFixed(4).padStart(9)} ${b.detailFlat.toFixed(4).padStart(12)}`);
      }
    }

    if (args.json) {
      await writeFile(path.resolve(root, String(args.json)),
        JSON.stringify(results, null, 2));
    }
    if (errors.length) console.log(`\n!! ${errors.length} console error(s): ${errors[0]}`);
    await page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
