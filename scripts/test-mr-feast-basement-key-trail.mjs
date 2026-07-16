import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_BASEMENT_TEST_PORT || (43000 + (process.pid % 18000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-basement-key-trail");

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

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function teleportForInteraction(page, view, promptPattern) {
  await page.evaluate((name) => window.MrFeastFresh.teleport(name), view);
  await page.evaluate(() => window.advanceTime(100));
  try {
    await page.waitForFunction(
      ({ source, flags }) => new RegExp(source, flags).test(JSON.parse(window.render_game_to_text()).prompt || ""),
      { source: promptPattern.source, flags: promptPattern.flags },
      { timeout: 5000, polling: 100 },
    );
  } catch (_) {
    const state = await diagnostics(page);
    throw new Error(`${view} did not expose ${promptPattern}; prompt=${JSON.stringify(state.prompt)} ray=${JSON.stringify(state.interactionRay)}`);
  }
}

async function pressInteract(page) {
  await page.keyboard.press("e");
  await page.waitForTimeout(140);
}

async function waitForFlag(page, flag, timeout = 6000) {
  await page.waitForFunction(
    (name) => Boolean(JSON.parse(window.render_game_to_text()).contestant13?.[name]),
    flag,
    { timeout },
  );
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
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });

    let state = await diagnostics(page);
    assert(state.contestant13.phase === "find-book", "fresh trail should begin at the Library shelf book");
    assert(state.contestant13.world.bookVisible, "shelf book should begin visible");
    assert(state.contestant13.world.bookSlotReserved && state.contestant13.world.bookScratch === "XIII", "shelf book should occupy a clean reserved gap and carry the scratched XIII mark");
    assert(state.contestant13.world.basementDoorLocked && !state.contestant13.world.basementDoorOpen, "basement door should begin closed and locked");

    await page.waitForFunction(() => {
      const npc = window.MrFeastFresh?.getMrFeastState?.();
      return npc?.loaded || npc?.error;
    }, null, { timeout: 30000 });
    const routeProof = await page.evaluate(() => window.MrFeastFresh.runMrFeastWholeHomeRouteForQA(1800));
    assert(routeProof.qaLastWholeHomeRun?.completed && routeProof.visitedRouteDoors.includes("basement stair door"), "deterministic QA should still exercise the full route through the temporarily released story door");
    state = await diagnostics(page);
    assert(!state.contestant13.basementUnlocked && state.contestant13.world.basementDoorLocked && !state.contestant13.world.basementDoorOpen, "whole-home QA must restore the locked door without advancing story state");

    await teleportForInteraction(page, "contestant13LibraryBook", /book|misfiled|ledger/i);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "library-shelf-book-subtle-desktop.png") });

    await teleportForInteraction(page, "contestant13BasementDoor", /basement.*locked|key.*missing/i);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "basement-door-locked-desktop.png") });
    await pressInteract(page);
    state = await diagnostics(page);
    assert(!state.contestant13.basementUnlocked && state.contestant13.world.basementDoorLocked, "early basement interaction must not unlock the door");
    const lockedDoorFeedback = [
      await page.locator("#mansion-discovery-title").textContent(),
      await page.locator("#mansion-discovery-body").textContent(),
    ].filter(Boolean).join(" ");
    assert(/locked/i.test(lockedDoorFeedback), `locked basement interaction should still give generic feedback; feedback=${JSON.stringify(lockedDoorFeedback)}`);
    assert(!/contestant 13|book|hedge maze|basement key|buried/i.test(lockedDoorFeedback), `locked basement interaction must not reveal the clue solution; feedback=${JSON.stringify(lockedDoorFeedback)}`);

    await teleportForInteraction(page, "contestant13ArchiveCage", /evidence cage.*locked/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(!state.contestant13.archiveCageUnlocked && !state.contestant13.basementUnlocked, "Archive QA teleport must not bypass the basement threshold");

    await teleportForInteraction(page, "contestant13DigSite", /need.*shovel|disturbed earth/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(!state.contestant13.digSiteExcavated && !state.contestant13.basementKeyFound, "maze cache must remain buried without the book and shovel");

    await teleportForInteraction(page, "contestant13LibraryBook", /book|misfiled|ledger/i);
    await pressInteract(page);
    state = await diagnostics(page);
    const bookMessage = await page.locator("#mansion-discovery-body").textContent();
    assert(state.contestant13.bookRead, "reading the unusual book should set bookRead");
    assert(state.journal.entries.filter((id) => id === "contestant-13-book").length === 1, "book journal entry should be idempotent");
    assert(/hedge maze/i.test(bookMessage || "") && /basement key/i.test(bookMessage || "") && /shovel/i.test(bookMessage || "") && /formal garden/i.test(bookMessage || ""), "book message should point to both the hedge-maze key and garden shovel");
    assert((await page.locator("#mansion-story-progress").textContent()) === "Trail 1/7", "book should be the first of seven trail steps");
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.journal.entries.filter((id) => id === "contestant-13-book").length === 1, "rereading the book must not duplicate its journal entry");

    await teleportForInteraction(page, "contestant13GardenShovel", /take.*shovel|garden shovel/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.shovelTaken && state.inventory.items.filter((id) => id === "garden-shovel").length === 1, "garden shovel should be collected exactly once");
    assert(/hedge maze|basement key/i.test(state.journal.currentObjective), "shovel pickup should advance the objective to the hedge-maze key");

    await teleportForInteraction(page, "contestant13DigSite", /dig.*basement key|xiii/i);
    await pressInteract(page);
    await waitForFlag(page, "digSiteExcavated");
    state = await diagnostics(page);
    assert(state.contestant13.basementKeyFound, "maze excavation should recover the basement key");
    assert(state.inventory.items.filter((id) => id === "basement-key-b13").length === 1, "basement key should enter inventory exactly once");
    assert(/locked basement|basement stair|kitchen/i.test(state.journal.currentObjective), "key recovery should direct the player to the Kitchen basement door");

    await teleportForInteraction(page, "contestant13BasementDoor", /unlock.*basement|b-13 key/i);
    await pressInteract(page);
    await waitForFlag(page, "basementUnlocked");
    state = await diagnostics(page);
    assert(!state.contestant13.world.basementDoorLocked && state.contestant13.world.basementDoorOpen, "using the maze key should unlock and open the basement door");
    assert(state.inventory.items.filter((id) => id === "basement-key-b13").length === 1, "unlocking the basement must not duplicate the key");
    assert(state.journal.entries.filter((id) => id === "basement-threshold-b13").length === 1, "basement threshold should enter the journal once");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "basement-door-unlocked-desktop.png") });

    await teleportForInteraction(page, "contestant13ArchiveCage", /unlock.*b-13|evidence cage/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.archiveCageUnlocked, "service key should unlock the Archive evidence cage after the basement threshold");
    await teleportForInteraction(page, "contestant13ArchiveCage", /play.*recording|contestant 13.*recording/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.recordingPlayed, "Archive recording should remain playable after the resequenced threshold");
    await teleportForInteraction(page, "contestant13WorkshopRelay", /sabotage.*patron|sever.*feed/i);
    await pressInteract(page);
    await waitForFlag(page, "relaySabotaged");
    state = await diagnostics(page);
    assert(state.contestant13.completed && state.contestant13.threatEscalated, "existing Workshop sabotage should still complete the slice");
    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
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
    await mobilePage.goto(`${gameUrl}&view=contestant13LibraryBook`, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await teleportForInteraction(mobilePage, "contestant13LibraryBook", /book|misfiled|ledger/i);
    await mobilePage.locator("#touch-interact").click({ force: true });
    await waitForFlag(mobilePage, "bookRead");
    const mobileState = await diagnostics(mobilePage);
    const mobileUi = await mobilePage.evaluate(() => {
      const caseFile = document.getElementById("mansion-casefile")?.getBoundingClientRect();
      const touch = document.getElementById("touch-interact")?.getBoundingClientRect();
      return {
        caseFile: caseFile && { left: caseFile.left, right: caseFile.right, height: caseFile.height },
        touch: touch && { width: touch.width, height: touch.height },
        viewportWidth: innerWidth,
      };
    });
    assert(mobileState.contestant13.bookRead, "touch interaction should read the shelf book");
    assert(mobileUi.caseFile && mobileUi.caseFile.left >= 0 && mobileUi.caseFile.right <= mobileUi.viewportWidth && mobileUi.caseFile.height >= 44, "mobile objective HUD should remain readable and on-screen");
    assert(mobileUi.touch && mobileUi.touch.width >= 44 && mobileUi.touch.height >= 44, "mobile interact control should remain at least 44px");
    await mobilePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "library-shelf-book-mobile.png") });
    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    await mobileContext.close();

    console.log("Mr. Feast basement key trail browser test: shelf book, dual clue, maze key, basement gate, Archive, sabotage, and mobile touch passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast basement key trail browser test failed: ${error.message}`);
  process.exitCode = 1;
});
