#!/usr/bin/env node
/* ============================================================
   SAINTFALL - New game progression reset test
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 54000 + (process.pid % 4000);
const BASE = `http://127.0.0.1:${PORT}`;
const python = process.env.SAINTFALL_PYTHON || "/opt/homebrew/bin/python3";

const server = spawn(python,
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    if (detail) console.log(`        ${detail}`);
  }
}

try {
  let serverReady = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/games/saintfall.html`)).ok) { serverReady = true; break; }
    } catch (_) { /* retry */ }
    await delay(100);
  }
  if (!serverReady) throw new Error("local server did not start");

  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    // 1. Boot Saintfall with intro enabled
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=low&intro=1&seed=new-game-reset-test`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 120000 });

    console.log("\n=== TEST 1: Elevate career progress, then start a new game ===");

    // Advance XP and spend points
    const beforeState = await page.evaluate(() => {
      const T = window.__SF;
      // Grant XP to reach Rank 5
      T.grantProgressionXpForQA(1200, "qa-award-1");
      T.spendTalentForQA("censer_rite_of_censure");
      T.spendTalentForQA("censer_ashen_rebuke");
      return T.progressionState();
    });

    check("career is elevated before new game",
      beforeState.rank >= 2 && beforeState.totalXp > 0 && beforeState.pointsSpent > 0,
      `Rank: ${beforeState.rank}, XP: ${beforeState.totalXp}, Spent: ${beforeState.pointsSpent}`);

    // Click "NEW GAME" button on intro gate
    await page.evaluate(async () => {
      const startBtn = document.querySelector("[data-intro-start]");
      if (startBtn) startBtn.click();
      else await window.__SF.intro?.start?.();
    });

    // Wait for start to settle
    await page.waitForFunction(() => {
      const p = window.__SF?.progressionState?.();
      return p && p.rank === 1 && p.totalXp === 0;
    }, null, { timeout: 5000 });

    const afterResetState = await page.evaluate(() => window.__SF.progressionState());

    check("starting new game resets Field Rank to 1", afterResetState.rank === 1, `Rank: ${afterResetState.rank}`);
    check("starting new game resets total XP to 0", afterResetState.totalXp === 0, `XP: ${afterResetState.totalXp}`);
    check("starting new game resets spent Doctrine points to 0", afterResetState.pointsSpent === 0, `Spent: ${afterResetState.pointsSpent}`);
    check("starting new game resets Doctrine talent allocations",
      Object.keys(afterResetState.allocations || {}).length === 0
      || Object.values(afterResetState.allocations || {}).every((v) => v === 0),
      `Allocations: ${JSON.stringify(afterResetState.allocations)}`);
    check("starting new game resets active capstone Vows",
      (afterResetState.activeCapstones || []).every((v) => v === null),
      `Capstones: ${JSON.stringify(afterResetState.activeCapstones)}`);

    console.log("\n=== TEST 2: Progression reset method directly on save and progression services ===");
    const directReset = await page.evaluate(() => {
      const T = window.__SF;
      T.grantProgressionXpForQA(5000, "qa-award-2");
      const intermediate = T.progressionState();
      T.resetCareerForQA();
      const resetState = T.progressionState();
      return { intermediateRank: intermediate.rank, resetRank: resetState.rank, resetXp: resetState.totalXp };
    });

    check("intermediate rank was elevated", directReset.intermediateRank >= 12, `Rank: ${directReset.intermediateRank}`);
    check("resetCareer resets rank to 1", directReset.resetRank === 1, `Rank: ${directReset.resetRank}`);
    check("resetCareer resets XP to 0", directReset.resetXp === 0, `XP: ${directReset.resetXp}`);

    await context.close();
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error("Test failed with fatal error:", error);
  failed += 1;
} finally {
  server.kill("SIGTERM");
}

if (failed > 0) {
  console.log(`\n${failed} check(s) FAILED`);
  process.exit(1);
} else {
  console.log(`\nAll checks PASSED!`);
  process.exit(0);
}
