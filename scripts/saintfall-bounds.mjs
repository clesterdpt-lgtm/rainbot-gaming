#!/usr/bin/env node
/* ============================================================
   SAINTFALL - merged-mesh bounds audit

   Reports every world mesh's bounding sphere and flags any whose
   radius is wildly larger than its district, or whose centre has
   been dragged toward the origin.

   Written because a probe standing at the pilgrim camp reported it
   was looking at `choir-rock`, a mesh belonging to a district 800m
   away. The usual cause of that is stray vertices at (0,0,0): the
   geometry merger fills missing attributes with zeros, so one
   unpainted input in a batch of painted ones puts a fan of
   triangles at the world origin and inflates the bounds to cover
   the entire map.
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 46000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const r = await fetch(`${BASE}/games/saintfall.html`, { cache: "no-store" });
      if (r.ok) return;
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
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=medium`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

    const report = await page.evaluate(() => {
      const T = window.__SF;
      const D = T.ctx.districts;
      const rows = [];
      for (const m of T.world.meshes) {
        const g = m.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (!g.boundingBox) g.computeBoundingBox();
        const s = g.boundingSphere;
        const d = D[m.userData.district];
        // How many vertices sit within a metre of the world origin?
        // Anything but zero in a district mesh is a merge fault.
        const p = g.attributes.position;
        let atOrigin = 0;
        for (let i = 0; i < p.count; i += 1) {
          if (Math.abs(p.getX(i)) < 1 && Math.abs(p.getY(i)) < 1 && Math.abs(p.getZ(i)) < 1) {
            atOrigin += 1;
          }
        }
        rows.push({
          name: m.name,
          district: m.userData.district,
          verts: p.count,
          atOrigin,
          radius: Math.round(s.radius),
          centre: [Math.round(s.center.x), Math.round(s.center.y), Math.round(s.center.z)],
          expect: d ? [Math.round(d.x), Math.round(d.z), Math.round(d.r)] : null,
        });
      }
      return rows;
    });

    let bad = 0;
    console.log("mesh                      verts   @origin  radius  centre                 district centre/r");
    for (const r of report) {
      const drift = r.expect
        ? Math.round(Math.hypot(r.centre[0] - r.expect[0], r.centre[2] - r.expect[1]))
        : 0;
      const flag = (r.atOrigin > 0 && r.district !== "road" && r.district !== "scatter")
        || (r.expect && drift > r.expect[2] * 1.6);
      if (flag) bad += 1;
      console.log(
        `${flag ? "!!" : "  "} ${r.name.padEnd(24)} ${String(r.verts).padStart(7)} `
        + `${String(r.atOrigin).padStart(8)} ${String(r.radius).padStart(7)}  `
        + `${JSON.stringify(r.centre).padEnd(22)} ${r.expect ? JSON.stringify(r.expect) : "-"}`
        + (flag ? `   <-- drift ${drift}m` : "")
      );
    }
    console.log(`\n${bad} suspicious mesh(es)`);
    if (bad) process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
