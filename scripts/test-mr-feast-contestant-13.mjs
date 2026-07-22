import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_TEST_PORT || (41000 + (process.pid % 20000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-contestant-13");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function serverResponds() {
  try {
    const response = await fetch(`${baseUrl}/games/mr-feast-mansion.html`, { cache: "no-store" });
    return response.ok;
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

async function screenshotStage(page, fileName) {
  const clip = await page.locator("#mansion-stage").boundingBox();
  assert(clip?.width > 0 && clip?.height > 0, `cannot capture ${fileName}: mansion stage has no bounds`);
  await page.screenshot({
    path: path.join(artifactDir, fileName),
    clip,
    animations: "disabled",
  });
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
  await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(7));
  await page.waitForFunction(() => document.getElementById("mansion-feast-says")?.hidden);
  state = await diagnostics(page);
  return state;
}

async function completeStormRunCompetition(page, expectedClueId) {
  await page.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.castReady, null, { timeout: 120000 });
  let state = await diagnostics(page);
  assert(
    state.stormRun?.phase === "called"
      && state.stormRun.triggerReason === "hedge-maze-key"
      && state.stormRun.triggerClueId === expectedClueId
      && state.stormRun.callCount === 1
      && state.stormRun.clueProgressLocked,
    `the recovered hedge-maze key should call Storm Run once and pause later clues; got ${JSON.stringify(state.stormRun)}`,
  );
  const result = await page.evaluate(() => window.MrFeastFresh.completeStormRunForQA("player"));
  assert(result?.survived === true, `the QA completion should survive Storm Run; got ${JSON.stringify(result)}`);
  await page.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "completed", null, { timeout: 8000 });
  state = await diagnostics(page);
  assert(
    state.stormRun.clueProgressLocked === false && state.stormRun.eliminatedContestantId === "mara-voss",
    `completing Storm Run should reopen investigation and eliminate Mara; got ${JSON.stringify(state.stormRun)}`,
  );
  await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(7));
  await page.waitForFunction(() => document.getElementById("mansion-storm-run")?.hidden);
  state = await diagnostics(page);
  return state;
}

async function teleportForInteraction(page, view, promptPattern) {
  const result = await page.evaluate((destination) => window.MrFeastFresh.teleport(destination), view);
  assert(!result?.error, result?.error || `Could not teleport to ${view}`);
  if (promptPattern.test(result?.prompt || "")) return;
  try {
    await page.waitForFunction(
      ({ source, flags }) => {
        const state = JSON.parse(window.render_game_to_text());
        return new RegExp(source, flags).test(state.prompt || "");
      },
      { source: promptPattern.source, flags: promptPattern.flags },
      { timeout: 5000, polling: 100 },
    );
  } catch (error) {
    const state = await diagnostics(page);
    throw new Error(`${view} did not expose ${promptPattern}; current prompt: ${JSON.stringify(state.prompt)}; ray: ${JSON.stringify(state.interactionRay)}`);
  }
}

async function pressInteract(page) {
  await page.keyboard.press("e");
  await page.waitForTimeout(120);
}

async function waitForContestantFlag(page, flag, timeout = 15000) {
  try {
    await page.waitForFunction((key) => Boolean(JSON.parse(window.render_game_to_text()).contestant13?.[key]), flag, { timeout });
  } catch (error) {
    const state = await diagnostics(page);
    if (state.contestant13?.[flag]) return state;
    throw new Error(`timed out waiting for contestant13.${flag}; story: ${JSON.stringify(state.contestant13)}`);
  }
}

async function run() {
  let server = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], {
      stdio: "ignore",
    });
  }

  let browser;
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

    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });

    let state = await diagnostics(page);
    assert(state.contestant13?.phase === "find-book", "fresh story phase should be find-book");
    assert(state.inventory?.items?.length === 0, "fresh inventory should be empty");
    assert(state.journal?.entries?.length === 0, "fresh journal should be empty");
    assert(state.contestant13.world.shovelScale <= 0.56, "garden shovel should be reduced to a short concealed spade");
    assert(state.contestant13.world.shovelPosition.x > -23.53 && state.contestant13.world.shovelPosition.x < -18.07 && state.contestant13.world.shovelPosition.z > -12.65 && state.contestant13.world.shovelPosition.z < -4.35, "shovel should sit inside the shifted southeast rose bed");
    assert(state.contestant13.world.digSiteCell.row === 19 && state.contestant13.world.digSiteCell.col === 3 && state.contestant13.world.digSiteCell.pathStepsFromRear >= 82, "cache should occupy the maze's maximum-depth dead end");
    assert(state.contestant13.world.bookVisible === true, "the unusual Library book should begin visible on its shelf");
    assert(state.contestant13.world.basementDoorLocked === true && state.contestant13.world.basementDoorOpen === false, "the basement stair door should begin closed and locked");

    await page.waitForFunction(() => {
      const npc = window.MrFeastFresh?.getMrFeastState?.();
      return npc?.loaded || npc?.error;
    }, null, { timeout: 120000 });
    let npc = await page.evaluate(() => window.MrFeastFresh.getMrFeastState());
    assert(npc.loaded && !npc.error, `Mr. Feast should load for visual QA: ${npc.error || "unknown error"}`);
    assert(npc.modelHeight === 2.01, "Mr. Feast should use the slightly larger 2.01m eye-level fit");
    assert(npc.skinnedMeshes === 1 && npc.bones === 24, "Mr. Feast should use the intact single-mesh, 24-bone release model while face retopology is paused");
    assert(Object.values(npc.animationTracks).every((clip) => clip.scaleTracks === 0 && clip.translationTracks === 1), "runtime animation clips must contain no scale tracks and only Hips translation");
    assert(npc.face && !npc.face.supported && !npc.face.retopologized, "the rejected facial appliance must remain disabled in the active release");
    assert(npc.face.morphMeshes === 0 && npc.face.totalBindingCount === 0 && npc.face.parts?.face === false && npc.face.parts?.eyes === 0 && npc.face.parts?.eyelids === 0, "the stable model should not retain detached retopology face or eye geometry");

    await page.evaluate(() => {
      window.MrFeastFresh.teleport("ballroomA");
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", time: 0, x: 0, z: -9, yaw: 0 });
    });
    npc = await page.evaluate(() => window.MrFeastFresh.getMrFeastState());
    assert(npc.liveBones.cameraY > npc.liveBones.eyeHeight && npc.liveBones.cameraY < npc.liveBones.headTopHeight, "player eye line should cross Mr. Feast's visible eye/head band");
    const rejectedRetopologyBounds = await page.evaluate(() => ({
      face: window.MrFeastFresh.inspectScene("MrFeast_RetopoFace"),
      eyes: window.MrFeastFresh.inspectScene("MrFeast_Eye"),
    }));
    assert(rejectedRetopologyBounds.face.count === 0 && rejectedRetopologyBounds.eyes.count === 0, "the active scene still contains the protruding replacement eyes or face appliance");

    const stableBodyBaseline = {
      hipsScale: { ...npc.liveBones.hipsScale },
      leftThighLength: npc.liveBones.leftThighLength,
      modelHeight: npc.modelHeight,
    };
    const stableFaceView = await page.evaluate(() => {
      window.MrFeastFresh.teleport("mrFeastFaceClose");
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", time: 0, x: 0, z: -9, yaw: 0 });
      return JSON.parse(window.render_game_to_text());
    });
    assert(!/cycle expression/i.test(stableFaceView.prompt || ""), "the paused facial rig should not expose a no-op QA expression prompt");
    await page.evaluate(() => window.advanceTime(80));
    await screenshotStage(page, "mr-feast-stable-face-desktop.png");

    const transitionSamples = await page.evaluate(() => {
      const samples = [];
      const collect = () => samples.push(window.MrFeastFresh.getMrFeastState().liveBones);
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "stalk", time: 0.258, x: 0, z: -9, yaw: 0 });
      collect();
      window.MrFeastFresh.transitionMrFeastForQA("idle", 0.24);
      for (let step = 0; step < 8; step += 1) {
        window.MrFeastFresh.advanceMrFeastAnimationForQA(0.03);
        collect();
      }
      window.MrFeastFresh.transitionMrFeastForQA("stalk", 0.24);
      for (let step = 0; step < 8; step += 1) {
        window.MrFeastFresh.advanceMrFeastAnimationForQA(0.03);
        collect();
      }
      return samples;
    });
    const hipsScaleValues = transitionSamples.flatMap((sample) => Object.values(sample.hipsScale));
    const thighLengths = transitionSamples.map((sample) => sample.leftThighLength);
    const headTopHeights = transitionSamples.map((sample) => sample.headTopHeight);
    const headTopSteps = headTopHeights.slice(1).map((height, index) => Math.abs(height - headTopHeights[index]));
    assert(Math.max(...hipsScaleValues) - Math.min(...hipsScaleValues) < 0.001, "idle/walk transitions must not scale Mr. Feast");
    assert(Math.max(...thighLengths) - Math.min(...thighLengths) < 0.001, "idle/walk transitions must not change limb lengths");
    assert(Math.max(...headTopHeights) - Math.min(...headTopHeights) < 0.03 && Math.max(...headTopSteps) < 0.01, "idle/walk transitions should not pop vertically");
    await screenshotStage(page, "mr-feast-tuned-walk-desktop.png");

    const playerFloorBeforeNpcTraversal = (await diagnostics(page)).lighting.activeFloor;
    const grandStairState = await page.evaluate(() => {
      window.MrFeastFresh.teleport("stairWide");
      return window.MrFeastFresh.setMrFeastRouteSegmentForQA("grand-lower-50", 0.5, 0.258);
    });
    assert(grandStairState.onStairs && grandStairState.currentFloor === "BETWEEN LEVELS", "grand-stair route should put Mr. Feast between authored floor heights");
    assert(grandStairState.position.y > 0 && grandStairState.position.y < 2.5, "grand-stair route should interpolate vertical movement");
    assert(grandStairState.currentAnimation === "stalk" && !grandStairState.contactShadowVisible, "Mr. Feast should walk the grand stair without projecting a flat shadow across its steps");
    assert(Object.values(grandStairState.liveBones.hipsScale).every((value) => Math.abs(value - 1) < 0.001), "grand-stair traversal must preserve the rig scale");
    await screenshotStage(page, "mr-feast-grand-stair-desktop.png");

    const serviceStairState = await page.evaluate(() => {
      window.MrFeastFresh.teleport("serviceStairTopOblique");
      return window.MrFeastFresh.setMrFeastRouteSegmentForQA("service-down-50", 0.5, 0.517);
    });
    assert(serviceStairState.onStairs && serviceStairState.currentFloor === "BETWEEN LEVELS", "service-stair route should put Mr. Feast between the main level and basement");
    assert(serviceStairState.position.y < 0 && serviceStairState.position.y > -3.8, "service-stair route should interpolate down into the basement");
    assert(serviceStairState.currentAnimation === "stalk" && !serviceStairState.contactShadowVisible, "Mr. Feast should walk the service stair without a floating contact shadow");
    await screenshotStage(page, "mr-feast-service-stair-desktop.png");

    const wholeHomeRun = await page.evaluate(() => window.MrFeastFresh.runMrFeastWholeHomeRouteForQA(1800));
    const requiredFloors = ["MAIN LEVEL", "SECOND FLOOR", "BASEMENT"];
    const requiredZones = [
      "BALLROOM", "DINING ROOM", "MAIN HALL BATHROOM", "LIBRARY", "FRONT FOYER", "MUSIC ROOM",
      "PAINTING ROOM", "KITCHEN", "GRAND STAIR HALL", "GRAND STAIR", "FOYER BALCONY", "UPPER LANDING",
      "UPPER GRAND BATHROOM", "PRIMARY SUITE", "REAR LOUNGE", "EAST REAR SUITE", "READING ROOM",
      "EAST FRONT SUITE", "WEST FRONT SUITE", "SERVICE STAIR", "ARCHIVE", "BASEMENT CORRIDOR",
      "WINE CELLAR", "LAUNDRY & LINEN", "PANTRY", "REAR CROSS-CORRIDOR", "BOILER ROOM", "WORKROOM",
      "BULK STORAGE",
    ];
    assert(wholeHomeRun.qaLastWholeHomeRun?.completed && wholeHomeRun.completedRouteLoops === 1, "deterministic whole-home patrol should complete one full loop");
    assert(requiredFloors.every((floor) => wholeHomeRun.visitedRouteFloors.includes(floor)), "whole-home patrol should visit the main, upper, and basement levels");
    assert(requiredZones.every((zone) => wholeHomeRun.visitedRouteZones.includes(zone)), "whole-home patrol should reach every major room and connecting stair zone");
    assert(wholeHomeRun.waypointCount >= 220 && wholeHomeRun.routeSegmentsTraversed === wholeHomeRun.waypointCount - 1, "whole-home patrol should traverse every authored route segment");
    assert(wholeHomeRun.routeSummary.distanceMeters > 600 && wholeHomeRun.qaLastWholeHomeRun.simulatedSeconds < 1800, "whole-home loop should cover the full mansion within the QA time budget");
    assert(wholeHomeRun.routeSummary.doors >= 19 && wholeHomeRun.visitedRouteDoors.length === wholeHomeRun.routeSummary.doors, "Mr. Feast should automatically open every door required by his route");
    assert(wholeHomeRun.routeDoorOpenEvents >= wholeHomeRun.visitedRouteDoors.length, "whole-home patrol should record real automatic door-open events");
    assert(Object.values(wholeHomeRun.liveBones.hipsScale).every((value) => Math.abs(value - 1) < 0.001) && Math.abs(wholeHomeRun.liveBones.leftThighLength - stableBodyBaseline.leftThighLength) < 0.001, `a complete route loop must not resize Mr. Feast or his limbs: ${JSON.stringify(wholeHomeRun.liveBones)}`);
    assert((await diagnostics(page)).lighting.activeFloor === playerFloorBeforeNpcTraversal, "Mr. Feast changing floors must not change the player's lighting context");

    await page.evaluate(() => window.MrFeastFresh.resetMrFeastWandererForQA());
    try {
      await page.waitForFunction(() => {
        const current = window.MrFeastFresh.getMrFeastState();
        return current.currentAnimation === "stalk" && current.distanceTravelled > 0.2;
      }, null, { timeout: 10000 });
    } catch (_) {
      const stalled = await page.evaluate(() => window.MrFeastFresh.getMrFeastState());
      throw new Error(`Mr. Feast did not resume his live patrol: ${JSON.stringify(stalled)}`);
    }
    npc = await page.evaluate(() => window.MrFeastFresh.getMrFeastState());
    assert(npc.currentAnimation === "stalk" && npc.distanceTravelled > 0.2, "Mr. Feast should resume his restrained live patrol after deterministic animation QA");

    await page.locator("#mansion-canvas").focus();
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).journal.open);
    const journalA11y = await page.evaluate(() => ({
      role: document.getElementById("mansion-journal")?.getAttribute("role"),
      modal: document.getElementById("mansion-journal")?.getAttribute("aria-modal"),
      activeId: document.activeElement?.id,
      canvasInert: Boolean(document.getElementById("mansion-canvas")?.inert),
    }));
    assert(journalA11y.role === "dialog" && journalA11y.modal === "true", "journal should expose modal dialog semantics");
    assert(journalA11y.activeId === "mansion-journal-close" && journalA11y.canvasInert, "journal should move focus inside and make the game background inert");
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).journal.open);
    assert(await page.evaluate(() => document.activeElement?.id) === "mansion-canvas", "Tab should close the desktop dossier and restore focus to the canvas opener");
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).journal.open);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).journal.open);
    assert(await page.evaluate(() => document.activeElement?.id) === "mansion-canvas", "closing the desktop dossier should restore focus to the canvas opener");

    await teleportForInteraction(page, "contestant13DigSite", /need.*shovel|disturbed earth/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.digSiteExcavated === false, "dig site must not excavate without the shovel");
    assert(state.contestant13.basementKeyFound === false, "early dig must not grant the basement key");

    await teleportForInteraction(page, "contestant13BasementDoor", /basement.*locked|need.*key/i);
    await screenshotStage(page, "basement-door-locked-desktop.png");
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.basementUnlocked === false, "the basement door must remain locked without the maze key");
    assert(state.contestant13.world.basementDoorLocked === true && state.contestant13.world.basementDoorOpen === false, "an early door attempt must not change its physical state");

    await teleportForInteraction(page, "contestant13ArchiveCage", /cage.*locked|evidence.*locked/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.archiveCageUnlocked === false, "evidence cage must remain locked without the recovered basement key");
    assert(state.contestant13.basementUnlocked === false, "QA teleporting into the Archive must not bypass the basement gate");

    await teleportForInteraction(page, "contestant13WorkshopRelay", /inspect.*relay|camera relay/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.relaySabotaged === false, "relay must not be sabotaged before hearing the recording");

    await teleportForInteraction(page, "contestant13LibraryBook", /read “.+”/i);
    await screenshotStage(page, "library-shelf-book-subtle-desktop.png");
    await pressInteract(page);
    await page.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    state = await diagnostics(page);
    assert(state.contestant13.bookRead === true, "Library book interaction should mark the clue read");
    assert(state.journal.entries.filter((id) => id === "contestant-13-book").length === 1, "book clue should enter the journal exactly once");
    assert(/garden.*shovel|shovel.*garden/i.test(state.journal.currentObjective), "reading the book should direct the player to the garden shovel");
    assert(state.feastSays?.phase === "called" && state.feastSays.triggerClueId === "contestant-13-book" && state.feastSays.clueProgressLocked, `the first story clue should call Feast Says and pause the trail; got ${JSON.stringify(state.feastSays)}`);
    assert(await page.locator("#mansion-casefile").isHidden(), "clue discoveries must not open an on-screen trail/objective HUD");
    assert(await page.locator("#mansion-story-progress").textContent() === "Trail 1/7", "reading the book should count as the first trail step for diagnostics");
    assert((await page.locator("#mansion-objective").textContent() || "").trim() === "", "objective tip text must stay blank; clues live in Bag only");
    await screenshotStage(page, "library-clue-desktop.png");

    state = await completeFirstClueCompetition(page, "contestant-13-book");
    if (!(await page.locator("#mansion-book-reader").isHidden())) {
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.getElementById("mansion-book-reader")?.hidden);
    }
    assert(await page.locator("#mansion-casefile").isHidden(), "after Feast Says, investigation guidance must remain inventory-only with no trail HUD");
    await teleportForInteraction(page, "contestant13LibraryBook", /read “.+”/i);
    await pressInteract(page);
    await page.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    state = await diagnostics(page);
    assert(state.journal.entries.filter((id) => id === "contestant-13-book").length === 1, "rereading must not duplicate the book clue");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("mansion-book-reader")?.hidden);

    await teleportForInteraction(page, "contestant13GardenShovel", /take.*shovel|garden shovel/i);
    await screenshotStage(page, "shovel-hidden-in-roses-desktop.png");
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.shovelTaken === true, "shovel interaction should collect the shovel");
    assert(state.inventory.items.filter((id) => id === "garden-shovel").length === 1, "shovel should enter inventory exactly once");
    assert(state.inventory.bulkyItem === "garden-shovel", "shovel should be the carried bulky item");
    assert(state.contestant13.world.shovelVisible === false, "collected shovel should disappear from the world");
    assert(state.stormRun?.phase === "dormant" && state.stormRun.callCount === 0, `the post-Feast shovel must remain earned without calling Storm Run; got ${JSON.stringify(state.stormRun)}`);

    await teleportForInteraction(page, "contestant13DigSite", /dig.*(?:contestant 13|xiii)|excavate|disturbed earth/i);
    await screenshotStage(page, "dig-site-subtle-desktop.png");
    await pressInteract(page);
    await waitForContestantFlag(page, "digSiteExcavated");
    state = await diagnostics(page);
    assert(state.contestant13.basementKeyFound === true, "excavation should grant the basement service key");
    assert(state.contestant13.tapeFound === true, "excavation should recover Contestant 13's tape");
    assert(state.inventory.items.filter((id) => id === "basement-key-b13").length === 1, "basement key must not duplicate");
    assert(state.inventory.items.filter((id) => id === "contestant-13-tape").length === 1, "tape must not duplicate");
    assert(state.contestant13.world.digMoundVisible === false && state.contestant13.world.digMarkerVisible === false && state.contestant13.world.digHoleVisible === true, "excavation should leave only an unmarked hole");
    assert(state.stormRun?.phase === "called" && state.stormRun.triggerReason === "hedge-maze-key" && state.stormRun.triggerClueId === "hedge-maze-b13-cache", `the recovered maze key should call Storm Run; got ${JSON.stringify(state.stormRun)}`);
    state = await completeStormRunCompetition(page, "hedge-maze-b13-cache");
    await teleportForInteraction(page, "contestant13DigSite", /empty hole/i);
    await screenshotStage(page, "dig-site-empty-hole-desktop.png");

    await teleportForInteraction(page, "contestant13BasementDoor", /unlock.*basement|use.*key/i);
    await pressInteract(page);
    await waitForContestantFlag(page, "basementUnlocked");
    state = await diagnostics(page);
    assert(state.contestant13.basementUnlocked === true, "the recovered maze key should unlock the basement threshold");
    assert(state.contestant13.world.basementDoorLocked === false && state.contestant13.world.basementDoorOpen === true, "unlocking should open the basement door and persist in world diagnostics");
    assert(state.inventory.items.filter((id) => id === "basement-key-b13").length === 1, "using the basement key must not duplicate it");
    await screenshotStage(page, "basement-door-unlocked-desktop.png");

    await teleportForInteraction(page, "contestant13ArchiveCage", /unlock.*a-3|evidence cage/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.archiveCageUnlocked === true, "the recovered service key should unlock the basement evidence cage");
    assert(state.contestant13.recordingPlayed === false, "unlocking the cage must not auto-play the recording");

    await teleportForInteraction(page, "contestant13ArchiveCage", /play.*recording|contestant 13.*recording/i);
    await pressInteract(page);
    state = await diagnostics(page);
    assert(state.contestant13.recordingPlayed === true, "recorder interaction should play Contestant 13's tape");
    assert(state.journal.entries.includes("patron-feed-transcript"), "recording transcript should enter the journal");
    assert(state.contestant13.world.recorderIndicatorActive === true, "playing the recovered tape should light the recorder indicator");
    await screenshotStage(page, "recording-played-desktop.png");

    const circuitsBefore = JSON.stringify(state.circuits.map(({ name, on }) => [name, on]));
    await teleportForInteraction(page, "contestant13WorkshopRelay", /sabotage.*patron|sever.*feed/i);
    await pressInteract(page);
    await waitForContestantFlag(page, "relaySabotaged", 6000);
    state = await diagnostics(page);
    assert(state.contestant13.completed === true, "relay sabotage should complete the vertical slice");
    assert(state.contestant13.threatEscalated === true, "signal loss should raise the future-NPC threat hook");
    assert(state.contestant13.world.relayOnline === false, "sabotaged relay should stay visually offline");
    assert(state.contestant13.world.relayOnlineBulbVisible === false, "green relay bulb should turn off after sabotage");
    assert(state.contestant13.world.relayAlarmBulbVisible === true && state.contestant13.world.relayAlarmPulsing === true, "red relay alarm should remain visible and pulse after sabotage");
    assert(JSON.stringify(state.circuits.map(({ name, on }) => [name, on])) === circuitsBefore, "story sabotage must not toggle mansion light circuits");
    assert(/blind|signal|feed/i.test(state.journal.currentObjective), "completion objective should acknowledge the severed feed");

    const threatenedFace = await page.evaluate(() => {
      window.MrFeastFresh.setMrFeastFaceForQA({ expression: null, snap: true });
      window.MrFeastFresh.advanceMrFeastFaceForQA(0.5);
      return window.MrFeastFresh.getMrFeastState().face;
    });
    assert(threatenedFace.automaticExpression === "threatened" && threatenedFace.expression === "threatened", "relay sabotage should autonomously escalate Mr. Feast's expression");
    assert(threatenedFace.weights.smile_wide >= 0.5, "autonomous threat escalation should visibly widen Mr. Feast's smile");

    assert((await page.locator("#mansion-objective").textContent() || "").trim() === "", "completed sabotage must not re-open objective tip text on the HUD");
    assert(/blind|signal|feed/i.test(state.journal.currentObjective || ""), "internal completion state should still acknowledge the severed feed for diagnostics/saves");
    await screenshotStage(page, "relay-sabotaged-desktop.png");
    await page.evaluate(() => window.MrFeastFresh.teleport("contestant13GardenShovel"));
    await page.evaluate(() => window.MrFeastFresh.teleport("contestant13WorkshopRelay"));
    state = await diagnostics(page);
    assert(state.contestant13.world.relayOnlineBulbVisible === false && state.contestant13.world.relayAlarmBulbVisible === true, "relay visual state should survive exterior culling and return");
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
    await mobilePage.goto(`${gameUrl}&view=contestant13GardenShovel`, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await teleportForInteraction(mobilePage, "contestant13GardenShovel", /shovel/i);
    await mobilePage.locator("#touch-interact").click({ force: true });
    await waitForContestantFlag(mobilePage, "shovelTaken");
    assert(await mobilePage.locator("#mansion-casefile").isHidden(), "finding the shovel before the book must not open any trail/objective HUD");
    let earlyShovelState = await diagnostics(mobilePage);
    assert(earlyShovelState.feastSays?.phase === "called" && earlyShovelState.feastSays.triggerClueId === "faceless-fountain-shovel" && earlyShovelState.feastSays.clueProgressLocked, `finding the first clue out of order should still call Feast Says and pause later clues; got ${JSON.stringify(earlyShovelState.feastSays)}`);
    await teleportForInteraction(mobilePage, "contestant13DigSite", /dig.*xiii|disturbed earth/i);
    await mobilePage.locator("#touch-interact").click({ force: true });
    earlyShovelState = await diagnostics(mobilePage);
    assert(earlyShovelState.contestant13.digSiteExcavated === false, "finding the shovel first must not bypass the Library story clue");
    assert(/library|book|shel/i.test(earlyShovelState.journal.currentObjective), "early shovel discovery should preserve the internal Library progression without exposing tips on the HUD");
    assert((await mobilePage.locator("#mansion-objective").textContent() || "").trim() === "", "out-of-order dig must not surface Library tip text on screen");
    assert(earlyShovelState.feastSays.clueProgressLocked, "the out-of-order dig attempt should remain blocked during the live-event call");
    await completeFirstClueCompetition(mobilePage, "faceless-fountain-shovel");
    assert(await mobilePage.locator("#mansion-casefile").isHidden(), "completing Feast Says must still keep the trail HUD suppressed");
    await teleportForInteraction(mobilePage, "contestant13LibraryBook", /read “.+”/i);
    await mobilePage.locator("#touch-interact").click({ force: true });
    await waitForContestantFlag(mobilePage, "bookRead");
    await mobilePage.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    let mobileBookState = await diagnostics(mobilePage);
    assert(mobileBookState.stormRun?.phase === "dormant" && mobileBookState.stormRun.callCount === 0, `the post-Feast mobile book must not call Storm Run; got ${JSON.stringify(mobileBookState.stormRun)}`);
    assert(mobileBookState.contestant13.bookRead && mobileBookState.journal.entries.includes("contestant-13-book"), "the mobile book clue should remain earned while Storm Run waits for its real gate");
    await mobilePage.keyboard.press("Escape");
    await mobilePage.waitForFunction(() => document.getElementById("mansion-book-reader")?.hidden);
    await teleportForInteraction(mobilePage, "contestant13DigSite", /dig.*(?:contestant 13|xiii)|excavate|disturbed earth/i);
    await mobilePage.locator("#touch-interact").click({ force: true });
    await waitForContestantFlag(mobilePage, "basementKeyFound", 15000);
    mobileBookState = await diagnostics(mobilePage);
    assert(mobileBookState.stormRun?.phase === "called" && mobileBookState.stormRun.triggerReason === "hedge-maze-key" && mobileBookState.stormRun.triggerClueId === "hedge-maze-b13-cache", `the recovered mobile maze key should call Storm Run; got ${JSON.stringify(mobileBookState.stormRun)}`);
    await completeStormRunCompetition(mobilePage, "hedge-maze-b13-cache");
    await teleportForInteraction(mobilePage, "contestant13LibraryBook", /read “.+”/i);
    await mobilePage.locator("#touch-interact").click({ force: true });
    await mobilePage.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    const mobileUi = await mobilePage.evaluate(() => {
      const caseFile = document.getElementById("mansion-casefile");
      const touch = document.getElementById("touch-interact")?.getBoundingClientRect();
      return {
        caseHidden: Boolean(caseFile?.hidden),
        objectiveText: document.getElementById("mansion-objective")?.textContent || "",
        touch: touch && { width: touch.width, height: touch.height },
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    assert(mobileUi.caseHidden, "mobile trail/objective HUD must stay hidden after clues are found");
    assert(mobileUi.objectiveText.trim() === "", "mobile objective tip text must stay blank after clues are found");
    assert(mobileUi.touch && mobileUi.touch.width >= 44 && mobileUi.touch.height >= 44, "touch interact target should remain at least 44px");
    await screenshotStage(mobilePage, "printed-book-marginalia-mobile.png");
    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    await mobileContext.close();

    console.log("Mr. Feast Contestant 13 browser test: progression, gates, persistence, accessibility, and mobile touch passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast Contestant 13 browser test failed: ${error.message}`);
  process.exitCode = 1;
});
