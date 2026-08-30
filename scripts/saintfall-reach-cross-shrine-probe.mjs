#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49957;
const BASE = `http://127.0.0.1:${PORT}`;
const outDir = path.join(root, "output/saintfall/reach-cross-shrine");
await fs.mkdir(outDir, { recursive: true });

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
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[CONSOLE ERROR]", msg.text());
  });

  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 45000 });

  const survey = await page.evaluate(async () => {
    const T = window.__SF;
    const ctx = T.ctx;
    const arena = ctx.districtBosses.sites.find((s) => s.key === "reach");
    const poi = (ctx.world.pois || []).find((p) => p.id === "reach-cross");

    const distToArena = poi ? Math.hypot(poi.x - arena.x, poi.z - arena.z) : 78;
    // Teleport player in front of the shrine altar facing the cross
    const fwdX = (poi.x - arena.x) / distToArena;
    const fwdZ = (poi.z - arena.z) / distToArena;
    const camX = poi.x - fwdX * 10;
    const camZ = poi.z - fwdZ * 10;
    const faceYaw = Math.atan2(fwdX, fwdZ);

    T._teleportRaw(camX, camZ, faceYaw);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);

    const crossMesh = ctx.scene.getObjectByName("reach-meshy-choir-wheel-matriarch-edge");

    return {
      arena,
      poi,
      distToArena: +distToArena.toFixed(2),
      crossFound: !!crossMesh,
    };
  });

  console.log("\n=== MATRIARCH CROSS & CANDLE SHRINE SURVEY ===");
  console.log(`  Survey data: ${JSON.stringify(survey)}`);
  check(survey.poi !== null, "Cross POI exists in Gilded Reach", `pos=(${survey.poi?.x}, ${survey.poi?.z})`);
  check(survey.distToArena >= 76 && survey.distToArena <= 80,
    "Cross is at the edge of the flattened Matriarch area (r ~ 78m)",
    `dist=${survey.distToArena}m`);
  check(survey.crossFound, "Colossal cross landmark object spawned in scene");

  // Capture screenshot of cross and candles in day
  await page.screenshot({ path: path.join(outDir, "1-matriarch-cross-shrine-day.png") });

  // Set time of day to dusk / vespers to see candles glowing warmly
  await page.evaluate(() => {
    const T = window.__SF;
    if (T.ctx.sky?.setTime) T.ctx.sky.setTime(0.5); // Vespers / dusk
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
  });
  await page.screenshot({ path: path.join(outDir, "2-matriarch-cross-shrine-dusk.png") });

  check(pageErrors.length === 0, "Zero page errors during shrine inspection", pageErrors.join("; "));

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (findings.length > 0) {
  console.error(`\nFAILED: ${findings.length} check(s)`);
  process.exit(1);
} else {
  console.log("\nALL REACH CROSS & SHRINE CHECKS PASSED!");
  process.exit(0);
}
