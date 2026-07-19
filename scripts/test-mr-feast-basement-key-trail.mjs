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

async function completeFirstClueCompetition(page, expectedClueId) {
  let state = await diagnostics(page);
  assert(
    state.feastSays?.phase === "called"
      && state.feastSays.triggerReason === "clue"
      && state.feastSays.triggerClueId === expectedClueId
      && state.feastSays.callCount === 1
      && state.feastSays.clueProgressLocked,
    `the first clue should call Feast Says once and pause later clues; got ${JSON.stringify(state.feastSays)}`,
  );
  const result = await page.evaluate(() => window.MrFeastFresh.completeFeastSaysForQA(6));
  assert(result?.survived === true, `the QA completion should survive Feast Says; got ${JSON.stringify(result)}`);
  await page.waitForFunction(() => window.MrFeastFresh.getFeastSaysState?.()?.phase === "completed", null, { timeout: 8000 });
  state = await diagnostics(page);
  assert(
    state.feastSays.clueProgressLocked === false && state.feastSays.eliminatedContestantId === "kip-solano",
    `completing Feast Says should reopen investigation and eliminate Kip; got ${JSON.stringify(state.feastSays)}`,
  );
  return state;
}

async function completeStormRunAfterShovel(page) {
  try {
    await page.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.castReady, null, { timeout: 30000 });
  } catch (_) {
    const stalled = await diagnostics(page);
    throw new Error(`Storm Run cast did not settle after the shovel clue; storm=${JSON.stringify(stalled.stormRun)} contestants=${JSON.stringify(stalled.contestants)} mrFeast=${JSON.stringify(stalled.mrFeast)}`);
  }
  let state = await diagnostics(page);
  assert(
    state.stormRun?.phase === "called"
      && state.stormRun.triggerReason === "clue"
      && state.stormRun.triggerClueId === "faceless-fountain-shovel"
      && state.stormRun.callCount === 1
      && state.stormRun.clueProgressLocked,
    `the first post-Feast clue should call Storm Run once and pause later clues; got ${JSON.stringify(state.stormRun)}`,
  );
  assert(
    state.contestant13.shovelTaken
      && state.inventory.items.filter((id) => id === "garden-shovel").length === 1,
    `the shovel that called Storm Run should remain earned; quest=${JSON.stringify(state.contestant13)} inventory=${JSON.stringify(state.inventory)}`,
  );
  const result = await page.evaluate(() => window.MrFeastFresh.completeStormRunForQA("player"));
  assert(result?.survived === true, `the QA completion should survive Storm Run; got ${JSON.stringify(result)}`);
  await page.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "completed", null, { timeout: 8000 });
  state = await diagnostics(page);
  assert(
    state.stormRun.clueProgressLocked === false && state.stormRun.eliminatedContestantId === "mara-voss",
    `completing Storm Run should reopen investigation and eliminate Mara; got ${JSON.stringify(state.stormRun)}`,
  );
  assert(
    state.contestant13.shovelTaken
      && state.inventory.items.filter((id) => id === "garden-shovel").length === 1,
    `Storm Run completion must preserve the triggering shovel clue; quest=${JSON.stringify(state.contestant13)} inventory=${JSON.stringify(state.inventory)}`,
  );
  return state;
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
    assert(state.contestant13.world.bookScratchTreatment === "etched-decal" && state.contestant13.world.bookScratchRaisedDepth === 0, `the XIII should be a flat irregular surface scratch instead of raised lettering; world=${JSON.stringify(state.contestant13.world)}`);
    assert(state.contestant13.world.bookTitle === state.books.clueBook?.title && state.contestant13.world.bookTitleVisible, `the shelf clue should display its seeded catalog title on the physical spine; world=${JSON.stringify(state.contestant13.world)} books=${JSON.stringify(state.books)}`);
    assert(state.contestant13.world.basementDoorLocked && !state.contestant13.world.basementDoorOpen, "basement door should begin closed and locked");

    await page.waitForFunction(() => {
      const npc = window.MrFeastFresh?.getMrFeastState?.();
      return npc?.loaded || npc?.error;
    }, null, { timeout: 30000 });
    const routeProof = await page.evaluate(() => window.MrFeastFresh.runMrFeastWholeHomeRouteForQA(1800));
    assert(routeProof.qaLastWholeHomeRun?.completed && routeProof.visitedRouteDoors.includes("basement stair door"), "deterministic QA should still exercise the full route through the temporarily released story door");
    state = await diagnostics(page);
    assert(!state.contestant13.basementUnlocked && state.contestant13.world.basementDoorLocked && !state.contestant13.world.basementDoorOpen, "whole-home QA must restore the locked door without advancing story state");

    await teleportForInteraction(page, "contestant13LibraryBook", /read “.+”/i);
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

    await teleportForInteraction(page, "contestant13LibraryBook", /read “.+”/i);
    await pressInteract(page);
    await page.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    state = await diagnostics(page);
    const printedPage = await page.locator("#mansion-book-preview").textContent();
    const bookMessage = await page.locator("#mansion-book-annotation").textContent();
    const cluePresentation = await page.evaluate(() => ({
      title: document.getElementById("mansion-book-title")?.textContent,
      kind: document.getElementById("mansion-book-reader")?.dataset.bookKind,
      annotationSlot: document.getElementById("mansion-book-reader")?.dataset.annotationSlot,
      printFont: getComputedStyle(document.getElementById("mansion-book-preview")).fontFamily,
      noteFont: getComputedStyle(document.getElementById("mansion-book-annotation")).fontFamily,
      focused: document.activeElement?.id,
    }));
    assert(state.contestant13.bookRead, "reading the unusual book should set bookRead");
    assert(state.journal.entries.filter((id) => id === "contestant-13-book").length === 1, "book journal entry should be idempotent");
    assert(/hedge maze/i.test(bookMessage || "") && /basement key/i.test(bookMessage || "") && /shovel/i.test(bookMessage || "") && /formal garden/i.test(bookMessage || ""), "book message should point to both the hedge-maze key and garden shovel");
    assert((printedPage || "").length >= 120 && !/basement key is buried/i.test(printedPage || ""), `the clue should be handwritten into an otherwise ordinary printed page; print=${JSON.stringify(printedPage)}`);
    assert(cluePresentation.title === state.books.clueBook.title && cluePresentation.kind === "clue" && /Georgia|serif/i.test(cluePresentation.printFont) && /Bradley Hand|Segoe Print|Comic Sans|cursive/i.test(cluePresentation.noteFont), `clue should use separate printed and handwritten layers in the shared reader; clue=${JSON.stringify(cluePresentation)}`);
    assert(cluePresentation.focused === "mansion-canvas", `the live-event call should return focus to play; clue=${JSON.stringify(cluePresentation)}`);
    assert(state.feastSays?.phase === "called" && state.feastSays.triggerClueId === "contestant-13-book" && state.feastSays.clueProgressLocked, `reading the first clue should call Feast Says and pause the trail; got ${JSON.stringify(state.feastSays)}`);
    assert(await page.locator("#mansion-casefile").isHidden(), "the investigation HUD should yield to the Feast Says call while clues are paused");
    assert((await page.locator("#mansion-story-progress").textContent()) === "Trail 1/7", "book should be the first of seven trail steps");
    await page.waitForTimeout(200);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "printed-book-with-handwritten-marginalia-desktop.png") });

    state = await completeFirstClueCompetition(page, "contestant-13-book");
    if (!(await page.locator("#mansion-book-reader").isHidden())) {
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.getElementById("mansion-book-reader")?.hidden);
    }
    assert(await page.locator("#mansion-casefile").isVisible(), "the investigation HUD should return after Feast Says reopens the mansion");
    await teleportForInteraction(page, "contestant13LibraryBook", /read “.+”/i);
    await pressInteract(page);
    await page.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    state = await diagnostics(page);
    assert(state.journal.entries.filter((id) => id === "contestant-13-book").length === 1, "rereading the book must not duplicate its journal entry");
    assert(await page.evaluate(() => document.activeElement?.id) === "mansion-canvas", "a reread after the live event should preserve pointer-lock focus on the game canvas");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("mansion-book-reader")?.hidden);

    await teleportForInteraction(page, "contestant13GardenShovel", /take.*shovel|garden shovel/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.shovelTaken && state.inventory.items.filter((id) => id === "garden-shovel").length === 1, "garden shovel should be collected exactly once");
    assert(/hedge maze|basement key/i.test(state.journal.currentObjective), "shovel pickup should advance the objective to the hedge-maze key");
    await completeStormRunAfterShovel(page);

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
    await teleportForInteraction(mobilePage, "contestant13LibraryBook", /read “.+”/i);
    await mobilePage.locator("#touch-interact").click({ force: true });
    await waitForFlag(mobilePage, "bookRead");
    await mobilePage.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    const mobileState = await diagnostics(mobilePage);
    const mobileUi = await mobilePage.evaluate(() => {
      const caseFile = document.getElementById("mansion-casefile")?.getBoundingClientRect();
      const feastSays = document.getElementById("mansion-feast-says")?.getBoundingClientRect();
      const touch = document.getElementById("touch-interact")?.getBoundingClientRect();
      const reader = document.querySelector(".mansion-book__page")?.getBoundingClientRect();
      const annotation = document.getElementById("mansion-book-annotation")?.getBoundingClientRect();
      return {
        caseFile: caseFile && { left: caseFile.left, right: caseFile.right, height: caseFile.height },
        caseFileHidden: Boolean(document.getElementById("mansion-casefile")?.hidden),
        feastSays: feastSays && { left: feastSays.left, right: feastSays.right, height: feastSays.height },
        touch: touch && { width: touch.width, height: touch.height },
        reader: reader && { left: reader.left, top: reader.top, right: reader.right, bottom: reader.bottom },
        annotation: annotation && { left: annotation.left, top: annotation.top, right: annotation.right, bottom: annotation.bottom },
        printedLength: document.getElementById("mansion-book-preview")?.textContent?.length || 0,
        annotationCopy: document.getElementById("mansion-book-annotation")?.textContent || "",
        clueKind: document.getElementById("mansion-book-reader")?.dataset.bookKind,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      };
    });
    assert(mobileState.contestant13.bookRead, "touch interaction should read the shelf book");
    assert(mobileState.feastSays?.phase === "called" && mobileState.feastSays.triggerClueId === "contestant-13-book" && mobileState.feastSays.clueProgressLocked, `the first mobile clue should call Feast Says and pause later clues; got ${JSON.stringify(mobileState.feastSays)}`);
    assert(mobileUi.caseFileHidden, "the mobile objective HUD should yield to the live-event call");
    assert(mobileUi.feastSays && mobileUi.feastSays.left >= 0 && mobileUi.feastSays.right <= mobileUi.viewportWidth && mobileUi.feastSays.height >= 36 && mobileUi.feastSays.height <= 58, `the compact mobile Feast Says call should remain readable and on-screen; ui=${JSON.stringify(mobileUi)}`);
    assert(mobileUi.touch && mobileUi.touch.width >= 44 && mobileUi.touch.height >= 44, "mobile interact control should remain at least 44px");
    assert(mobileUi.clueKind === "clue" && mobileUi.reader && mobileUi.reader.left >= 0 && mobileUi.reader.top >= 0 && mobileUi.reader.right <= mobileUi.viewportWidth && mobileUi.reader.bottom <= mobileUi.viewportHeight, `mobile handwritten clue reader should fit on-screen; ui=${JSON.stringify(mobileUi)}`);
    assert(mobileUi.printedLength >= 120 && /basement key/i.test(mobileUi.annotationCopy) && mobileUi.annotation && mobileUi.annotation.left >= 0 && mobileUi.annotation.right <= mobileUi.viewportWidth && mobileUi.annotation.bottom <= mobileUi.viewportHeight, `mobile printed prose and handwritten marginalia should both be visible without horizontal overflow; ui=${JSON.stringify(mobileUi)}`);
    await mobilePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "printed-book-marginalia-mobile.png") });
    await completeFirstClueCompetition(mobilePage, "contestant-13-book");
    const resumedCaseFile = await mobilePage.evaluate(() => {
      const element = document.getElementById("mansion-casefile");
      const bounds = element?.getBoundingClientRect();
      return bounds ? { hidden: Boolean(element.hidden), left: bounds.left, right: bounds.right, height: bounds.height, viewportWidth: innerWidth } : null;
    });
    assert(resumedCaseFile && !resumedCaseFile.hidden && resumedCaseFile.left >= 0 && resumedCaseFile.right <= resumedCaseFile.viewportWidth && resumedCaseFile.height >= 44, `the mobile objective HUD should return on-screen after Feast Says; got ${JSON.stringify(resumedCaseFile)}`);
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
