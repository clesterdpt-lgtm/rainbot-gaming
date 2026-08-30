#!/usr/bin/env node
/* Focused regression for the Saintfall new-game operative roster.

   It proves all three current bodies are selectable, their roster art
   and descriptions load, the panel stays inside the stage at the three
   supported layouts, and a changed selection survives the one-shot
   reload before the drop cinematic begins.
*/

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 49700 + (process.pid % 200);
const baseUrl = `http://127.0.0.1:${port}`;
const proofDir = path.join(root, "output", "playwright", "saintfall-character-select");
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

async function waitForGame(page) {
  await page.waitForFunction(() => Boolean(window.__SF?.figureInfo?.()?.assetSource), null,
    { timeout: 300000 });
}

async function rosterLayout(page, name, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(800);
  const layout = await page.evaluate(() => {
    const stage = document.querySelector("#sf-intro").getBoundingClientRect();
    const panel = document.querySelector('[data-intro-panel="characters"]').getBoundingClientRect();
    const cards = [...document.querySelectorAll("[data-intro-character]")].map((card) => {
      const box = card.getBoundingClientRect();
      return { id: card.dataset.introCharacter, width: box.width, height: box.height };
    });
    return {
      stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom },
      panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom },
      cards,
    };
  });
  const within = layout.panel.left >= layout.stage.left - 1
    && layout.panel.top >= layout.stage.top - 1
    && layout.panel.right <= layout.stage.right + 1
    && layout.panel.bottom <= layout.stage.bottom + 1;
  check(`${name} roster remains inside the game stage`,
    within && layout.cards.every((card) => card.width > 80 && card.height > 70),
    layout, "panel inside stage and every card has usable dimensions");
  await page.locator("#sf-intro").screenshot({ path: path.join(proofDir, `${name}.png`) });
}

let browser;
try {
  await waitForServer();
  await mkdir(proofDir, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/games/saintfall.html?qa=1&intro=force&introClock=manual&quality=low&character=vesper-reliquary`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForGame(page);
  await page.waitForFunction(() => window.__SF?.introState?.()?.revealed, null, { timeout: 300000 });
  await page.evaluate(() => window.__SF.maximize?.());
  await page.locator("[data-intro-start]").click();
  await page.waitForFunction(() => window.__SF?.introState?.()?.entryPanel === "characters", null,
    { timeout: 10000 });

  const roster = await page.evaluate(() => ({
    ids: [...document.querySelectorAll("[data-intro-character]")].map((card) => card.dataset.introCharacter),
    selected: document.querySelector('[data-intro-character][aria-checked="true"]')?.dataset.introCharacter,
    described: [...document.querySelectorAll("[data-intro-character]")].every((card) =>
      Boolean(card.querySelector("small")?.textContent?.trim()
        && card.querySelector(".sf-entry__character-copy > span:not(.sf-entry__character-traits)")?.textContent?.trim())),
    images: [...document.querySelectorAll("[data-intro-character] img")].map((image) => ({
      src: image.currentSrc,
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
  }));
  check("roster exposes exactly the three playable operatives",
    JSON.stringify(roster.ids) === JSON.stringify(["vesper-reliquary", "white-vigil", "bastion-penitent"]),
    roster.ids, ["vesper-reliquary", "white-vigil", "bastion-penitent"]);
  check("every operative has current square art and a playstyle description",
    roster.described && roster.images.every((image) => image.width === 768 && image.height === 768
      && image.src.includes("profile-v3.png")),
    roster, "three 768px profile-v3 images and three descriptions");
  check("Vesper Reliquary is the deterministic default",
    roster.selected === "vesper-reliquary", roster.selected, "vesper-reliquary");

  await page.locator('[data-intro-character="vesper-reliquary"]').press("ArrowRight");
  const keyboard = await page.evaluate(() => ({
    selected: document.querySelector('[data-intro-character][aria-checked="true"]')?.dataset.introCharacter,
    focused: document.activeElement?.dataset?.introCharacter,
    confirm: document.querySelector("[data-intro-character-confirm]")?.textContent?.trim(),
  }));
  check("arrow keys move selection and update confirmation",
    keyboard.selected === "white-vigil" && keyboard.focused === "white-vigil"
      && keyboard.confirm === "BEGIN AS WHITE VIGIL",
    keyboard, { selected: "white-vigil", focused: "white-vigil", confirm: "BEGIN AS WHITE VIGIL" });

  await rosterLayout(page, "desktop-1440x900", { width: 1440, height: 900 });
  await rosterLayout(page, "portrait-430x932", { width: 430, height: 932 });
  await rosterLayout(page, "landscape-844x390", { width: 844, height: 390 });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('[data-intro-character="bastion-penitent"]').click();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
    page.locator("[data-intro-character-confirm]").click(),
  ]);
  await waitForGame(page);
  await page.waitForFunction(() => window.__SF?.introState?.()?.started, null, { timeout: 300000 });
  const bastion = await page.evaluate(() => ({
    character: window.__SF.introState().characterId,
    mode: window.__SF.introState().mode,
    launchMode: window.__SF.introState().launchMode,
    asset: window.__SF.figureInfo().assetSource,
    url: location.href,
    stored: localStorage.getItem("sf-saintfall-character"),
  }));
  check("confirming Bastion reloads the matching live body and starts a new drop",
    bastion.character === "bastion-penitent" && bastion.mode === "running"
      && bastion.launchMode === "new" && bastion.asset === "red-bastion-player.glb"
      && bastion.stored === "bastion-penitent" && !new URL(bastion.url).searchParams.has("newGame"),
    bastion, "Bastion body, durable selection, running new drop, one-shot flag removed");

  await page.goto(`${baseUrl}/games/saintfall.html?qa=1&intro=0&quality=low&character=white-vigil`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForGame(page);
  const white = await page.evaluate(() => window.__SF.figureInfo().assetSource);
  check("White Vigil resolves to the current live body",
    white === "white-vigil-player.glb", white, "white-vigil-player.glb");

  check("browser console remains clean", consoleErrors.length === 0 && pageErrors.length === 0,
    { consoleErrors, pageErrors }, "no console or page errors");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

const failures = checks.filter((entry) => !entry.pass);
console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
if (failures.length) process.exitCode = 1;
