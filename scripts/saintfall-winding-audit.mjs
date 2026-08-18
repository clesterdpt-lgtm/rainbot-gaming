#!/usr/bin/env node
/* ============================================================
   SAINTFALL - is the bestiary wound inside out?

   Every rigged creature is a Blender-kit export drawn with FrontSide,
   flat-shaded materials. Flat shading takes its normals from screen
   derivatives and a closed mesh has the same silhouette from either
   wall, so a mesh wound INSIDE OUT still reads as a solid animal from
   thirty metres - the GPU is drawing the far wall's interior, lit as
   if it were the near wall. It becomes a hole exactly where the
   Distaff was reported: up close, with legs behind the body to see
   through to. distaff.js corrects its own copy at dressing time
   (see INSIDE OUT there); this measures everyone.

   The measure is the SIGNED VOLUME of the bind-pose mesh - the sum of
   dot(a, cross(b, c)) / 6 over every triangle. Outward-wound closed
   surfaces are positive (a THREE.BoxGeometry is +1, a sphere +3.5);
   inside-out is negative. Open tubes contribute noise; the closed
   bodies dominate. Body-only (no leg/wing bones) is printed too, so
   a creature whose legs and body disagree shows as such.

   Usage:
     node scripts/saintfall-winding-audit.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 53900 + (process.pid % 6000);
const base = `http://127.0.0.1:${port}`;
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});
try {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => { window.__SF.maximize(); document.getElementById("sf-boot")?.remove(); });

  const out = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const signedVolume = (geo, filter) => {
      const pos = geo.attributes.position, idx = geo.index;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t = new THREE.Vector3();
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      let vol = 0, n = 0;
      for (let i = 0; i < triCount; i += 1) {
        const i0 = idx ? idx.getX(i * 3) : i * 3;
        const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
        const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
        if (filter && !filter(i0)) continue;
        a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
        vol += a.dot(t.crossVectors(b, c)) / 6;
        n += 1;
      }
      return { volume: Number(vol.toFixed(2)), tris: n };
    };
    const rows = [];
    const d0 = T.distaffState();
    for (const key of T.listSpecies()) {
      const inst = T.enemies.spawn(key, d0.x - 40, d0.z + 40, {});
      if (!inst?.skin?.geometry) { rows.push({ key, note: "no inst.skin to measure (procedural or module-built body)" }); continue; }
      const geo = inst.skin.geometry;
      const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
      const bones = inst.skin.skeleton.bones;
      const isBody = (v) => {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k += 1) { const w = sw.getComponent(v, k); if (w > bw) { bw = w; best = si.getComponent(v, k); } }
        return !/^(coxa|femur|tibia|foot|leg|wing)/.test(bones[best]?.name || "");
      };
      const all = signedVolume(geo);
      const body = signedVolume(geo, isBody);
      rows.push({ key, all: all.volume, tris: all.tris, body: body.volume, bodyTris: body.tris,
        verdict: all.volume < 0 ? "INSIDE OUT" : "outward" });
      T.enemies.remove(inst);
    }
    // The module's own dressed Distaff, after its correction.
    const dressed = T.enemies.live.find((e) => e.key === "distaff");
    if (dressed?.skin?.geometry) {
      const v = signedVolume(dressed.skin.geometry);
      rows.push({ key: "distaff (dressed, live)", all: v.volume, tris: v.tris,
        verdict: v.volume < 0 ? "INSIDE OUT" : "outward", corrected: !!T.distaffState().windingCorrected });
    }
    rows.push({ key: "THREE.BoxGeometry (reference)", all: signedVolume(new THREE.BoxGeometry(1, 1, 1)).volume, verdict: "outward" });
    return rows;
  });
  console.log("signed volume (m^3), whole mesh / body bones only:");
  for (const r of out) {
    if (r.note) { console.log(`  ${r.key.padEnd(30)} ${r.note}`); continue; }
    console.log(`  ${r.key.padEnd(30)} all=${String(r.all).padStart(9)}  body=${String(r.body ?? "-").padStart(9)}  ${r.verdict}${r.corrected ? " (corrected at dressing)" : ""}`);
  }
  await browser.close();
} finally {
  server.kill();
}
