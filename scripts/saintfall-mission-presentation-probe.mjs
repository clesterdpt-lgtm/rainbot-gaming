#!/usr/bin/env node
/* Focused acceptance probe for Saintfall canon, mission briefing, and victory wrap. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, "output/saintfall/mission-presentation");
const port = 49000 + (process.pid % 7000);
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
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (text.includes("preloaded using link preload but not used")) return;
    consoleErrors.push(text);
  });

  console.log("\n=== CANON AND PRE-DROP BRIEFING ===");
  await page.goto(`${base}/games/saintfall.html?qa=1&intro=force&tutorial=0&quality=low`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const roster = await page.evaluate(() => [...document.querySelectorAll("[data-intro-character]")]
    .map((card) => ({ id: card.dataset.introCharacter,
      name: card.querySelector(".sf-entry__character-copy strong")?.textContent?.trim() || "" })));
  const expectedRoster = [
    { id: "vesper-reliquary", name: "Saint Aurel" },
    { id: "white-vigil", name: "Saint Veyra" },
    { id: "bastion-penitent", name: "Saint Torren" },
  ];
  check("new Saint names keep the three durable character IDs",
    JSON.stringify(roster) === JSON.stringify(expectedRoster), JSON.stringify(roster));

  await page.click("[data-intro-start]");
  await page.click('[data-intro-character="vesper-reliquary"]');
  await page.click("[data-intro-character-confirm]");
  await page.waitForTimeout(120);
  const briefing = await page.evaluate(() => {
    const panel = document.querySelector('[data-intro-panel="briefing"]');
    const intro = window.__SF?.introStatus?.() || window.__SF?.intro?.status?.() || null;
    return {
      exists: !!panel,
      visible: !!panel && !panel.hidden,
      text: panel?.textContent?.replace(/\s+/g, " ").trim() || "",
      panel: intro?.entryPanel || null,
      started: !!intro?.started,
      deploy: !!panel?.querySelector("[data-intro-briefing-deploy]"),
    };
  });
  check("character confirmation opens the mission briefing",
    briefing.exists && briefing.visible && briefing.panel === "briefing", briefing.panel || "missing");
  check("briefing gates the drop until explicit deployment",
    briefing.deploy && briefing.started === false, `deploy=${briefing.deploy} · started=${briefing.started}`);
  const briefingCanon = briefing.text.toLowerCase();
  check("briefing establishes the orbital Saintfall",
    briefingCanon.includes("orbit") && briefingCanon.includes("saintfall"));
  check("briefing says the Bloom destroyed an ancient Saint statue",
    briefingCanon.includes("bloom") && briefingCanon.includes("ancient saint statue")
      && briefingCanon.includes("destroy"));
  check("briefing orders the Saint to reclaim Vesper-IX",
    briefingCanon.includes("reclaim") && briefingCanon.includes("vesper-ix"));

  const briefingLayouts = [
    ["desktop", 1440, 900], ["portrait", 430, 860], ["landscape", 844, 390],
  ];
  if (briefing.exists) {
    for (const [name, width, height] of briefingLayouts) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('[data-intro-panel="briefing"]');
        const gate = document.querySelector(".sf-intro__gate");
        const stage = document.querySelector("#sf-intro")?.getBoundingClientRect();
        const button = panel?.querySelector("[data-intro-briefing-deploy]");
        const rect = panel?.getBoundingClientRect();
        return {
          visible: !!rect && rect.width > 0 && rect.height > 0,
          withinStage: !!rect && !!stage && rect.left >= stage.left - 1
            && rect.right <= stage.right + 1 && rect.top >= stage.top - 1
            && rect.bottom <= stage.bottom + 1,
          overflow: Math.max(0, (gate?.scrollWidth || 0) - (gate?.clientWidth || 0)),
          radius: button ? getComputedStyle(button).borderRadius : "missing",
          rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            width: rect.width, height: rect.height } : null,
          stage: stage ? { left: stage.left, right: stage.right, top: stage.top,
            bottom: stage.bottom, width: stage.width, height: stage.height } : null,
          gate: gate ? (() => { const box = gate.getBoundingClientRect(); const style = getComputedStyle(gate); return {
            left: box.left, right: box.right, top: box.top, bottom: box.bottom,
            width: box.width, height: box.height, cssTop: style.top, cssBottom: style.bottom,
            cssHeight: style.height, transform: style.transform, padding: style.padding,
          }; })() : null,
        };
      });
      check(`${name} briefing contains without horizontal overflow`,
        layout.visible && layout.withinStage && layout.overflow <= 1,
        `within=${layout.withinStage} · overflow=${layout.overflow} · panel=${JSON.stringify(layout.rect)} · stage=${JSON.stringify(layout.stage)} · gate=${JSON.stringify(layout.gate)}`);
      check(`${name} briefing deploy control is hard-edged`, parseFloat(layout.radius) === 0,
        `radius ${layout.radius}`);
      await page.screenshot({ path: path.join(out, `briefing-${name}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click("[data-intro-briefing-deploy]");
    await page.waitForFunction(() => {
      const intro = window.__SF?.introStatus?.() || window.__SF?.intro?.status?.();
      return intro?.started === true;
    }, null, { timeout: 10000 });
    check("Begin Saintfall starts the drop",
      await page.evaluate(() => !!(window.__SF?.introStatus?.()
        || window.__SF?.intro?.status?.())?.started));
  } else {
    check("desktop briefing contains without horizontal overflow", false, "briefing missing");
    check("desktop briefing deploy control is hard-edged", false, "briefing missing");
    check("portrait briefing contains without horizontal overflow", false, "briefing missing");
    check("portrait briefing deploy control is hard-edged", false, "briefing missing");
    check("landscape briefing contains without horizontal overflow", false, "briefing missing");
    check("landscape briefing deploy control is hard-edged", false, "briefing missing");
    check("Begin Saintfall starts the drop", false, "briefing missing");
  }

  console.log("\n=== VICTORY WRAP TO MISSION RECORD ===");
  await page.goto(`${base}/games/saintfall.html?qa=1&intro=0&tutorial=0&quality=low`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => window.__SF.completeCampaignForQA(2700));
  await page.waitForFunction(() => window.__SF.campaignDebriefForQA()?.menu?.open === true,
    null, { timeout: 10000 });
  const wrap = await page.evaluate(() => {
    const el = document.querySelector("[data-mission-wrap]");
    const record = document.querySelector("[data-campaign-debrief]");
    const background = el ? getComputedStyle(el.querySelector(".sf-mission-wrap__art") || el).backgroundImage : "";
    return {
      exists: !!el,
      visible: !!el && !el.hidden,
      text: el?.textContent?.replace(/\s+/g, " ").trim() || "",
      background,
      recordVisible: !!record && !record.hidden,
      action: !!el?.querySelector('[data-menu-action="mission-record"]'),
    };
  });
  check("victory presents a mission-complete wrap before the record",
    wrap.exists && wrap.visible && !wrap.recordVisible && wrap.action,
    `wrap=${wrap.visible} · record=${wrap.recordVisible}`);
  check("mission wrap uses the project-local generated artwork",
    wrap.background.includes("/assets/img/saintfall/saintfall-mission-complete-v1.jpg")
      && !wrap.background.includes("https://"), wrap.background);
  check("mission wrap closes the operation with restrained reclamation copy",
    /MISSION COMPLETE/i.test(wrap.text) && /reclaim/i.test(wrap.text)
      && /ancient Saint/i.test(wrap.text), wrap.text.slice(0, 160));

  if (wrap.exists) {
    for (const [name, width, height] of briefingLayouts) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const layout = await page.evaluate(() => {
        const el = document.querySelector("[data-mission-wrap]");
        const card = el?.querySelector(".sf-mission-wrap__card");
        const button = el?.querySelector('[data-menu-action="mission-record"]');
        const rect = card?.getBoundingClientRect();
        return {
          visible: !!rect && rect.width > 0 && rect.height > 0,
          withinStage: !!rect && rect.left >= -1 && rect.right <= innerWidth + 1
            && rect.top >= -1 && rect.bottom <= innerHeight + 1,
          overflow: Math.max(0, (card?.scrollWidth || 0) - (card?.clientWidth || 0)),
          radius: button ? getComputedStyle(button).borderRadius : "missing",
        };
      });
      check(`${name} mission wrap contains without horizontal overflow`,
        layout.visible && layout.withinStage && layout.overflow <= 1,
        `within=${layout.withinStage} · overflow=${layout.overflow}`);
      check(`${name} mission-record control is hard-edged`, parseFloat(layout.radius) === 0,
        `radius ${layout.radius}`);
      await page.screenshot({ path: path.join(out, `victory-${name}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[data-menu-action="mission-record"]');
    await page.waitForFunction(() => {
      const wrapEl = document.querySelector("[data-mission-wrap]");
      const record = document.querySelector("[data-campaign-debrief]");
      return !!wrapEl && wrapEl.hidden && !!record && !record.hidden;
    }, null, { timeout: 5000 });
    const record = await page.evaluate(() => window.__SF.campaignDebriefForQA());
    check("View Mission Record reveals final and high score",
      record.visible && !!record.score && !!record.best, `${record.score} / ${record.best}`);
    check("mission record retains the shared high-score action",
      await page.locator('[data-menu-action="leaderboard"]').isVisible());
  } else {
    for (const [name] of briefingLayouts) {
      check(`${name} mission wrap contains without horizontal overflow`, false, "wrap missing");
      check(`${name} mission-record control is hard-edged`, false, "wrap missing");
    }
    check("View Mission Record reveals final and high score", false, "wrap missing");
    check("mission record retains the shared high-score action", false, "wrap missing");
  }

  check("presentation run has no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  check("presentation run has no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await writeFile(path.join(out, "report.json"), JSON.stringify({ results, roster, briefing, wrap }, null, 2));
  await browser.close();
} finally {
  server.kill("SIGTERM");
}

console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
