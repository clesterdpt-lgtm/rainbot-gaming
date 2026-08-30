#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49962;
const BASE = `http://127.0.0.1:${PORT}`;
const outDir = path.join(root, "output/saintfall/cathedral-floor");
fs.mkdirSync(outDir, { recursive: true });

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const findings = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) findings.push(label);
};

try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE}/games/saintfall.html`); if (r.ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => {
    console.error("[PAGEERROR]", err.message);
    pageErrors.push(err.message);
  });

  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 45000 });

  const phase1Survey = await page.evaluate(async () => {
    const T = window.__SF;
    const ctx = T.ctx;
    const d = ctx.world.DISTRICTS?.cathedral || { x: -95, z: -725 };
    const plazaY = ctx.terrain.field.cathedralPlazaY;

    // Teleport inside the Cathedral nave looking north
    // (x: -95, z: -680, facing north towards z = -760)
    T._teleportRaw(d.x, -680, Math.PI);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);

    // Check road geometry in the world batch
    // Examine all road geometries in scene to check their min Z (northing)
    let maxRoadZ = -Infinity;
    let minRoadZ = Infinity;
    let roadInCathedral = 0;

    // The cathedral nave bounds are x: [-117, -73], z: [-791, -655]
    ctx.scene.traverse((obj) => {
      if (obj.isMesh && (obj.name?.includes("road") || obj.userData?.tag === "road")) {
        const geo = obj.geometry;
        if (geo && geo.attributes?.position) {
          const pos = geo.attributes.position;
          for (let i = 0; i < pos.count; i += 1) {
            const z = pos.getZ(i);
            const x = pos.getX(i);
            if (z < minRoadZ) minRoadZ = z;
            if (z > maxRoadZ) maxRoadZ = z;
            if (z <= -655 && Math.abs(x - d.x) <= 30) {
              roadInCathedral += 1;
            }
          }
        }
      }
    });

    return {
      cathedralX: d.x,
      cathedralZ: d.z,
      plazaY,
      minRoadZ,
      maxRoadZ,
      roadInCathedral,
    };
  });

  console.log("\n=== CATHEDRAL FLOOR PHASE 1 SURVEY ===");
  console.log(`  Data: ${JSON.stringify(phase1Survey)}`);
  check(phase1Survey.roadInCathedral === 0,
    "No outside road geometry vertices exist inside the Cathedral nave (z <= -655)",
    `roadVertsInCathedral=${phase1Survey.roadInCathedral}`);
  check(phase1Survey.minRoadZ >= -655,
    "Pilgrim's Road terminates outside at the Cathedral plaza steps",
    `minRoadZ=${phase1Survey.minRoadZ}`);

  // Take screenshot of clean cathedral floor
  await page.screenshot({ path: path.join(outDir, "1-cathedral-floor-clean.png") });

  // Now trigger phase 2 (undercroft collapse)
  await page.evaluate(async () => {
    const T = window.__SF;
    const ctx = T.ctx;
    if (ctx.undercroft?.begin) {
      ctx.undercroft.begin();
    }
    for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);
  });

  // Take screenshot of phase 2 undercroft
  await page.screenshot({ path: path.join(outDir, "2-cathedral-phase2-undercroft.png") });

  check(pageErrors.length === 0, "Zero page errors during cathedral floor checks", pageErrors.join("; "));

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (findings.length > 0) {
  console.error(`\nFAILED: ${findings.length} check(s)`);
  process.exit(1);
} else {
  console.log("\nALL CATHEDRAL FLOOR CHECKS PASSED!");
  process.exit(0);
}
