import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_PLAYER_TEST_PORT || (45000 + (process.pid % 16000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-player-systems");

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

async function holdMove(page, { sprint = false, milliseconds = 600 } = {}) {
  if (sprint) await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.evaluate((seconds) => window.MrFeastFresh.advancePlayerForQA(seconds), milliseconds / 1000);
  const during = await diagnostics(page);
  await page.keyboard.up("w");
  if (sprint) await page.keyboard.up("Shift");
  await page.waitForTimeout(40);
  return during.player;
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    // Let the first mansion shader programs compile before measuring movement
    // against wall-clock key holds. Otherwise a cold browser can consume most
    // of the first 650 ms without advancing the fixed-step simulation.
    await page.waitForTimeout(1200);

    let state = await diagnostics(page);
    assert(state.player.movement.energy === 100 && state.player.movement.mode === "idle", "fresh player should expose a full sprint reserve and idle mode");
    assert(state.player.movement.stealth.visibilityMultiplier === 1 && state.player.movement.stealth.noiseMultiplier === 1, "standing movement should expose neutral stealth multipliers");
    assert(await page.locator("#mansion-casefile").isHidden(), "fresh play should withhold the left-side case file until the first clue is discovered");
    assert(!/library|shelves|book that does not/i.test(await page.locator("#mansion-objective").textContent() || ""), "fresh HUD markup should not direct the player to the Library");

    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    const walkStart = (await diagnostics(page)).player;
    await holdMove(page, { milliseconds: 650 });
    const walkEnd = (await diagnostics(page)).player;
    const walkDistance = planarDistance(walkStart, walkEnd);
    assert(walkDistance > 0.7, `walk input should move the player; distance=${walkDistance.toFixed(3)}`);

    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    const sprintStart = (await diagnostics(page)).player;
    const duringSprint = await holdMove(page, { sprint: true, milliseconds: 650 });
    const sprintEnd = (await diagnostics(page)).player;
    const sprintDistance = planarDistance(sprintStart, sprintEnd);
    assert(duringSprint.movement.mode === "sprint" && duringSprint.movement.energy < 100, "Shift plus movement should select sprint and drain energy");
    assert(sprintDistance > walkDistance * 1.35, `sprint should materially exceed walk distance; walk=${walkDistance.toFixed(3)} sprint=${sprintDistance.toFixed(3)}`);
    const energyUi = await page.locator("#mansion-energy").getAttribute("aria-valuenow");
    assert(Number(energyUi) < 100, "energy HUD should mirror the drained reserve");
    const hudOverlap = await page.evaluate(() => {
      const energy = document.querySelector("#mansion-energy")?.getBoundingClientRect();
      const scores = document.querySelector(".rb-standalone-leaderboard-btn")?.getBoundingClientRect();
      if (!energy || !scores) return 0;
      return Math.max(0, Math.min(energy.right, scores.right) - Math.max(energy.left, scores.left))
        * Math.max(0, Math.min(energy.bottom, scores.bottom) - Math.max(energy.top, scores.top));
    });
    assert(hudOverlap === 0, "energy HUD should not overlap the standalone Scores control");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "sprint-energy-hud-desktop.png") });

    await page.evaluate(() => window.MrFeastFresh.setPlayerEnergyForQA(6));
    const exhaustedSprint = await holdMove(page, { sprint: true, milliseconds: 700 });
    state = await diagnostics(page);
    assert(exhaustedSprint.movement.energy === 0 && exhaustedSprint.movement.exhausted, `sprinting should stop at zero energy and mark the reserve exhausted; movement=${JSON.stringify(exhaustedSprint.movement)}`);
    await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(1.5));
    state = await diagnostics(page);
    assert(state.player.movement.energy > 0 && !state.player.movement.exhausted, "energy should recharge after sprinting stops");

    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    await page.keyboard.press("c");
    await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.45));
    state = await diagnostics(page);
    assert(state.player.movement.crouched && state.player.movement.stance === "crouched", "C should toggle the crouched stance");
    assert(state.player.movement.eyeHeight < state.player.movement.standingEyeHeight - 0.25, "crouch should visibly lower the eye line");
    assert(state.player.movement.stealth.visibilityMultiplier < 1 && state.player.movement.stealth.noiseMultiplier < 1, "crouch should improve visibility and noise stealth multipliers");
    const crouchStart = state.player;
    await holdMove(page, { sprint: true, milliseconds: 650 });
    const crouchEnd = (await diagnostics(page)).player;
    const crouchDistance = planarDistance(crouchStart, crouchEnd);
    assert(crouchDistance < walkDistance * 0.85, `crouching should remain slower even with Shift held; crouch=${crouchDistance.toFixed(3)} walk=${walkDistance.toFixed(3)}`);
    assert(crouchEnd.movement.mode !== "sprint", "crouching should prevent sprint mode");
    await page.keyboard.press("c");
    await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.45));
    assert(!(await diagnostics(page)).player.movement.crouched, "pressing C again should restore standing stance");

    await page.keyboard.press("i");
    await page.waitForTimeout(50);
    assert(!(await diagnostics(page)).menus.inventoryOpen, "I should no longer open the inventory and clue dossier");
    await page.keyboard.press("j");
    await page.waitForTimeout(50);
    assert(!(await diagnostics(page)).menus.inventoryOpen, "J should no longer open the inventory and clue dossier");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(100);
    state = await diagnostics(page);
    assert(state.menus.inventoryOpen && await page.locator("#mansion-journal").isVisible(), "Tab should open the inventory and clue dossier");
    assert(await page.locator("#mansion-inventory-dialog-items").getAttribute("aria-label") === "Carried objects", "dossier should expose a carried-objects region");
    await page.keyboard.press("Tab");
    assert(!(await diagnostics(page)).menus.inventoryOpen, "Tab should close the inventory and clue dossier");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    state = await diagnostics(page);
    assert(state.menus.escapeOpen && state.menus.simulationPaused, "Escape should open a simulation-blocking mansion menu");
    const pausedPosition = state.player;
    await holdMove(page, { milliseconds: 350 });
    const afterPausedMove = (await diagnostics(page)).player;
    assert(planarDistance(pausedPosition, afterPausedMove) < 0.01, "movement should remain blocked while the Escape menu is open");
    for (const id of ["mansion-menu-maximize", "mansion-menu-save", "mansion-menu-load", "mansion-menu-dev"]) {
      assert(await page.locator(`#${id}`).count() === 1, `Escape menu is missing ${id}`);
    }
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "escape-menu-desktop.png") });

    await page.locator("#mansion-menu-maximize").click();
    state = await diagnostics(page);
    assert(state.menus.maximized, "Maximize should expand the mansion stage");
    assert(await page.locator("#mansion-stage").evaluate((element) => getComputedStyle(element).position === "fixed"), "Maximize should pin the stage over the viewport");

    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    const savePosition = (await diagnostics(page)).player;
    await page.locator("#mansion-menu-save").click();
    assert(/saved/i.test(await page.locator("#mansion-menu-status").textContent()), "Save action should confirm the write");
    assert(await page.locator("#mansion-menu-load").isEnabled(), "Load should enable after a save exists");

    await page.locator("#mansion-menu-dev").click();
    state = await diagnostics(page);
    const expectedItems = ["garden-shovel", "basement-key-b13", "contestant-13-badge", "contestant-13-tape"];
    const expectedClues = ["contestant-13-book", "faceless-fountain-shovel", "maze-cache-b13", "basement-threshold-b13", "patron-feed-transcript"];
    assert(state.devMode.enabled, "Dev Mode button should enable the testing grant");
    assert(expectedItems.every((id) => state.inventory.items.includes(id)), "Dev Mode should grant every current quest object");
    assert(expectedClues.every((id) => state.journal.entries.includes(id)), "Dev Mode should grant every current clue");
    assert(state.contestant13.basementUnlocked && state.contestant13.archiveCageUnlocked && state.contestant13.recordingPlayed, "Dev Mode should open the basement and Archive test gates");
    assert(!state.contestant13.relaySabotaged, "Dev Mode must leave final sabotage incomplete");
    assert(!(await page.locator("#mansion-menu-save").isEnabled()), "Dev Mode should prevent polluted saves");

    await page.locator("#mansion-menu-resume").click();
    await page.keyboard.press("Tab");
    await page.waitForTimeout(100);
    assert(await page.locator("#mansion-inventory-dialog-items .mansion-journal__entry").count() === expectedItems.length, "inventory dossier should render all granted objects");
    assert(await page.locator("#mansion-journal-entries .mansion-journal__entry").count() >= expectedClues.length, "inventory dossier should render all granted clues");
    await page.screenshot({ path: path.join(artifactDir, "inventory-and-clues-dev-desktop.png") });

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator("#mansion-menu-load").click();
    await page.waitForTimeout(150);
    state = await diagnostics(page);
    assert(!state.devMode.enabled && state.inventory.items.length === 0 && state.journal.entries.length === 0, "loading the clean save should leave Dev Mode and restore the saved quest snapshot");
    assert(planarDistance(savePosition, state.player) < 0.08, "load should restore the saved player position");

    await page.keyboard.press("Escape");
    const cleanSnapshot = await diagnostics(page);
    await page.locator("#mansion-menu-dev").click();
    await page.locator("#mansion-menu-dev").click();
    state = await diagnostics(page);
    assert(!state.devMode.enabled, "second Dev Mode activation should disable the grant");
    assert(JSON.stringify(state.inventory.items) === JSON.stringify(cleanSnapshot.inventory.items), "disabling Dev Mode should restore the exact pre-dev inventory");
    assert(JSON.stringify(state.journal.entries) === JSON.stringify(cleanSnapshot.journal.entries), "disabling Dev Mode should restore the exact pre-dev clues");

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast player systems browser test: sprint energy, crouch stealth, inventory dossier, Escape menu, save/load, maximize, and reversible Dev Mode passed");
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast player systems browser test failed: ${error.message}`);
  process.exitCode = 1;
});
