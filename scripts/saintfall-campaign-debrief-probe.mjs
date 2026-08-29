#!/usr/bin/env node
/* Focused acceptance probe for Saintfall campaign scoring and debrief UI. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, "output/saintfall/campaign-debrief");
const port = 48000 + (process.pid % 9000);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` · ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(out, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    const text = message.text();
    if (text.includes("preloaded using link preload but not used")) return;
    consoleErrors.push(text);
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&intro=0&tutorial=0&quality=low&difficulty=martyr`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  console.log("\n=== SCORE CONTRACT ===");
  const contract = await page.evaluate(() => {
    const score = (values) => window.__SF.campaignScoreForQA(values).score;
    return {
      pilgrim: score({ difficulty: "pilgrim", elapsed: 3600, doctrineRank: 10 }),
      penitent: score({ difficulty: "penitent", elapsed: 3600, doctrineRank: 10 }),
      martyr: score({ difficulty: "martyr", elapsed: 3600, doctrineRank: 10 }),
      fast: score({ difficulty: "penitent", elapsed: 2400, doctrineRank: 10 }),
      slow: score({ difficulty: "penitent", elapsed: 5400, doctrineRank: 10 }),
      rankOne: score({ difficulty: "penitent", elapsed: 3600, doctrineRank: 1 }),
      rankTwentyFive: score({ difficulty: "penitent", elapsed: 3600, doctrineRank: 25 }),
    };
  });
  check("higher difficulty increases score",
    contract.martyr > contract.penitent && contract.penitent > contract.pilgrim,
    `${contract.pilgrim} < ${contract.penitent} < ${contract.martyr}`);
  check("quicker campaign clearing increases score", contract.fast > contract.slow,
    `${contract.fast} > ${contract.slow}`);
  check("higher Field Rank increases score", contract.rankTwentyFive > contract.rankOne,
    `${contract.rankTwentyFive} > ${contract.rankOne}`);

  console.log("\n=== FAIR DIFFICULTY TRACKING ===");
  const floor = await page.evaluate(() => {
    window.__SF.setDifficultyForQA("pilgrim");
    window.__SF.setDifficultyForQA("martyr");
    return window.__SF.campaignScoreStateForQA().scoredDifficulty;
  });
  check("run scores the lowest difficulty used", floor === "pilgrim", floor);
  const persistence = await page.evaluate(() => {
    const saved = window.__SF.saveSlot(0);
    window.__SF.setDifficultyForQA("martyr");
    const loaded = !!saved && window.__SF.loadSlot(0);
    const after = window.__SF.campaignScoreStateForQA();
    return {
      saved: !!saved,
      storedDifficulty: saved?.campaignScore?.scoredDifficulty || null,
      loaded,
      restoredDifficulty: after?.scoredDifficulty || null,
      completed: after?.completed === true,
    };
  });
  check("in-progress scoring state survives a field save and load",
    persistence.saved && persistence.loaded && !persistence.completed
      && persistence.storedDifficulty === "pilgrim"
      && persistence.restoredDifficulty === "pilgrim",
    `${persistence.storedDifficulty} -> ${persistence.restoredDifficulty}`);

  console.log("\n=== VICTORY DEBRIEF ===");
  const highBefore = await page.evaluate(() => window.RB?.getHighScore?.("saintfall") || 0);
  const completed = await page.evaluate(() => window.__SF.completeCampaignForQA(2700));
  await page.waitForFunction(() => window.__SF.campaignDebriefForQA()?.menu?.open === true
    && window.__SF.campaignDebriefForQA()?.visible === true, null, { timeout: 10000 });
  const debrief = await page.evaluate(() => window.__SF.campaignDebriefForQA());
  const repeated = await page.evaluate(() => {
    const first = window.__SF.campaignScoreStateForQA();
    const second = window.__SF.completeCampaignForQA(1200);
    return { first: first.result.score, second: second.result.score };
  });
  const highAfter = await page.evaluate(() => window.RB?.getHighScore?.("saintfall") || 0);
  check("victory opens the paused Operation debrief",
    debrief.visible && debrief.menu?.open && debrief.menu?.panel === "operation");
  check("debrief shows all three score factors",
    debrief.difficulty === "PILGRIM" && debrief.time === "45:00" && Number(debrief.rank) >= 1,
    `${debrief.difficulty} · ${debrief.time} · rank ${debrief.rank}`);
  check("debrief renders final and high score", !!debrief.score && !!debrief.best,
    `${debrief.score} / ${debrief.best}`);
  check("campaign completion is idempotent", repeated.first === repeated.second,
    `${repeated.first} = ${repeated.second}`);
  check("QA completion does not submit a public score",
    completed.result.eligible === false && highBefore === highAfter,
    `${highBefore} -> ${highAfter}`);
  const layouts = [
    ["desktop", 1440, 900],
    ["portrait", 430, 860],
    ["landscape", 844, 390],
  ];
  for (const [name, width, height] of layouts) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(180);
    const layout = await page.evaluate(() => {
      const debriefEl = document.querySelector("[data-campaign-debrief]");
      const content = document.querySelector(".sf-menu__content");
      return {
        debriefWidth: debriefEl?.getBoundingClientRect().width || 0,
        contentWidth: content?.clientWidth || 0,
        horizontalOverflow: Math.max(0, (content?.scrollWidth || 0) - (content?.clientWidth || 0)),
      };
    });
    check(`${name} debrief has no horizontal overflow`,
      layout.debriefWidth > 0 && layout.debriefWidth <= layout.contentWidth + 1
        && layout.horizontalOverflow <= 1,
      `${layout.debriefWidth.toFixed(0)}px in ${layout.contentWidth}px`);
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false });
  }

  await page.click('[data-menu-action="leaderboard"]');
  await page.waitForFunction(() => {
    const panel = document.querySelector("[data-rb-leaderboard]");
    const rect = panel?.getBoundingClientRect();
    return !!rect && document.querySelector("#sf-menu")?.hidden === true
      && rect.bottom > 0 && rect.top < innerHeight;
  }, null, { timeout: 5000 });
  const leaderboard = await page.evaluate(() => ({
    menuClosed: document.querySelector("#sf-menu")?.hidden === true,
    visible: (() => {
      const rect = document.querySelector("[data-rb-leaderboard]")?.getBoundingClientRect();
      return !!rect && rect.bottom > 0 && rect.top < innerHeight;
    })(),
    maximized: document.documentElement.classList.contains("sf-maximised"),
    radius: getComputedStyle(document.querySelector("[data-rb-leaderboard]")).borderRadius,
  }));
  check("debrief opens the shared high-score panel",
    leaderboard.menuClosed && leaderboard.visible && !leaderboard.maximized,
    `menu closed=${leaderboard.menuClosed} · panel visible=${leaderboard.visible}`);
  check("Saintfall high-score panel keeps hard-edged chrome",
    parseFloat(leaderboard.radius) === 0, `radius ${leaderboard.radius}`);

  check("debrief run has no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  check("debrief run has no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await writeFile(path.join(out, "report.json"), JSON.stringify({ results, contract, debrief }, null, 2));
  await browser.close();
} finally {
  server.kill("SIGTERM");
}

console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
