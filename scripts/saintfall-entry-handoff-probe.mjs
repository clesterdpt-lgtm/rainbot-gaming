#!/usr/bin/env node
/* Focused regression for the loader -> save-aware entry menu handoff.

   The loader may fade only after the entry menu is ready underneath it;
   otherwise the already-rendered orbital frame flashes between the two.
   The title check measures the rendered text rather than trusting the box,
   because a fixed-width heading can clip its final tracked letters.
*/

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 49300 + (process.pid % 500);
const baseUrl = `http://127.0.0.1:${port}`;
const proofDir = path.join(root, "output", "iterate", "2026-08-17-saintfall-entry-handoff");
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
});

const checks = [];
function check(name, pass, actual, expected) {
  checks.push({ name, pass: Boolean(pass), actual, expected });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
  if (!pass) console.log(`     actual: ${JSON.stringify(actual)}\n   expected: ${JSON.stringify(expected)}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/games/saintfall.html`, { cache: "no-store" });
      if (response.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

let browser;
try {
  await waitForServer();
  await mkdir(proofDir, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__SF_ENTRY_HANDOFF = { loaderHide: null };
    document.addEventListener("DOMContentLoaded", () => {
      const boot = document.getElementById("sf-boot");
      const intro = document.getElementById("sf-intro");
      if (!boot || !intro) return;
      new MutationObserver(() => {
        if (!boot.classList.contains("is-hidden") || window.__SF_ENTRY_HANDOFF.loaderHide) return;
        const introStyle = getComputedStyle(intro);
        window.__SF_ENTRY_HANDOFF.loaderHide = {
          introReady: intro.classList.contains("is-ready"),
          introAriaHidden: intro.getAttribute("aria-hidden"),
          introVisibility: introStyle.visibility,
          introOpacity: Number(introStyle.opacity),
        };
      }).observe(boot, { attributes: true, attributeFilter: ["class"] });
    }, { once: true });
  });

  await page.goto(`${baseUrl}/games/saintfall.html?quality=high&seed=entry-handoff-probe`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector("#sf-boot", { state: "visible", timeout: 10000 });

  const title = await page.evaluate(async () => {
    await document.fonts.ready;
    const element = document.querySelector(".sf-boot__title");
    const stage = document.querySelector(".sf-stage");
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    return {
      text: element.textContent.trim(),
      textRight: Number(text.right.toFixed(2)),
      boxRight: Number(box.right.toFixed(2)),
      stageRight: Number(stageBox.right.toFixed(2)),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });
  check("loading title contains the full name", title.text === "SAINTFALL", title.text, "SAINTFALL");
  check("loading title glyphs fit their heading box",
    title.scrollWidth <= title.clientWidth + 1 && title.textRight <= title.boxRight + 1,
    title, "scrollWidth <= clientWidth and rendered text remains inside the heading");
  check("loading title remains inside the stage", title.textRight <= title.stageRight + 1,
    title, "rendered title right edge <= stage right edge");
  await page.screenshot({
    path: path.join(proofDir, "loading-title-full.png"),
    fullPage: false,
  });

  await page.waitForFunction(() => window.__SF_ENTRY_HANDOFF?.loaderHide, null, { timeout: 300000 });
  const handoff = await page.evaluate(() => window.__SF_ENTRY_HANDOFF.loaderHide);
  check("entry menu is revealed before loader fade begins",
    handoff.introReady && handoff.introAriaHidden === "false"
      && handoff.introVisibility === "visible",
    handoff,
    { introReady: true, introAriaHidden: "false", introVisibility: "visible" });

  await page.waitForFunction(() => !document.getElementById("sf-boot"), null, { timeout: 5000 });
  const settled = await page.evaluate(() => ({
    introReady: document.getElementById("sf-intro")?.classList.contains("is-ready"),
    menuVisible: getComputedStyle(document.querySelector(".sf-intro__gate")).visibility !== "hidden",
    introMode: window.__SF?.introState?.()?.mode,
  }));
  check("loader settles directly on the save-aware entry menu",
    settled.introReady && settled.menuVisible && settled.introMode === "awaiting-gesture",
    settled,
    { introReady: true, menuVisible: true, introMode: "awaiting-gesture" });
  const state = await page.evaluate(() => {
    const before = window.__SF.report();
    const advance = window.__SF.advanceRuntimeTime(.1, 1 / 60);
    const after = window.__SF.report();
    return { before, after, advance, runtimePhase: window.__SF?.ctx?.runtime?.phase };
  });
  check("entry menu remains the blocking state after advancing time",
    state.runtimePhase === "awaiting-deploy"
      && state.before?.intro?.mode === "awaiting-gesture"
      && state.after?.intro?.mode === "awaiting-gesture",
    state,
    "runtime awaiting-deploy and intro awaiting-gesture before/after 100ms");
  await page.screenshot({
    path: path.join(proofDir, "save-aware-entry-menu.png"),
    fullPage: false,
  });
  await page.locator("[data-intro-start]").click();
  await page.waitForFunction(() => window.__SF?.introState?.()?.entryPanel === "characters", null,
    { timeout: 10000 });
  const roster = await page.evaluate(() => ({
    panel: window.__SF.introState().entryPanel,
    cards: [...document.querySelectorAll("[data-intro-character]")].map((card) => ({
      id: card.dataset.introCharacter,
      role: card.querySelector("small")?.textContent?.trim(),
      summary: card.querySelector(".sf-entry__character-copy > span:not(.sf-entry__character-traits)")?.textContent?.trim(),
      portraitReady: Boolean(card.querySelector("img")?.complete && card.querySelector("img")?.naturalWidth),
    })),
  }));
  check("new game opens the three-operative roster",
    roster.panel === "characters" && roster.cards.length === 3
      && roster.cards.every((card) => card.role && card.summary && card.portraitReady),
    roster, "characters panel with three described, loaded operative cards");
  await page.locator("[data-intro-character-confirm]").click();
  await page.waitForFunction(() => window.__SF?.introState?.()?.entryPanel === "briefing", null,
    { timeout: 10000 });
  const briefed = await page.evaluate(() => ({
    panel: window.__SF.introState().entryPanel,
    started: window.__SF.introState().started,
  }));
  check("operative confirmation opens the mission briefing before descent",
    briefed.panel === "briefing" && briefed.started === false,
    briefed, { panel: "briefing", started: false });
  await page.locator("[data-intro-briefing-deploy]").click();
  await page.waitForFunction(() => window.__SF?.introState?.()?.mode === "running", null,
    { timeout: 10000 });
  const launched = await page.evaluate(() => ({
    mode: window.__SF.introState().mode,
    shot: window.__SF.introState().shot,
    runtimePhase: window.__SF.ctx.runtime.phase,
  }));
  check("orbital intro begins only after the mission briefing is accepted",
    launched.mode === "running" && launched.shot === "orbit" && launched.runtimePhase === "intro",
    launched, { mode: "running", shot: "orbit", runtimePhase: "intro" });
  check("browser console remains clean", consoleErrors.length === 0 && pageErrors.length === 0,
    { consoleErrors, pageErrors }, "no console or page errors");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

const failures = checks.filter((entry) => !entry.pass);
console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
if (failures.length) process.exitCode = 1;
