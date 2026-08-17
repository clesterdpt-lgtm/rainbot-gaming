#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 56600 + (process.pid % 800);
const base = `http://127.0.0.1:${port}`;
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let browser;
try {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=low&intro=skip&seed=arena-entry`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 60000 });

  const results = await page.evaluate(async () => {
    const T = window.__SF;
    T.invulnerable(true);
    const H = T.ctx.districtBosses;
    const M = T.ctx.mission;
    const ps = T.ctx.player.state;

    const tests = [];

    for (const siteKey of ["reach", "censer", "saint"]) {
      if (siteKey === "saint") {
        for (const boss of M.bosses) {
          if (boss.key !== "saint") M.completeDistrictBoss(boss.key);
        }
      }
      const site = M.bosses.find((b) => b.key === siteKey);
      if (!site) continue;

      const events = [];
      const offs = [
        H.bus.on("approach", (e) => events.push(`approach:${e.key}`)),
        H.bus.on("exitWarning", (e) => events.push(`exit:${e.key}`)),
        H.bus.on("arenaReset", (e) => events.push(`reset:${e.key}`)),
      ];

      // 1. Approach from outside (warning band)
      ps.x = site.x + site.arenaRadius + 15;
      ps.z = site.z;
      H.update(0.05);

      const hadApproach = events.includes(`approach:${siteKey}`);
      const hadExitOnApproach = events.includes(`exit:${siteKey}`);

      // 2. Step into arena perimeter (just inside edge)
      ps.x = site.x + site.arenaRadius - 2;
      ps.z = site.z;
      H.update(0.05);

      // Walk into aggro zone
      ps.x = site.x + (site.aggroRadius ? site.aggroRadius - 10 : 20);
      ps.z = site.z;
      H.update(0.05);

      // Wait until boss reaches active combat
      for (let i = 0; i < 50; i++) {
        H.update(0.1);
        T.advanceTime(0.1, 1 / 60);
      }

      const activeStatus = H.status(siteKey);
      const hadExitOnEntry = events.includes(`exit:${siteKey}`);

      // 3. Move deep into interior
      ps.x = site.x + 10;
      ps.z = site.z;
      H.update(0.05);
      const hadExitInInterior = events.includes(`exit:${siteKey}`);

      // 4. Retreat outward toward perimeter (within exit warning band)
      const exitBand = Math.min(24, Math.max(12, site.arenaRadius * 0.25));
      ps.x = site.x + site.arenaRadius - (exitBand * 0.5);
      ps.z = site.z;
      H.update(0.05);

      const hadExitOnRetreat = events.includes(`exit:${siteKey}`);

      // 5. Cross fully outside
      ps.x = site.x + site.arenaRadius + 5;
      ps.z = site.z;
      H.update(0.05);

      const hadReset = events.includes(`reset:${siteKey}`);

      for (const off of offs) off?.();

      tests.push({
        siteKey,
        hadApproach,
        hadExitOnApproach,
        hadExitOnEntry,
        hadExitInInterior,
        hadExitOnRetreat,
        hadReset,
        statusPhase: activeStatus?.phase,
      });
    }

    return tests;
  });

  let passed = true;
  console.log("=== BOSS ARENA ENTRY & RETREAT PROBE ===");
  for (const t of results) {
    console.log(`\nSite: ${t.siteKey} (Phase: ${t.statusPhase})`);
    console.log(`  Approach warning: ${t.hadApproach ? "PASS" : "FAIL"}`);
    console.log(`  No exit warning on approach: ${!t.hadExitOnApproach ? "PASS" : "FAIL"}`);
    console.log(`  No exit warning on entry: ${!t.hadExitOnEntry ? "PASS" : "FAIL"}`);
    console.log(`  No exit warning in interior: ${!t.hadExitInInterior ? "PASS" : "FAIL"}`);
    console.log(`  Exit warning on retreat: ${t.hadExitOnRetreat ? "PASS" : "FAIL"}`);
    console.log(`  Reset when crossing out: ${t.hadReset ? "PASS" : "FAIL"}`);

    if (!t.hadApproach || t.hadExitOnApproach || t.hadExitOnEntry || t.hadExitInInterior || !t.hadExitOnRetreat || !t.hadReset) {
      passed = false;
    }
  }

  if (passed) {
    console.log("\nALL ARENA ENTRY TESTS PASSED! No false exit warnings on entry.");
    process.exit(0);
  } else {
    console.error("\nTESTS FAILED!");
    process.exit(1);
  }
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
