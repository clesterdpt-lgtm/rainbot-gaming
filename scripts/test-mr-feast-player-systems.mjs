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
    assert(await page.locator("#mansion-casefile").isHidden(), "fresh play must never show a left-side trail/objective case file");
    assert((await page.locator("#mansion-objective").textContent() || "").trim() === "", "fresh HUD markup should not direct the player with objective tip text");
    assert(await page.locator("#mansion-journal-button").isHidden(), "the Bag toolbar control should stay hidden on desktop where Tab remains available");
    assert(await page.locator("#touch-sprint").count() === 1 && await page.locator("#touch-sprint").isHidden(), "the sprint touch control should exist but stay hidden on desktop");
    assert(await page.locator("#touch-crouch").isHidden(), "the crouch touch control should stay hidden on desktop");
    assert(await page.locator("#touch-menu").isHidden(), "the menu touch control should stay hidden on desktop");

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
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).menus.maximized, null, { timeout: 3000 });
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
    assert(await page.locator("#mansion-inventory-dialog-items .mansion-inventory-card").count() === expectedItems.length, "inventory dossier should render every object as an item card");
    assert(await page.locator("#mansion-inventory-dialog-items .mansion-inventory-card__icon svg[viewBox]").count() === expectedItems.length, "every object card should include a scalable picture icon");
    const objectIconNames = await page.locator("#mansion-inventory-dialog-items .mansion-inventory-card").evaluateAll((cards) => cards.map((card) => card.dataset.icon));
    assert(new Set(objectIconNames).size === expectedItems.length, `object cards should have distinct illustrations; icons=${JSON.stringify(objectIconNames)}`);
    assert(await page.locator("#mansion-clue-notepad").count() === 1, "recovered clues should live on one notepad sheet");
    assert(await page.locator("#mansion-journal-entries .mansion-clue-note").count() >= expectedClues.length, "inventory dossier should render all granted clues as handwritten notes");
    const clueVisual = await page.locator("#mansion-clue-notepad").evaluate((notepad) => ({
      backgroundImage: getComputedStyle(notepad).backgroundImage,
      fontFamily: getComputedStyle(notepad.querySelector(".mansion-clue-note span")).fontFamily,
    }));
    assert(/linear-gradient/i.test(clueVisual.backgroundImage), "clue notepad should visibly use ruled-paper lines");
    assert(/print|hand|cursive/i.test(clueVisual.fontFamily), `clue copy should use a handwriting-style font; font=${clueVisual.fontFamily}`);
    await page.screenshot({ path: path.join(artifactDir, "inventory-and-clues-dev-desktop.png") });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    // Native fullscreen may consume the first Escape before the page receives
    // it. Send the page-owned close gesture once fullscreen has yielded.
    if ((await diagnostics(page)).menus.inventoryOpen) await page.keyboard.press("Escape");
    await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).menus.inventoryOpen, null, { timeout: 3000 });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).menus.escapeOpen, null, { timeout: 3000 });
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

    // The desktop routes are complete. Release their continuously rendered
    // WebGL scene before opening the second, mobile mansion so a real touch
    // click is not starved behind two simultaneous full-scene render loops.
    await context.close();

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on("pageerror", (error) => errors.push(`mobile: ${error.message}`));
    mobilePage.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(`mobile: ${message.text()}`);
    });
    await mobilePage.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await mobilePage.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.1));
    const mobileControls = await mobilePage.evaluate(() => {
      const plain = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          display: style.display,
          visibility: style.visibility,
        };
      };
      return {
        stage: plain(document.getElementById("mansion-stage")),
        bag: plain(document.getElementById("mansion-journal-button")),
        sprint: plain(document.getElementById("touch-sprint")),
        crouch: plain(document.getElementById("touch-crouch")),
        menu: plain(document.getElementById("touch-menu")),
        interact: plain(document.getElementById("touch-interact")),
        movement: plain(document.querySelector(".mansion-touch__move")),
        energy: plain(document.getElementById("mansion-energy")),
        feast: plain(document.getElementById("mansion-feast-says")),
        feastPhase: document.getElementById("mansion-feast-says")?.dataset.phase || "",
        bagText: document.getElementById("mansion-journal-button")?.textContent?.trim() || "",
        sprintText: document.getElementById("touch-sprint")?.textContent?.trim() || "",
      };
    });
    for (const [name, control] of Object.entries({ bag: mobileControls.bag, sprint: mobileControls.sprint, crouch: mobileControls.crouch, menu: mobileControls.menu })) {
      assert(control && control.display !== "none" && control.visibility !== "hidden", `mobile ${name} control should be visible; controls=${JSON.stringify(mobileControls)}`);
      assert(control.width >= 44 && control.height >= 44, `mobile ${name} control should be at least 44px; control=${JSON.stringify(control)}`);
    }
    assert(mobileControls.bagText === "Bag", `the mobile inventory control should say Bag, got ${JSON.stringify(mobileControls.bagText)}`);
    assert(mobileControls.sprintText === "Sprint", `the mobile sprint control should say Sprint, got ${JSON.stringify(mobileControls.sprintText)}`);
    assert(mobileControls.sprint.right <= mobileControls.crouch.left, `mobile Sprint and Crouch should not overlap; controls=${JSON.stringify(mobileControls)}`);
    assert(mobileControls.sprint.bottom <= mobileControls.interact.top, `mobile Sprint should not overlap Interact; controls=${JSON.stringify(mobileControls)}`);
    assert(mobileControls.crouch.bottom <= mobileControls.interact.top, `mobile crouch should not overlap Interact; controls=${JSON.stringify(mobileControls)}`);
    assert(mobileControls.movement.width <= 148 && mobileControls.movement.height <= 100, `mobile movement controls should keep a compact footprint; controls=${JSON.stringify(mobileControls)}`);
    assert(mobileControls.energy.width <= 136 && mobileControls.energy.height <= 32, `mobile energy HUD should stay compact; controls=${JSON.stringify(mobileControls)}`);
    assert(mobileControls.feastPhase === "dormant" && (mobileControls.feast.display === "none" || mobileControls.feast.height === 0 || mobileControls.feast.width === 0), `the idle Feast Says countdown must stay hidden on phone; controls=${JSON.stringify(mobileControls)}`);
    const bottomUiTop = Math.min(...[mobileControls.movement, mobileControls.sprint, mobileControls.crouch, mobileControls.interact, mobileControls.energy]
      .filter((control) => control.display !== "none" && control.height > 0)
      .map((control) => control.top));
    assert((mobileControls.stage.bottom - bottomUiTop) / mobileControls.stage.height <= 0.24, `mobile controls should reserve no more than the lower 24% of the stage; controls=${JSON.stringify(mobileControls)}`);

    await mobilePage.evaluate(() => {
      window.MrFeastFresh.teleport("foyer");
      window.MrFeastFresh.setPlayerEnergyForQA(100);
    });
    await mobilePage.locator("#touch-sprint").hover();
    await mobilePage.mouse.down();
    await mobilePage.keyboard.down("w");
    await mobilePage.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.65));
    state = await diagnostics(mobilePage);
    assert(state.player.movement.sprinting && state.player.movement.energy < 100, `holding mobile Sprint while moving should use the authoritative sprint/energy state; movement=${JSON.stringify(state.player.movement)}`);
    assert(await mobilePage.locator("#touch-sprint").getAttribute("aria-pressed") === "true", "mobile Sprint should expose its held state");
    await mobilePage.keyboard.up("w");
    await mobilePage.mouse.up();
    await mobilePage.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.1));
    assert(!(await diagnostics(mobilePage)).player.movement.sprinting, "releasing mobile Sprint should stop sprinting");
    assert(await mobilePage.locator("#touch-sprint").getAttribute("aria-pressed") === "false", "mobile Sprint should clear its held state on release");

    await mobilePage.locator("#touch-crouch").click();
    await mobilePage.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.45));
    state = await diagnostics(mobilePage);
    assert(state.player.movement.crouched, "the mobile Crouch button should enter the authoritative crouched stance");
    assert(await mobilePage.locator("#touch-crouch").getAttribute("aria-pressed") === "true", "the mobile Crouch button should expose its pressed state");
    await mobilePage.locator("#touch-crouch").click();
    await mobilePage.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.45));
    assert(!(await diagnostics(mobilePage)).player.movement.crouched, "pressing mobile Crouch again should restore standing stance");
    await mobilePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "mobile-touch-controls.png") });

    await mobilePage.locator("#touch-menu").click();
    await mobilePage.waitForFunction(() => JSON.parse(window.render_game_to_text()).menus.escapeOpen);
    state = await diagnostics(mobilePage);
    assert(state.menus.simulationPaused && await mobilePage.locator("#mansion-menu").isVisible(), "the mobile Menu button should open the simulation-blocking mansion menu");
    await mobilePage.locator("#mansion-menu-resume").click();
    await mobilePage.waitForFunction(() => !JSON.parse(window.render_game_to_text()).menus.escapeOpen);

    await mobilePage.evaluate(() => window.MrFeastFresh.setDevModeForQA(true));
    const competingTopHud = await mobilePage.evaluate(() => ({
      caseFileVisible: !document.getElementById("mansion-casefile")?.hidden,
      objectiveText: document.getElementById("mansion-objective")?.textContent || "",
      idleFeastDisplay: getComputedStyle(document.getElementById("mansion-feast-says")).display,
      idleFeastPhase: document.getElementById("mansion-feast-says")?.dataset.phase || "",
    }));
    assert(!competingTopHud.caseFileVisible && competingTopHud.objectiveText.trim() === "", `dev-unlocked clues must still never surface the trail/objective HUD; got ${JSON.stringify(competingTopHud)}`);
    assert(competingTopHud.idleFeastPhase === "dormant" && competingTopHud.idleFeastDisplay === "none", `the idle next-game countdown must stay hidden while dormant; got ${JSON.stringify(competingTopHud)}`);

    await mobilePage.locator("#mansion-journal-button").click();
    await mobilePage.waitForFunction(() => JSON.parse(window.render_game_to_text()).menus.inventoryOpen);
    const mobileDossierLayout = await mobilePage.evaluate(() => {
      const stage = document.getElementById("mansion-stage").getBoundingClientRect();
      const panel = document.querySelector(".mansion-journal__panel");
      const title = document.getElementById("mansion-journal-title").getBoundingClientRect();
      const close = document.getElementById("mansion-journal-close").getBoundingClientRect();
      return {
        titleTop: title.top,
        closeTop: close.top,
        stageTop: stage.top,
        stageBottom: stage.bottom,
        panelClientWidth: panel.clientWidth,
        panelScrollWidth: panel.scrollWidth,
      };
    });
    assert(mobileDossierLayout.titleTop >= mobileDossierLayout.stageTop && mobileDossierLayout.closeTop >= mobileDossierLayout.stageTop, `mobile dossier title or close control begins outside the stage; layout=${JSON.stringify(mobileDossierLayout)}`);
    assert(mobileDossierLayout.panelScrollWidth <= mobileDossierLayout.panelClientWidth, "mobile dossier should not scroll horizontally");
    await mobilePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "inventory-and-clues-dev-mobile.png") });
    await mobileContext.close();

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast player systems browser test: sprint energy, crouch stealth, inventory dossier, Escape menu, save/load, maximize, and reversible Dev Mode passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast player systems browser test failed: ${error.message}`);
  process.exitCode = 1;
});
