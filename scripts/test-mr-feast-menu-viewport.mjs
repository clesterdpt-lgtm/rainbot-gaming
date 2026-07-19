import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_MENU_VIEWPORT_TEST_PORT || (49000 + (process.pid % 12000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-menu-viewport");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function serverResponds() {
  try {
    return (await fetch(`${baseUrl}/games/mr-feast-mansion.html`, { cache: "no-store" })).ok;
  } catch (_) {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await serverResponds()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function overlayLayout(page, selectors) {
  return page.evaluate(({ overlaySelector, panelSelector, buttonSelector }) => {
    const stage = document.getElementById("mansion-stage");
    const overlay = document.querySelector(overlaySelector);
    const panel = overlay?.querySelector(panelSelector);
    const buttons = Array.from(overlay?.querySelectorAll(buttonSelector) || []);
    const stageRect = stage?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      stage: stageRect && { top: stageRect.top, bottom: stageRect.bottom, width: stageRect.width, height: stageRect.height },
      panel: panelRect && { top: panelRect.top, bottom: panelRect.bottom, width: panelRect.width, height: panelRect.height },
      overlayClientHeight: overlay?.clientHeight || 0,
      overlayScrollHeight: overlay?.scrollHeight || 0,
      overlayScrollTop: overlay?.scrollTop || 0,
      overlayClientWidth: overlay?.clientWidth || 0,
      overlayScrollWidth: overlay?.scrollWidth || 0,
      pageClientHeight: document.documentElement.clientHeight,
      pageScrollHeight: document.documentElement.scrollHeight,
      buttons: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { id: button.id, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height };
      }),
    };
  }, selectors);
}

function assertOverlayContained(layout, name) {
  assert(layout.stage && layout.panel, `${name}: stage or menu panel is missing; layout=${JSON.stringify(layout)}`);
  assert(layout.stage.top >= -1 && layout.stage.bottom <= layout.viewport.height + 1, `${name}: game stage does not fit within the visible browser screen; layout=${JSON.stringify(layout)}`);
  assert(layout.overlayScrollHeight <= layout.overlayClientHeight + 1, `${name}: menu still requires vertical scrolling; layout=${JSON.stringify(layout)}`);
  assert(layout.overlayScrollWidth <= layout.overlayClientWidth + 1, `${name}: menu still requires horizontal scrolling; layout=${JSON.stringify(layout)}`);
  assert(layout.panel.top >= layout.stage.top - 1 && layout.panel.bottom <= layout.stage.bottom + 1, `${name}: menu panel escapes the game stage; layout=${JSON.stringify(layout)}`);
  assert(layout.panel.top >= -1 && layout.panel.bottom <= layout.viewport.height + 1, `${name}: menu panel does not fit within the visible browser screen; layout=${JSON.stringify(layout)}`);
  for (const button of layout.buttons) {
    assert(button.top >= layout.stage.top - 1 && button.bottom <= layout.stage.bottom + 1, `${name}: ${button.id} is outside the visible game stage; layout=${JSON.stringify(layout)}`);
    assert(button.top >= -1 && button.bottom <= layout.viewport.height + 1, `${name}: ${button.id} is outside the visible browser screen; layout=${JSON.stringify(layout)}`);
    assert(button.height >= 43.5, `${name}: ${button.id} is smaller than the 44px interaction target; layout=${JSON.stringify(layout)}`);
  }
}

async function run() {
  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem("rainbot_game_save:mr-feast-mansion", JSON.stringify({
        version: 1,
        savedAt: 1784380000000,
        meta: { room: "GRAND FOYER", objective: "Continue the investigation" },
        data: {
          playerPosition: { x: 0, y: 1.4, z: 12.6 },
          yaw: Math.PI,
          pitch: 0,
          movement: { energy: 82, crouched: false },
          contestant13: { inventory: [], journalEntries: [], workroomScratches: [] },
        },
      }));
      window.__MR_FEAST_STAGE_SIZE_SAMPLES__ = [];
      const sample = () => {
        const stage = document.getElementById("mansion-stage");
        let started = false;
        try {
          started = Boolean(JSON.parse(window.render_game_to_text?.() || "{}").started);
        } catch (_) {}
        if (stage) {
          const rect = stage.getBoundingClientRect();
          window.__MR_FEAST_STAGE_SIZE_SAMPLES__.push({
            at: performance.now(),
            started,
            height: rect.height,
            canvasHeight: document.getElementById("mansion-canvas")?.getBoundingClientRect().height || 0,
          });
          if (window.__MR_FEAST_STAGE_SIZE_SAMPLES__.length > 2400) window.__MR_FEAST_STAGE_SIZE_SAMPLES__.shift();
        }
        requestAnimationFrame(sample);
      };
      document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(sample), { once: true });
    });

    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });

    const introSelectors = {
      overlaySelector: "#mansion-intro",
      panelSelector: ".mansion-intro__panel",
      buttonSelector: ".mansion-intro__actions button",
    };
    const menuSelectors = {
      overlaySelector: "#mansion-menu",
      panelSelector: ".mansion-menu__panel",
      buttonSelector: ".mansion-menu__button",
    };

    const introShortDesktop = await overlayLayout(page, introSelectors);
    assertOverlayContained(introShortDesktop, "1024x600 intro");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "intro-short-desktop.png") });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(150);
    const introDesktop = await overlayLayout(page, introSelectors);
    assertOverlayContained(introDesktop, "1280x720 intro");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    const introPortrait = await overlayLayout(page, introSelectors);
    assertOverlayContained(introPortrait, "390x844 intro");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "intro-mobile-portrait.png") });

    await page.setViewportSize({ width: 390, height: 667 });
    await page.waitForTimeout(150);
    const introShortPortrait = await overlayLayout(page, introSelectors);
    assertOverlayContained(introShortPortrait, "390x667 intro");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "intro-short-portrait.png") });

    await page.setViewportSize({ width: 560, height: 600 });
    await page.waitForTimeout(150);
    const introWidePhone = await overlayLayout(page, introSelectors);
    assertOverlayContained(introWidePhone, "560x600 intro");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "intro-wide-phone.png") });

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(150);
    const introLandscape = await overlayLayout(page, introSelectors);
    assertOverlayContained(introLandscape, "844x390 intro");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "intro-short-landscape.png") });

    await page.setViewportSize({ width: 568, height: 320 });
    await page.waitForTimeout(150);
    const introCompactLandscape = await overlayLayout(page, introSelectors);
    assertOverlayContained(introCompactLandscape, "568x320 intro");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "intro-compact-landscape.png") });

    await page.setViewportSize({ width: 1024, height: 600 });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.__MR_FEAST_STAGE_SIZE_SAMPLES__ = []; });
    await page.locator("#mansion-enter").click({ force: true });
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).started);
    await page.waitForTimeout(1400);

    const stageSizing = await page.evaluate(() => {
      const samples = window.__MR_FEAST_STAGE_SIZE_SAMPLES__;
      const heights = samples.map((sample) => sample.height);
      const canvasHeights = samples.map((sample) => sample.canvasHeight);
      return {
        count: samples.length,
        startedCount: samples.filter((sample) => sample.started).length,
        first: heights[0],
        last: heights.at(-1),
        min: Math.min(...heights),
        max: Math.max(...heights),
        canvasMin: Math.min(...canvasHeights),
        canvasMax: Math.max(...canvasHeights),
      };
    });
    assert(stageSizing.count >= 5 && stageSizing.startedCount >= 1, `stage-size probe did not cover boot through Start; sizing=${JSON.stringify(stageSizing)}`);
    assert(stageSizing.max <= 410, `1024x600 game stage exceeds its responsive viewport budget; sizing=${JSON.stringify(stageSizing)}`);
    assert(stageSizing.max - stageSizing.min <= 2, `game stage grows during boot/Start instead of remaining stable; sizing=${JSON.stringify(stageSizing)}`);

    const initialStage = await page.evaluate(() => {
      const stage = document.getElementById("mansion-stage").getBoundingClientRect();
      const canvas = document.getElementById("mansion-canvas").getBoundingClientRect();
      return { stage: stage.height, canvas: canvas.height };
    });
    await page.setViewportSize({ width: 1024, height: 720 });
    await page.waitForTimeout(150);
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.waitForTimeout(150);
    const returnedStage = await page.evaluate(() => {
      const stage = document.getElementById("mansion-stage").getBoundingClientRect();
      const canvas = document.getElementById("mansion-canvas").getBoundingClientRect();
      return { stage: stage.height, canvas: canvas.height };
    });
    assert(Math.abs(returnedStage.stage - initialStage.stage) <= 1 && Math.abs(returnedStage.canvas - initialStage.canvas) <= 1, `game stage did not return to its original height after a grow/shrink viewport cycle; initial=${JSON.stringify(initialStage)} returned=${JSON.stringify(returnedStage)}`);

    const scrollBeforeMenu = await page.evaluate(() => scrollY);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).menus.escapeOpen);
    const scrollAfterMenu = await page.evaluate(() => scrollY);
    assert(Math.abs(scrollAfterMenu - scrollBeforeMenu) <= 1, `opening the pause menu changed page scroll position from ${scrollBeforeMenu} to ${scrollAfterMenu}`);
    const shortDesktop = await overlayLayout(page, menuSelectors);
    assertOverlayContained(shortDesktop, "1024x600 pause menu");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "menu-short-desktop.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    const portrait = await overlayLayout(page, menuSelectors);
    assertOverlayContained(portrait, "390x844 pause menu");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "menu-mobile-portrait.png") });

    await page.setViewportSize({ width: 390, height: 667 });
    await page.waitForTimeout(150);
    const shortPortrait = await overlayLayout(page, menuSelectors);
    assertOverlayContained(shortPortrait, "390x667 pause menu");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "menu-short-portrait.png") });

    await page.setViewportSize({ width: 560, height: 600 });
    await page.waitForTimeout(150);
    const widePhone = await overlayLayout(page, menuSelectors);
    assertOverlayContained(widePhone, "560x600 pause menu");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "menu-wide-phone.png") });

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(150);
    const landscape = await overlayLayout(page, menuSelectors);
    assertOverlayContained(landscape, "844x390 pause menu");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "menu-short-landscape.png") });

    await page.setViewportSize({ width: 568, height: 320 });
    await page.waitForTimeout(150);
    const compactLandscape = await overlayLayout(page, menuSelectors);
    assertOverlayContained(compactLandscape, "568x320 pause menu");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "menu-compact-landscape.png") });

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log(`Mr. Feast menu viewport regression passed: stage ${stageSizing.min.toFixed(1)}-${stageSizing.max.toFixed(1)}px with scroll-free desktop, portrait, and landscape menus`);
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast menu viewport regression failed: ${error.message}`);
  process.exitCode = 1;
});
