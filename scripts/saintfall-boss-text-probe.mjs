#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49956;
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
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

  const results = await page.evaluate(async () => {
    const T = window.__SF;
    const ctx = T.ctx;
    const districtBosses = ctx.districtBosses;
    const abbess = ctx.abbess;
    const matriarch = ctx.matriarch;
    const garner = ctx.garner;
    const stylite = ctx.stylite;

    // 1. Verify Matriarch Alert doesn't set redundant mission banner
    ctx.mission.state.banner = null;
    matriarch?.beginRouse?.();
    const bannerAfterReach = ctx.mission.state.banner;

    // 2. Test Abbess awakening
    ctx.mission.state.banner = null;
    abbess?.beginRouse?.();
    const bannerAfterAbbess = ctx.mission.state.banner;

    // 3. Test Abbess royal phase - verify NO "ROYAL CELL" announcement or alert
    const breachAlertEl = document.querySelector("#sf-breach-alert");
    const breachTitleEl = document.querySelector("#sf-breach-title");
    const breachKickerEl = document.querySelector("#sf-breach-kicker");

    ctx.mission.state.banner = null;
    abbess?.beginRoyal?.();
    const bannerAfterRoyal = ctx.mission.state.banner;
    const breachTitleAfterRoyal = breachTitleEl?.textContent || "";

    // 4. Test Garner awakening
    ctx.mission.state.banner = null;
    garner?.beginBreach?.();
    const bannerAfterGarner = ctx.mission.state.banner;

    // 5. Test Stylite awakening
    ctx.mission.state.banner = null;
    stylite?.beginRouse?.();
    const bannerAfterStylite = ctx.mission.state.banner;

    // 6. Test Abbess status readout
    const abbessStatus = abbess?.status?.();
    const hudBossData = ctx.hud?.readoutBoss?.();

    return {
      bannerAfterReach,
      bannerAfterAbbess,
      bannerAfterRoyal,
      breachTitleAfterRoyal,
      bannerAfterGarner,
      bannerAfterStylite,
      abbessStatus,
      hudBossData,
    };
  });

  console.log("\n=== SAINTFALL BOSS TEXT DEDUPLICATION & ABBESS CHECKS ===");
  check(results.bannerAfterReach === null, "No redundant mission banner during Matriarch alert", `banner=${results.bannerAfterReach}`);
  check(results.bannerAfterAbbess === null, "No redundant mission banner during Abbess awakening", `banner=${results.bannerAfterAbbess}`);
  check(results.bannerAfterGarner === null, "No redundant mission banner during Garner awakening", `banner=${results.bannerAfterGarner}`);
  check(results.bannerAfterStylite === null, "No redundant mission banner during Stylite awakening", `banner=${results.bannerAfterStylite}`);

  check(results.bannerAfterRoyal === null, "No 'ROYAL CELL' mission banner during Abbess royal phase", `banner=${results.bannerAfterRoyal}`);
  check(!results.breachTitleAfterRoyal.includes("ROYAL CELL"), "No 'A ROYAL CELL' breach alert shown during Abbess royal phase", `title=${results.breachTitleAfterRoyal}`);

  check(pageErrors.length === 0, "Zero page errors during boss text checks", pageErrors.join("; "));

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (findings.length > 0) {
  console.error(`\nFAILED: ${findings.length} check(s)`);
  process.exit(1);
} else {
  console.log("\nALL BOSS TEXT DEDUPLICATION CHECKS PASSED!");
  process.exit(0);
}
