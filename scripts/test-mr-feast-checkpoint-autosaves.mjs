import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_AUTOSAVE_TEST_PORT || (48600 + (process.pid % 12000)));
const baseUrl = `http://127.0.0.1:${port}`;
const playUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1`;
const introUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-checkpoint-autosaves");
const manualKey = "rainbot_game_save:mr-feast-mansion";
const autosaveKey = "rainbot_game_autosaves:mr-feast-mansion";

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

async function pickerEntries(page) {
  return page.locator("#mansion-load-chooser [data-save-source]").evaluateAll((buttons) => buttons.map((button) => ({
    source: button.dataset.saveSource,
    checkpointId: button.dataset.checkpointId || null,
    text: button.textContent.replace(/\s+/g, " ").trim(),
    height: button.getBoundingClientRect().height,
  })));
}

async function assertPickerFits(page, width, height, screenshotName) {
  await page.setViewportSize({ width, height });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReady(page);
  assert(await page.locator("#mansion-intro-load").isEnabled(), `${width}x${height} intro Load should be enabled`);
  await page.locator("#mansion-intro-load").click({ force: true });
  await page.waitForFunction(() => !document.getElementById("mansion-load-chooser")?.hidden);
  const layout = await page.locator("#mansion-load-chooser").evaluate((chooser) => {
    const stage = document.getElementById("mansion-stage").getBoundingClientRect();
    const panel = chooser.querySelector(".mansion-load-chooser__panel").getBoundingClientRect();
    const buttons = Array.from(chooser.querySelectorAll("button:not([hidden])")).map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom };
    });
    return {
      stage: { top: stage.top, bottom: stage.bottom, height: stage.height },
      panel: { top: panel.top, bottom: panel.bottom, height: panel.height },
      buttons,
      chooserScrollHeight: chooser.scrollHeight,
      chooserClientHeight: chooser.clientHeight,
    };
  });
  assert(layout.panel.top >= layout.stage.top - 0.5 && layout.panel.bottom <= layout.stage.bottom + 0.5, `${width}x${height} picker should stay inside the stage; layout=${JSON.stringify(layout)}`);
  assert(layout.buttons.every((button) => button.height >= 44), `${width}x${height} picker actions should remain at least 44px; layout=${JSON.stringify(layout)}`);
  assert(layout.chooserScrollHeight <= layout.chooserClientHeight + 1, `${width}x${height} picker should not overflow its overlay; layout=${JSON.stringify(layout)}`);
  await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, screenshotName) });
  await page.locator("#mansion-load-cancel").click();
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
    await context.addInitScript(({ manualKey: initManualKey, autosaveKey: initAutosaveKey }) => {
      if (!sessionStorage.getItem("mr-feast-autosave-test-initialized")) {
        localStorage.removeItem(initManualKey);
        localStorage.removeItem(initAutosaveKey);
        sessionStorage.setItem("mr-feast-autosave-test-initialized", "true");
      }
    }, { manualKey, autosaveKey });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
    });

    await page.goto(playUrl, { waitUntil: "domcontentloaded" });
    await waitForReady(page);
    const hooksPresent = await page.evaluate(() => (
      typeof window.MrFeastFresh?.captureCheckpointAutosaveForQA === "function"
      && typeof window.MrFeastFresh?.getCheckpointAutosaves === "function"
    ));
    assert(hooksPresent, "checkpoint autosave QA hooks should be exposed by the mansion runtime");

    await page.evaluate(() => {
      window.MrFeastFresh.teleport("foyer");
      window.MrFeastFresh.setPlayerEnergyForQA(91);
    });
    const manualExpected = await diagnostics(page);
    assert(await page.evaluate(() => window.MrFeastFresh.saveGameForQA()), "manual save setup should succeed");
    const manualEnvelopeBeforeAutosaves = await page.evaluate((key) => localStorage.getItem(key), manualKey);
    assert(manualEnvelopeBeforeAutosaves, "manual save should use the existing manual key");

    const checkpointSetups = [
      { id: "qa-arrival", label: "Arrival complete", room: "foyer", energy: 80 },
      { id: "qa-first-clue", label: "First clue found", room: "archive", energy: 70 },
      { id: "qa-basement", label: "Basement opened", room: "ballroom", energy: 60 },
      { id: "qa-recording", label: "Archive evidence recovered", room: "archive", energy: 50 },
    ];
    const expectedById = new Map();
    for (const checkpoint of checkpointSetups) {
      await page.evaluate(({ room, energy }) => {
        window.MrFeastFresh.teleport(room);
        window.MrFeastFresh.setPlayerEnergyForQA(energy);
      }, checkpoint);
      expectedById.set(checkpoint.id, await diagnostics(page));
      const result = await page.evaluate(({ id, label }) => window.MrFeastFresh.captureCheckpointAutosaveForQA(id, label), checkpoint);
      assert(result?.saved, `safe ${checkpoint.id} checkpoint should autosave; result=${JSON.stringify(result)}`);
    }
    const rolling = await page.evaluate(() => window.MrFeastFresh.getCheckpointAutosaves());
    assert(rolling.maximumSlots === 3 && rolling.entries.length === 3, `autosaves should retain exactly the newest three entries; autosaves=${JSON.stringify(rolling)}`);
    assert(!rolling.entries.some((entry) => entry.checkpointId === "qa-arrival"), `oldest autosave should roll off; autosaves=${JSON.stringify(rolling)}`);
    assert(rolling.entries[0].checkpointId === "qa-recording", `newest autosave should be first; autosaves=${JSON.stringify(rolling)}`);
    assert(await page.evaluate((key) => localStorage.getItem(key), manualKey) === manualEnvelopeBeforeAutosaves, "checkpoint writes must not replace or mutate the manual save envelope");

    await page.evaluate(() => window.MrFeastFresh.setMenuOpenForQA(true));
    const pausedAttempt = await page.evaluate(() => window.MrFeastFresh.captureCheckpointAutosaveForQA("qa-paused", "Paused checkpoint"));
    assert(!pausedAttempt.saved && pausedAttempt.blockers.includes("menu-open"), `open menu should block autosaving; result=${JSON.stringify(pausedAttempt)}`);
    await page.locator("#mansion-menu-resume").click();

    const hiddenAttempt = await page.evaluate(() => {
      window.MrFeastFresh.enterHideSpotForQA();
      const result = window.MrFeastFresh.captureCheckpointAutosaveForQA("qa-hidden", "Hidden checkpoint");
      window.MrFeastFresh.leaveHideSpotForQA();
      return result;
    });
    assert(!hiddenAttempt.saved && hiddenAttempt.blockers.includes("hiding"), `active hiding should block autosaving; result=${JSON.stringify(hiddenAttempt)}`);

    await page.evaluate(() => window.MrFeastFresh.triggerBanquetLossForQA("feast-says-no-show"));
    const gameOverAttempt = await page.evaluate(() => window.MrFeastFresh.captureCheckpointAutosaveForQA("qa-caught", "Caught checkpoint"));
    assert(!gameOverAttempt.saved && gameOverAttempt.blockers.includes("game-over"), `game over should block autosaving; result=${JSON.stringify(gameOverAttempt)}`);
    await page.evaluate(() => window.MrFeastFresh.clearBanquetLossForQA());

    await page.evaluate(() => window.MrFeastFresh.setMenuOpenForQA(true));
    await page.locator("#mansion-menu-dev").click();
    await page.locator("#mansion-menu-resume").click();
    const devAttempt = await page.evaluate(() => window.MrFeastFresh.captureCheckpointAutosaveForQA("qa-dev", "Dev checkpoint"));
    assert(!devAttempt.saved && devAttempt.blockers.includes("dev-mode"), `Dev Mode should block autosaving; result=${JSON.stringify(devAttempt)}`);
    await page.evaluate(() => window.MrFeastFresh.setMenuOpenForQA(true));
    await page.locator("#mansion-menu-dev").click();
    await page.locator("#mansion-menu-resume").click();

    await page.evaluate(() => window.MrFeastFresh.setMenuOpenForQA(true));
    await page.locator("#mansion-menu-load").click();
    assert(await page.locator("#mansion-load-chooser").isVisible(), "Escape-menu Load should open the shared picker");
    let entries = await pickerEntries(page);
    assert(entries.length === 4, `picker should list one manual plus three autosaves; entries=${JSON.stringify(entries)}`);
    assert(entries[0].source === "manual" && /manual save/i.test(entries[0].text), `manual save should be a distinct first choice; entries=${JSON.stringify(entries)}`);
    assert(entries.slice(1).every((entry) => entry.source === "autosave" && /autosave/i.test(entry.text)), `checkpoint entries should identify themselves as autosaves; entries=${JSON.stringify(entries)}`);
    assert(entries.every((entry) => entry.height >= 44), `all save choices should be at least 44px; entries=${JSON.stringify(entries)}`);
    const stateBeforeCancel = await diagnostics(page);
    await page.locator("#mansion-load-cancel").click();
    assert(!(await page.locator("#mansion-load-chooser").isVisible()), "Cancel should close the picker");
    const stateAfterCancel = await diagnostics(page);
    assert(planarDistance(stateBeforeCancel.player, stateAfterCancel.player) < 0.001, "Cancel should not mutate the current player state");

    await page.locator("#mansion-menu-load").click();
    await page.locator('[data-save-source="autosave"][data-checkpoint-id="qa-basement"]').click();
    await page.waitForFunction(() => document.getElementById("mansion-load-chooser")?.hidden);
    let state = await diagnostics(page);
    const expectedAutosave = expectedById.get("qa-basement");
    assert(!state.menus.escapeOpen && planarDistance(state.player, expectedAutosave.player) < 0.08, `selected autosave should restore its exact transform and close the menu; expected=${JSON.stringify(expectedAutosave.player)} actual=${JSON.stringify(state.player)}`);

    await page.goto(introUrl, { waitUntil: "domcontentloaded" });
    await waitForReady(page);
    assert(await page.locator("#mansion-intro-load").isEnabled(), "intro Load should enable when either save source exists");
    await page.locator("#mansion-intro-load").click();
    assert(await page.locator("#mansion-load-chooser").isVisible(), "intro Load should open the same picker");
    await page.locator('[data-save-source="manual"]').click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).started);
    state = await diagnostics(page);
    assert(planarDistance(state.player, manualExpected.player) < 0.08, `manual choice should restore the manual transform; expected=${JSON.stringify(manualExpected.player)} actual=${JSON.stringify(state.player)}`);
    assert(state.openingWelcome.completed && !state.openingWelcome.active && state.openingWelcome.cancelledReason === "loaded-save", "intro picker load should suppress the opening welcome");

    await page.evaluate((key) => {
      const stored = JSON.parse(localStorage.getItem(key));
      stored.entries.unshift({
        version: 1,
        savedAt: Date.now() + 1000,
        meta: { type: "autosave", checkpointId: "qa-malformed", checkpointLabel: "Broken checkpoint", room: "NOWHERE" },
        data: { playerPosition: { x: "bad", y: 0, z: 0 }, contestant13: {} },
      });
      localStorage.setItem(key, JSON.stringify(stored));
    }, autosaveKey);
    await page.goto(introUrl, { waitUntil: "domcontentloaded" });
    await waitForReady(page);
    assert(await page.locator("#mansion-intro-load").isEnabled(), "intro Load should remain enabled when a malformed autosave is omitted beside valid saves");
    await page.locator("#mansion-intro-load").click({ force: true });
    entries = await pickerEntries(page);
    assert(!entries.some((entry) => entry.checkpointId === "qa-malformed"), `malformed autosaves should be omitted from the picker; entries=${JSON.stringify(entries)}`);
    await page.locator("#mansion-load-cancel").click();

    await assertPickerFits(page, 1280, 820, "load-picker-desktop.png");
    await assertPickerFits(page, 390, 844, "load-picker-mobile.png");
    await assertPickerFits(page, 568, 320, "load-picker-short-landscape.png");

    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto(playUrl, { waitUntil: "domcontentloaded" });
    await waitForReady(page);
    await page.evaluate(() => window.MrFeastFresh.triggerBanquetLossForQA("feast-says-no-show"));
    await page.locator("#mansion-gameover-load").click();
    assert(await page.locator("#mansion-load-chooser").isVisible(), "game-over Load should open the shared picker");
    await page.locator('[data-save-source="autosave"][data-checkpoint-id="qa-recording"]').click();
    await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).gameOver);
    state = await diagnostics(page);
    assert(planarDistance(state.player, expectedById.get("qa-recording").player) < 0.08, "game-over picker should restore the selected checkpoint");

    // Banquet Loss keeps the game-over surface visible behind the shared
    // picker. The real pointer click must reach a recovery option rather
    // than being intercepted by that surface.
    await page.evaluate(() => window.MrFeastFresh.triggerBanquetLossForQA("witnessed"));
    await page.waitForFunction(
      () => window.MrFeastFresh.getBanquetLossState()?.assetStatus === "ready"
        && window.MrFeastFresh.getBanquetLossState()?.visible,
      null,
      { timeout: 180000 },
    );
    await page.evaluate(() => window.MrFeastFresh.advanceBanquetLossForQA(25));
    await page.waitForFunction(() => !document.getElementById("mansion-gameover")?.hidden);
    await page.locator("#mansion-gameover-load").click();
    assert(await page.locator("#mansion-load-chooser").isVisible(), "Banquet Loss Choose save should show the shared picker");
    const banquetEntries = await pickerEntries(page);
    assert(banquetEntries.some((entry) => entry.source === "autosave" && entry.checkpointId === "qa-recording"), `Banquet Loss picker should expose the saved checkpoint; entries=${JSON.stringify(banquetEntries)}`);
    await page.locator('[data-save-source="autosave"][data-checkpoint-id="qa-recording"]').click();
    await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).gameOver);

    await page.evaluate(() => {
      window.MrFeastFresh.clearCheckpointAutosavesForQA();
      window.MrFeastFresh.triggerFeastSaysClueForQA("book");
      window.MrFeastFresh.closeReadableBookForQA();
    });
    await page.waitForFunction(() => window.MrFeastFresh.getCheckpointAutosaves().entries
      .some((entry) => entry.checkpointId === "first-investigation-clue"), null, { timeout: 5000 });
    const automatic = await page.evaluate(() => window.MrFeastFresh.getCheckpointAutosaves());
    assert(automatic.entries[0]?.checkpointId === "first-investigation-clue", `real story progression should create its named automatic checkpoint; autosaves=${JSON.stringify(automatic)}`);

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast checkpoint autosave browser test passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast checkpoint autosave browser test failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
