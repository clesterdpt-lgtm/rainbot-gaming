#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49959;
const BASE = `http://127.0.0.1:${PORT}`;

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

  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&difficulty=penitent`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 45000 });

  const penitentSurvey = await page.evaluate(async () => {
    const T = window.__SF;
    const ctx = T.ctx;
    const arena = ctx.districtBosses.sites.find((s) => s.key === "reach");
    T._teleportRaw(arena.x, arena.z, 0);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);

    const inst = ctx.enemies.live.find((e) => e.key === "matriarch");
    return {
      health: inst ? inst.health : null,
      maxHealth: inst ? inst.maxHealth : null,
    };
  });

  console.log("\n=== MATRIARCH PENITENT TIER SURVEY ===");
  console.log(`  Data: ${JSON.stringify(penitentSurvey)}`);
  check(penitentSurvey.maxHealth === 15000,
    "Matriarch base max health increased to 15,000 on Penitent",
    `hp=${penitentSurvey.maxHealth}`);

  // Test Martyr difficulty tier
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&difficulty=martyr`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 45000 });

  const martyrSurvey = await page.evaluate(async () => {
    const T = window.__SF;
    const ctx = T.ctx;
    const arena = ctx.districtBosses.sites.find((s) => s.key === "reach");
    T._teleportRaw(arena.x, arena.z, 0);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);

    const inst = ctx.enemies.live.find((e) => e.key === "matriarch");
    const diff = ctx.difficulty?.current;

    return {
      tier: diff?.label,
      incoming: diff?.incoming,
      bossHealthScale: diff?.bossHealth,
      health: inst ? inst.health : null,
      maxHealth: inst ? inst.maxHealth : null,
    };
  });

  console.log("\n=== MATRIARCH MARTYR (HARDEST) TIER SURVEY ===");
  console.log(`  Data: ${JSON.stringify(martyrSurvey)}`);
  check(martyrSurvey.tier === "MARTYR", "Martyr tier is active");
  check(martyrSurvey.maxHealth === 22500,
    "Matriarch HP scales to 22,500 on Martyr (15,000 x 1.50)",
    `hp=${martyrSurvey.maxHealth}`);
  check(martyrSurvey.incoming === 1.25,
    "Martyr incoming player damage is 1.25x (+25%)",
    `incoming=${martyrSurvey.incoming}`);

  check(pageErrors.length === 0, "Zero page errors during Matriarch difficulty checks", pageErrors.join("; "));

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (findings.length > 0) {
  console.error(`\nFAILED: ${findings.length} check(s)`);
  process.exit(1);
} else {
  console.log("\nALL MATRIARCH SPEED & HP CHECKS PASSED!");
  process.exit(0);
}
