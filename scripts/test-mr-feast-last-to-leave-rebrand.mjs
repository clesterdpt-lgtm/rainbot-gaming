import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gamePath = path.join(root, "games", "mr-feast-mansion.html");
const catalogPath = path.join(root, "games.html");
const siteRuntimePath = path.join(root, "assets", "js", "main.js");
const coverRelative = "assets/img/mr-feast/card-mr-feast-last-to-eat-ai-v1.jpg";
const coverPath = path.join(root, coverRelative);
const artifactDir = path.join(root, "output", "playwright", "mr-feast-last-to-leave-rebrand");
const port = Number(process.env.PORT || 8000);
const origin = `http://127.0.0.1:${port}`;
const exactTitle = "Mr Feast: Last to Eat";

async function serverResponds() {
  try {
    const response = await fetch(`${origin}/games.html`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await serverResponds()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("local Rainbot server did not become ready");
}

async function inspectViewport(page, name, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(`${origin}/games/mr-feast-mansion.html?qa=1`, { waitUntil: "domcontentloaded" });
  await page.locator("h1").waitFor();
  await page.locator(".game-side__poster").waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector(".game-side__poster");
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready && typeof window.render_game_to_text === "function", null, { timeout: 120000 });
  const layout = await page.evaluate(() => ({
    title: document.querySelector("h1")?.textContent?.trim(),
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    stageWidth: document.getElementById("mansion-stage")?.getBoundingClientRect().width || 0,
    stageHeight: document.getElementById("mansion-stage")?.getBoundingClientRect().height || 0,
    posterWidth: document.querySelector(".game-side__poster")?.naturalWidth || 0,
    sharedEscapeMenu: Boolean(document.getElementById("rb-escape-menu") || document.querySelector(".rb-escape-btn")),
    nativeEscapeMenu: Boolean(document.getElementById("mansion-menu")),
    gameText: JSON.parse(window.render_game_to_text()),
  }));
  assert.equal(layout.title, exactTitle, `${name}: visible title should be exact`);
  assert(layout.scrollWidth <= layout.viewportWidth + 1, `${name}: page overflows horizontally (${layout.scrollWidth} > ${layout.viewportWidth})`);
  assert(layout.stageWidth >= Math.min(340, viewport.width - 28), `${name}: game stage is too narrow (${layout.stageWidth})`);
  assert(layout.stageHeight >= 300, `${name}: game stage is too short (${layout.stageHeight})`);
  assert(layout.posterWidth >= 1200, `${name}: cover should retain enough source resolution`);
  assert(!layout.sharedEscapeMenu, `${name}: shared Rainbot menu must not be injected into the mansion`);
  assert(layout.nativeEscapeMenu, `${name}: native mansion Escape menu must remain present`);
  assert(layout.gameText && typeof layout.gameText === "object", `${name}: render_game_to_text should expose live game state`);
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
}

async function inspectCatalog(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/games.html`, { waitUntil: "domcontentloaded" });
  const card = page.locator('a.directory-card[href="games/mr-feast-mansion.html"]');
  await card.scrollIntoViewIfNeeded();
  await card.locator("img").waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('a.directory-card[href="games/mr-feast-mansion.html"] img');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  const cardState = await card.evaluate((element) => ({
    title: element.getAttribute("data-title"),
    image: element.querySelector("img")?.getAttribute("src"),
    description: element.querySelector(".directory-card__body p")?.textContent?.trim(),
    status: element.querySelector(".directory-card__status")?.textContent?.trim(),
    headingCount: element.querySelectorAll(".directory-card__body h3").length,
  }));
  assert(cardState.title?.startsWith(exactTitle), `catalog: search title is wrong: ${cardState.title}`);
  assert(cardState.image?.startsWith(coverRelative), `catalog: cover is wrong: ${cardState.image}`);
  assert(/reality-show competition/i.test(cardState.description || "") && /sabotage/i.test(cardState.description || ""), `catalog: description is wrong: ${cardState.description}`);
  assert.equal(cardState.status, "Updated", "catalog: rebrand status is missing");
  assert.equal(cardState.headingCount, 0, "catalog: should not add a duplicate text title under cover art");
  await card.screenshot({ path: path.join(artifactDir, "catalog-card.png") });
}

async function run() {
  const [game, catalog, siteRuntime] = await Promise.all([
    readFile(gamePath, "utf8"),
    readFile(catalogPath, "utf8"),
    readFile(siteRuntimePath, "utf8"),
  ]);

  assert(game.includes(`<title>${exactTitle} - Rainbot Network</title>`), "document title is not updated");
  assert(game.includes(`<h1 class="game-page__title">${exactTitle}</h1>`), "visible game title is not updated");
  assert(game.includes(`property="og:title" content="${exactTitle}"`), "Open Graph title is missing");
  assert(game.includes(`property="og:image"`), "Open Graph cover metadata is missing");
  assert(game.includes('body class="rb-standalone-shell mansion-page"'), "game page is not using the shared standalone shell");
  assert(game.includes('data-rb-native-escape-menu="true"'), "page must opt out of the shared Escape-menu injection");
  assert(game.includes('class="game-layout mansion-layout"'), "game page is not using the shared game layout");
  assert(game.includes('class="game-stage rb-standalone-stage mansion-stage-shell"'), "shared game-stage wrapper is missing");
  assert(game.includes('class="canvas-wrap rb-standalone-surface mansion-surface"'), "shared game surface is missing");
  assert(game.includes('class="game-side mansion-aside"'), "shared game sidebar is missing");
  assert(game.includes('class="game-side__poster game-side__poster--wide"'), "detail-page cover is missing");
  assert(game.includes('class="game-side__panel game-side__panel--controls"'), "shared controls panel is missing");
  assert(game.includes('class="game-side__howto"'), "shared how-to panel is missing");
  for (const preservedId of ["mansion-intro", "mansion-menu", "mansion-menu-resume", "mansion-menu-save", "mansion-menu-load", "mansion-menu-dev"]) {
    assert(game.includes(`id="${preservedId}"`), `existing in-game UI was removed: #${preservedId}`);
  }
  assert(catalog.includes(`data-title="${exactTitle}`), "catalog search title is not updated");
  assert(catalog.includes("assets/img/cards/mr-feast-mansion.avif"), "catalog does not use the new cover");
  assert(/reality-show competition/i.test(catalog) && /sabotage/i.test(catalog), "catalog description does not match the current concept");
  assert(siteRuntime.includes('"mr-feast-mansion": { title: "Mr Feast: Last to Eat"'), "shared Rainbot title metadata is stale");
  assert(siteRuntime.includes(`image: "${coverRelative}?v=20260825-1"`), "recently-played/shared Rainbot art metadata is stale");
  assert(siteRuntime.includes('dataset.rbNativeEscapeMenu === "true"'), "shared site runtime does not honor native game menus");
  assert(!game.includes("Mr Feast's Mansion") && !catalog.includes("Mr Feast's Mansion"), "outdated promotional title remains player-facing");

  const metadata = await sharp(coverPath).metadata();
  assert(metadata.width >= 1200 && metadata.height >= 675, `cover is too small: ${metadata.width}x${metadata.height}`);
  assert(Math.abs((metadata.width / metadata.height) - (16 / 9)) < 0.02, `cover is not 16:9: ${metadata.width}x${metadata.height}`);

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\\.ico/i.test(message.text())) errors.push(message.text());
    });
    await inspectCatalog(page);
    await inspectViewport(page, "desktop", { width: 1440, height: 900 });
    await inspectViewport(page, "mobile", { width: 390, height: 844 });
    assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
    console.log("mr feast last-to-leave rebrand regression passed");
  } finally {
    await browser?.close();
    server?.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
