import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_INTRO_LOAD_TEST_PORT || (47000 + (process.pid % 14000)));
const baseUrl = `http://127.0.0.1:${port}`;
const saveUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1`;
const introUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-intro-save-load");
const saveKey = "rainbot_game_save:mr-feast-mansion";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
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

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function waitForReady(page) {
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
}

async function run() {
  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn(
      "python3",
      ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root],
      { stdio: "ignore" },
    );
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
    });

    await page.goto(saveUrl, { waitUntil: "domcontentloaded" });
    await waitForReady(page);
    await page.evaluate((key) => localStorage.removeItem(key), saveKey);
    await page.evaluate(() => {
      window.MrFeastFresh.teleport("archive");
      window.MrFeastFresh.setPlayerEnergyForQA(37);
    });
    await page.keyboard.press("c");
    const expected = await diagnostics(page);
    assert(expected.player.movement.crouched, "test setup should save a crouched player");
    assert(await page.evaluate(() => window.MrFeastFresh.saveGameForQA()), "test setup should write a real mansion save");
    const savedEnvelope = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), saveKey);
    assert(savedEnvelope?.data, "mansion save should persist in localStorage before reload");

    await page.goto(introUrl, { waitUntil: "domcontentloaded" });
    await waitForReady(page);
    let state = await diagnostics(page);
    const renderedFramesAtReady = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer?.render?.frame || 0);
    assert(renderedFramesAtReady >= 1, `Load save should not advertise ready before the base estate renders; frames=${renderedFramesAtReady}`);
    assert(!state.started, "a normal page reload should wait at the mansion intro");
    assert(await page.locator("#mansion-intro").isVisible(), "mansion intro should remain visible before loading");
    assert(await page.locator("#mansion-intro-load").isEnabled(), "main-menu Load save should enable for a compatible save");
    assert(/last save/i.test(await page.locator("#mansion-intro-save-status").textContent() || ""), "intro should summarize the available save");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "intro-load-ready.png") });

    const errorsBeforeLoad = errors.length;
    // Visibility/enabled state is asserted above. Force the dispatch here so
    // Playwright's two-frame actionability polling is not mistaken for game
    // picker-open time on software-rendered CI WebGL.
    await page.locator("#mansion-intro-load").click({ force: true });
    assert(await page.locator("#mansion-load-chooser").isVisible(), "main-menu Load should open the explicit save picker");
    assert(await page.locator('[data-save-source="manual"]').count() === 1, "the existing explicit save should appear as Manual Save");
    await page.evaluate(() => {
      const button = document.querySelector('[data-save-source="manual"]');
      const probe = { startedAt: performance.now(), nextFrameMs: null };
      window.__MR_FEAST_INTRO_LOAD_PROBE__ = probe;
      button.click();
      probe.handlerMs = performance.now() - probe.startedAt;
      probe.state = JSON.parse(window.render_game_to_text());
      probe.status = document.getElementById("mansion-menu-status")?.textContent || "";
      requestAnimationFrame(() => {
        probe.nextFrameMs = performance.now() - probe.startedAt;
      });
    });
    await page.waitForFunction(() => {
      const current = JSON.parse(window.render_game_to_text());
      return current.started && document.getElementById("mansion-intro")?.hidden;
    }, null, { timeout: 3000 });
    await page.waitForFunction(() => Number.isFinite(window.__MR_FEAST_INTRO_LOAD_PROBE__?.nextFrameMs), null, { timeout: 3000 });
    const loadProbe = await page.evaluate(() => window.__MR_FEAST_INTRO_LOAD_PROBE__);
    await page.waitForTimeout(100);
    state = await diagnostics(page);

    assert(errors.length === errorsBeforeLoad, `main-menu load should not raise a browser error: ${errors.slice(errorsBeforeLoad).join(" | ")}`);
    const loadedState = loadProbe.state;
    assert(planarDistance(savedEnvelope.data.playerPosition, loadedState.player) < 0.08, `main-menu load should restore player position; expected=${JSON.stringify(savedEnvelope.data.playerPosition)} actual=${JSON.stringify(loadedState.player)}`);
    assert(loadedState.player.movement.crouched, "main-menu load should restore the saved crouch stance");
    assert(Math.abs(loadedState.player.movement.energy - savedEnvelope.data.movement.energy) < 0.01, `main-menu load should restore energy; expected=${savedEnvelope.data.movement.energy} actual=${loadedState.player.movement.energy}`);
    assert(loadedState.openingWelcome?.completed && !loadedState.openingWelcome.active, "main-menu load should not replay the front-door welcome");
    assert(loadedState.openingWelcome?.cancelledReason === "loaded-save", `main-menu load should record welcome suppression; welcome=${JSON.stringify(loadedState.openingWelcome)}`);
    assert(/saved game restored/i.test(loadProbe.status), "main-menu load should confirm successful restoration");
    assert(loadProbe.handlerMs <= 100, `save restoration should finish in one short task; handler=${loadProbe.handlerMs.toFixed(1)}ms`);
    assert(loadProbe.nextFrameMs <= 250, `the loaded estate should paint promptly after restoration; nextFrame=${loadProbe.nextFrameMs.toFixed(1)}ms`);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "loaded-archive-save.png") });

    await page.evaluate((key) => {
      const corrupt = JSON.parse(localStorage.getItem(key));
      corrupt.data.playerPosition.x = "not-a-number";
      corrupt.data.contestant13.bookRead = true;
      corrupt.data.contestant13.inventory = ["garden-shovel"];
      localStorage.setItem(key, JSON.stringify(corrupt));
    }, saveKey);
    await page.goto(introUrl, { waitUntil: "domcontentloaded" });
    await waitForReady(page);
    const errorsBeforeCorruptLoad = errors.length;
    await page.locator("#mansion-intro-load").click({ force: true });
    await page.locator('[data-save-source="manual"]').click({ force: true });
    await page.waitForTimeout(100);
    state = await diagnostics(page);
    assert(errors.length === errorsBeforeCorruptLoad, `invalid saves should fail without a browser error: ${errors.slice(errorsBeforeCorruptLoad).join(" | ")}`);
    assert(!state.started && await page.locator("#mansion-intro").isVisible(), "an invalid save should keep the player at the intro instead of half-starting the game");
    assert(state.inventory.items.length === 0 && state.journal.entries.length === 0, "an invalid save should not partially mutate quest state");
    assert(/could not be restored/i.test(await page.locator("#mansion-intro-save-status").textContent() || ""), "an invalid save should explain that the player can start a new game instead");

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log(`Mr. Feast intro save-load browser test passed: ${loadProbe.handlerMs.toFixed(1)}ms restore, ${loadProbe.nextFrameMs.toFixed(1)}ms to next frame`);
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast intro save-load browser test failed: ${error.message}`);
  process.exitCode = 1;
});
