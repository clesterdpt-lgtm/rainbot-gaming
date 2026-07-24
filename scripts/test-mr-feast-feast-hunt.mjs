import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_HUNT_TEST_PORT || (56600 + (process.pid % 8000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-feast-hunt");

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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await serverResponds()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

function watchErrors(page, errors) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
  });
}

async function bootPage(browser, viewport, errors, contextOptions = {}) {
  const page = await browser.newPage({ viewport, ...contextOptions });
  watchErrors(page, errors);
  await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 180000 });
  await page.waitForFunction(
    () => ["ready", "error"].includes(window.MrFeastFresh.getMrFeastState()?.loadStatus)
      && window.MrFeastFresh.getContestantState()?.settled,
    null,
    { timeout: 180000 },
  );
  await page.waitForTimeout(300);
  return page;
}

async function huntState(page) {
  return page.evaluate(() => window.MrFeastFresh.getFeastHuntState());
}

async function prepareCalledHunt(page) {
  return page.evaluate(() => {
    window.MrFeastFresh.setFeastHuntGateForQA({ stormCompleted: true, relaySabotaged: true });
    return window.MrFeastFresh.callFeastHuntForQA("gate");
  });
}

async function beginHunt(page) {
  const called = await prepareCalledHunt(page);
  assert(called?.started, `Feast Hunt should call after both gates: ${JSON.stringify(called)}`);
  const started = await page.evaluate(() => window.MrFeastFresh.startFeastHuntForQA());
  assert(started?.started, `Feast Hunt should stage the foyer briefing: ${JSON.stringify(started)}`);
  await page.keyboard.press("e");
  let hunt = await huntState(page);
  assert(hunt.phase === "briefing" && hunt.briefing.canSkip === false, `E should skip only the rules and retain the countdown: ${JSON.stringify(hunt.briefing)}`);
  await page.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(3.2));
  hunt = await huntState(page);
  assert(hunt.phase === "hunting", `spoken countdown should release the hunt: ${JSON.stringify(hunt)}`);
  return hunt;
}

async function assertSourceContract() {
  const [runtime, html, milestone] = await Promise.all([
    readFile(path.join(root, "assets", "js", "mr-feast-mansion.js"), "utf8"),
    readFile(path.join(root, "games", "mr-feast-mansion.html"), "utf8"),
    readFile(path.join(root, "docs", "milestones", "59-feast-hunt-third-competition.md"), "utf8"),
  ]);

  assert(/const FEAST_HUNT_PHASE\s*=\s*Object\.freeze/.test(runtime), "Feast Hunt must define an explicit phase enum");
  assert(/const FEAST_HUNT\s*=\s*Object\.freeze/.test(runtime), "Feast Hunt tuning must live in a named constant table");
  assert(/class FeastHuntSystem/.test(runtime), "Feast Hunt must use a focused owning system");
  assert(/feastHunt:\s*\{/.test(runtime), "authoritative mansion state must own Feast Hunt");
  assert(/reportDeadlineSeconds:\s*5\s*\*\s*60/.test(runtime), "Feast Hunt needs the five-minute production-call deadline");
  assert(/Golden Bell/.test(runtime) && /Golden Goblet/.test(runtime) && /Golden Carving Knife/.test(runtime), "the three authored gold props are missing");
  assert(/main-level/.test(runtime) && /second-floor/.test(runtime) && /basement-level/.test(runtime), "Feast Hunt props must span all three mansion levels");
  assert(/allowsSecuritySystems/.test(runtime), "Feast Hunt must distinguish clue hold from active camera/security ownership");
  assert(/feast-hunt-eliminated/.test(runtime) && /feast-hunt-no-show/.test(runtime) && /feast-hunt-juniper-won/.test(runtime), "Feast Hunt catch, no-show, and rival-win losses need explicit recoverable outcomes");
  assert(/getFeastHuntState/.test(runtime) && /advanceFeastHuntForQA/.test(runtime), "focused Feast Hunt diagnostics and deterministic clock are missing");
  assert(/collectFeastHuntItemForQA/.test(runtime) && /placePlayerNearFeastHuntItemForQA/.test(runtime), "Feast Hunt item QA controls are missing");
  assert(/placePlayerAtFeastHuntReturnForQA/.test(runtime), "Feast Hunt needs a real foyer return QA control");
  assert(/startFeastHuntRace/.test(runtime) && /updateFeastHuntEntry/.test(runtime), "Juniper needs an authored active Feast Hunt route");
  assert(/activateBlackout/.test(runtime) && /restoreBlackout/.test(runtime), "Feast Hunt needs competition-owned full-house blackout lifecycle");
  assert(/setFeastHuntGateForQA/.test(runtime) && /triggerFeastHuntPursuitForQA/.test(runtime), "Feast Hunt gate/pursuit QA controls are missing");
  assert(/id="mansion-feast-hunt"/.test(html), "the game page is missing the Feast Hunt HUD region");
  assert(/id="mansion-feast-hunt-progress"/.test(html), "the Feast Hunt HUD must expose three-item progress");
  assert(/aria-label="Feast Hunt status"/.test(html), "the Feast Hunt HUD needs an accessible label");
  assert(/user playtest/i.test(milestone), "Milestone 59 must preserve the subjective stealth/horror playtest");
}

async function run() {
  await assertSourceContract();

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
    const gatePage = await bootPage(browser, { width: 1280, height: 820 }, errors);

    // --- Third-game gate and production call --------------------------------
    let hunt = await huntState(gatePage);
    assert(hunt.phase === "dormant", `Feast Hunt should begin dormant: ${JSON.stringify(hunt)}`);
    let attempt = await gatePage.evaluate(() => {
      window.MrFeastFresh.setFeastHuntGateForQA({ stormCompleted: false, relaySabotaged: true });
      return window.MrFeastFresh.callFeastHuntForQA("gate");
    });
    assert(!attempt.started && attempt.reason === "storm-run-incomplete", `relay sabotage alone must not call Game 3: ${JSON.stringify(attempt)}`);
    attempt = await gatePage.evaluate(() => {
      window.MrFeastFresh.setFeastHuntGateForQA({ stormCompleted: true, relaySabotaged: false });
      return window.MrFeastFresh.callFeastHuntForQA("gate");
    });
    assert(!attempt.started && attempt.reason === "patron-feed-active", `Storm Run alone must not call Game 3: ${JSON.stringify(attempt)}`);
    attempt = await prepareCalledHunt(gatePage);
    assert(attempt.started, `both gates should call Feast Hunt exactly once: ${JSON.stringify(attempt)}`);
    hunt = await huntState(gatePage);
    assert(
      hunt.phase === "called"
        && hunt.callCount === 1
        && hunt.reportRemaining === 300
        && hunt.hostWaiting
        && hunt.filmSet.cameraCount === 1
        && hunt.filmSet.lightCount === 2
        && hunt.filmSet.boomMicCount === 1,
      `called foyer production state is incomplete: ${JSON.stringify(hunt)}`,
    );
    const duplicate = await gatePage.evaluate(() => window.MrFeastFresh.callFeastHuntForQA("gate"));
    assert(!duplicate.started && duplicate.reason === "already-called", `Feast Hunt must call only once: ${JSON.stringify(duplicate)}`);

    // --- Called deadline, pause fairness, and no-show ------------------------
    await gatePage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(17));
    const beforePause = (await huntState(gatePage)).reportRemaining;
    await gatePage.evaluate(() => {
      window.MrFeastFresh.setMenuOpenForQA(true);
      window.MrFeastFresh.advanceFeastHuntForQA(20);
      window.MrFeastFresh.setMenuOpenForQA(false);
    });
    const afterPause = (await huntState(gatePage)).reportRemaining;
    assert(Math.abs(beforePause - afterPause) < 0.01, `blocking UI must pause the Feast Hunt call deadline: ${JSON.stringify({ beforePause, afterPause })}`);
    assert(await gatePage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving the called Feast Hunt state should succeed");
    await gatePage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(12));
    assert(await gatePage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading the called Feast Hunt state should succeed");
    const restoredCalled = await huntState(gatePage);
    assert(Math.abs(restoredCalled.reportRemaining - beforePause) < 0.1, `called save must preserve the exact deadline: ${JSON.stringify(restoredCalled)}`);
    await gatePage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(301));
    let diagnostics = await gatePage.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert(
      diagnostics.gameOver?.reason === "feast-hunt-no-show"
        && diagnostics.feastHunt.phase === "failed",
      `missing Game 3 must produce a recoverable no-show elimination: ${JSON.stringify({ gameOver: diagnostics.gameOver, hunt: diagnostics.feastHunt })}`,
    );
    await gatePage.close();

    // --- Foyer briefing, immediate skip, and real item collection -----------
    const playPage = await bootPage(browser, { width: 1280, height: 820 }, errors);
    hunt = await beginHunt(playPage);
    assert(
      hunt.briefing.countdownSequence.join(",") === "3,2,1,0"
        && hunt.briefing.rulesLine.includes("three")
        && hunt.briefing.rulesLine.toLowerCase().includes("caught"),
      `Feast Hunt needs a complete spoken countdown and explicit rules: ${JSON.stringify(hunt.briefing)}`,
    );
    assert(hunt.items.length === 3 && hunt.items.every((item) => item.visible && item.registered), `all three props should appear at release: ${JSON.stringify(hunt.items)}`);
    assert(new Set(hunt.items.map((item) => item.level)).size === 3, `props must span three levels: ${JSON.stringify(hunt.items)}`);
    assert(
      hunt.blackout.active
        && hunt.blackout.interiorCircuitCount > 20
        && hunt.blackout.offCircuitCount === hunt.blackout.interiorCircuitCount
        && hunt.blackout.allInteriorOff,
      `the hunt must release into a full mansion blackout: ${JSON.stringify(hunt.blackout)}`,
    );
    assert(
      hunt.rival.active
        && hunt.rival.id === "juniper-cross"
        && hunt.rival.collectedCount === 0
        && hunt.rival.challengeMode === "feast-hunt",
      `Juniper must begin an active competing route instead of returning to the Reading Room: ${JSON.stringify(hunt.rival)}`,
    );
    const juniperStart = hunt.rival.position;
    await playPage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(4));
    hunt = await huntState(playPage);
    assert(
      hunt.rival.active
        && Math.hypot(hunt.rival.position.x - juniperStart.x, hunt.rival.position.z - juniperStart.z) > 0.75,
      `Juniper must visibly leave her foyer mark when the hunt starts: ${JSON.stringify({ start: juniperStart, rival: hunt.rival })}`,
    );

    const bellStaging = await playPage.evaluate(() => window.MrFeastFresh.placePlayerNearFeastHuntItemForQA("golden-bell"));
    assert(bellStaging?.itemId === "golden-bell", `QA staging must target the Golden Bell: ${JSON.stringify(bellStaging)}`);
    await playPage.waitForFunction(() => /golden bell/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 10000 });
    await playPage.keyboard.press("e");
    await playPage.waitForFunction(() => window.MrFeastFresh.getFeastHuntState()?.collectedCount === 1);
    hunt = await huntState(playPage);
    assert(
      hunt.collectedIds.join(",") === "golden-bell"
        && !hunt.items.find((item) => item.id === "golden-bell")?.visible
        && !hunt.items.find((item) => item.id === "golden-bell")?.registered,
      `real E collection should remove the Bell exactly once: ${JSON.stringify(hunt)}`,
    );
    const duplicateBell = await playPage.evaluate(() => window.MrFeastFresh.collectFeastHuntItemForQA("golden-bell"));
    assert(!duplicateBell.accepted && duplicateBell.reason === "already-collected", `duplicate pickup must be rejected: ${JSON.stringify(duplicateBell)}`);
    const statuesAfterBell = hunt.statues;
    assert(
      statuesAfterBell.stage === 1
        && statuesAfterBell.movedWhileUnobserved
        && statuesAfterBell.entries.every((entry) => entry.positionUnchanged && entry.rotationChanged),
      `first pickup should turn both fixed foyer statues only while unobserved: ${JSON.stringify(statuesAfterBell)}`,
    );

    // --- Camera/personal sight retains stealth and pursuit ownership ----------
    const cameraStart = await playPage.evaluate(() => window.MrFeastFresh.triggerFeastHuntPursuitForQA("camera"));
    assert(cameraStart?.accepted && cameraStart.source === "camera", `hostile camera lock must begin the existing pursuit: ${JSON.stringify(cameraStart)}`);
    diagnostics = await playPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert(
      diagnostics.security.mode === "lockdown"
        && diagnostics.mrFeast.pursuit.active?.kind === "feast-hunt"
        && diagnostics.mrFeast.pursuit.trackingSource === "camera",
      `Feast Hunt camera detection must reuse the real pursuit state: ${JSON.stringify({ security: diagnostics.security, pursuit: diagnostics.mrFeast.pursuit })}`,
    );
    const hidden = await playPage.evaluate(() => window.MrFeastFresh.enterHideSpotForQA("coat"));
    assert(hidden?.hidden, "the existing coat-closet hiding spot must remain available during Feast Hunt");
    const lost = await playPage.evaluate(() => window.MrFeastFresh.advanceMrFeastPursuitForQA(7));
    assert(!lost.active && lost.outcome === "lost", `hiding should end the bounded last-known-position pursuit: ${JSON.stringify(lost)}`);

    // --- Save normalization preserves pickups but drops transient threat ------
    await playPage.evaluate(() => window.MrFeastFresh.exitHideSpotForQA());
    assert(await playPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving a live Feast Hunt should succeed");
    await playPage.evaluate(() => window.MrFeastFresh.collectFeastHuntItemForQA("golden-goblet"));
    assert(await playPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading a live Feast Hunt should succeed");
    hunt = await huntState(playPage);
    diagnostics = await playPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert(
      hunt.phase === "called"
        && hunt.collectedIds.join(",") === "golden-bell"
        && diagnostics.mrFeast.pursuit.active === null
        && hunt.reportRemaining === 300
        && !hunt.blackout.active
        && hunt.rival.collectedCount === 0,
      `live saves must normalize to a fresh call while preserving collected props: ${JSON.stringify({ hunt, pursuit: diagnostics.mrFeast.pursuit })}`,
    );
    await playPage.close();

    // --- Any-floor catch is an elimination only while Game 3 is live --------
    const catchPage = await bootPage(browser, { width: 1280, height: 820 }, errors);
    await beginHunt(catchPage);
    const catchResult = await catchPage.evaluate(() => window.MrFeastFresh.catchFeastHuntPlayerForQA("main-level"));
    assert(catchResult?.eliminated, `a main-floor Feast Hunt catch must eliminate: ${JSON.stringify(catchResult)}`);
    diagnostics = await catchPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert(
      diagnostics.gameOver?.reason === "feast-hunt-eliminated"
        && diagnostics.feastHunt.phase === "failed"
        && !diagnostics.feastHunt.blackout.active
        && diagnostics.gameOver.floor !== "BASEMENT",
      `Game 3 catch should override the ordinary upstairs warning: ${JSON.stringify({ gameOver: diagnostics.gameOver, hunt: diagnostics.feastHunt })}`,
    );
    await catchPage.close();

    // --- Juniper can independently search, collect, return, and win -----------
    const rivalPage = await bootPage(browser, { width: 1280, height: 820 }, errors);
    await beginHunt(rivalPage);
    await rivalPage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(240));
    diagnostics = await rivalPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert(
      diagnostics.gameOver?.reason === "feast-hunt-juniper-won"
        && diagnostics.feastHunt.phase === "failed"
        && diagnostics.feastHunt.outcome === "juniper"
        && diagnostics.feastHunt.rival.collectedCount === 3
        && diagnostics.feastHunt.rival.returned
        && !diagnostics.feastHunt.blackout.active,
      `Juniper must be able to finish her own route and beat the player back to the foyer: ${JSON.stringify({ gameOver: diagnostics.gameOver, hunt: diagnostics.feastHunt })}`,
    );
    await rivalPage.close();

    // --- Three items must be physically returned to the foyer to finish -------
    const winPage = await bootPage(browser, { width: 1280, height: 820 }, errors);
    await beginHunt(winPage);
    for (const id of ["golden-bell", "golden-goblet", "golden-carving-knife"]) {
      const result = await winPage.evaluate((itemId) => window.MrFeastFresh.collectFeastHuntItemForQA(itemId), id);
      assert(result?.accepted, `QA should collect ${id}: ${JSON.stringify(result)}`);
    }
    hunt = await huntState(winPage);
    assert(
      hunt.phase === "hunting"
        && hunt.collectedCount === 3
        && hunt.items.every((item) => !item.visible && !item.registered)
        && hunt.readyToReturn
        && hunt.returnStation.visible
        && hunt.returnStation.registered
        && /return/i.test(hunt.ui.status),
      `collecting all three props must require a physical foyer return: ${JSON.stringify(hunt)}`,
    );
    const returnStaging = await winPage.evaluate(() => window.MrFeastFresh.placePlayerAtFeastHuntReturnForQA());
    assert(returnStaging?.readyToReturn, `QA must stage the player at the live foyer hand-in: ${JSON.stringify(returnStaging)}`);
    await winPage.waitForFunction(() => /return|place/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 10000 });
    await winPage.keyboard.press("e");
    await winPage.waitForFunction(() => window.MrFeastFresh.getFeastHuntState()?.phase === "completed");
    hunt = await huntState(winPage);
    assert(
      hunt.phase === "completed"
        && hunt.outcome === "player"
        && hunt.finalePending
        && !hunt.blackout.active
        && !hunt.returnStation.registered
        && !hunt.juniperSacrifice,
      `the real foyer hand-in should complete Game 3 and restore mansion lighting: ${JSON.stringify(hunt)}`,
    );
    const visibleHud = await winPage.locator("#mansion-feast-hunt").isVisible();
    assert(visibleHud, "the completion card should remain briefly visible");
    await winPage.screenshot({ path: path.join(artifactDir, "feast-hunt-complete-desktop.png") });

    const completionSafety = await winPage.evaluate(() => {
      const cameraId = "cam-basement-boiler";
      window.MrFeastFresh.resetCameraSecurityForQA(null);
      window.MrFeastFresh.setCameraStoryStateForQA({ basementUnlocked: true, relaySabotaged: true });
      window.MrFeastFresh.setCameraSoloForQA(cameraId);
      window.MrFeastFresh.setCameraSweepForQA(cameraId, 0);
      window.MrFeastFresh.setCameraOccludedForQA(cameraId, false);
      window.MrFeastFresh.placePlayerInCameraLaneForQA(cameraId, { distance: 3.5 });
      const security = window.MrFeastFresh.advanceCameraSecurityForQA(3);
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 0, y: -3.8, z: 0, yaw: 0 });
      window.MrFeastFresh.placePlayerNearMrFeastForQA(1.9, Math.PI);
      const awareness = window.MrFeastFresh.advanceMrFeastAwarenessForQA(1);
      const diagnostics = JSON.parse(window.render_game_to_text());
      return {
        security,
        awareness,
        feastHunt: diagnostics.feastHunt,
        pursuit: diagnostics.mrFeast.pursuit,
      };
    });
    assert(
      completionSafety.feastHunt.completionCardRemaining > 0
        && !completionSafety.security.observed
        && !completionSafety.awareness.active
        && completionSafety.pursuit.active === null,
      `the visible SAFE completion card must suspend camera and personal reacquisition: ${JSON.stringify(completionSafety)}`,
    );
    const threatsResume = await winPage.evaluate(() => {
      window.MrFeastFresh.advanceFeastHuntForQA(6.1);
      const cameraId = "cam-basement-boiler";
      window.MrFeastFresh.resetCameraSecurityForQA(null);
      window.MrFeastFresh.setCameraStoryStateForQA({ basementUnlocked: true, relaySabotaged: true });
      window.MrFeastFresh.setCameraSoloForQA(cameraId);
      window.MrFeastFresh.setCameraSweepForQA(cameraId, 0);
      window.MrFeastFresh.setCameraOccludedForQA(cameraId, false);
      window.MrFeastFresh.placePlayerInCameraLaneForQA(cameraId, { distance: 3.5 });
      const security = window.MrFeastFresh.advanceCameraSecurityForQA(3);
      return {
        security,
        feastHunt: window.MrFeastFresh.getFeastHuntState(),
      };
    });
    assert(
      threatsResume.feastHunt.completionCardRemaining === 0 && threatsResume.security.observed,
      `ordinary mansion security should resume after the completion grace: ${JSON.stringify(threatsResume)}`,
    );
    await winPage.close();

    // --- 390x844 mobile HUD and touch-safe collection ------------------------
    const mobilePage = await bootPage(
      browser,
      { width: 390, height: 844 },
      errors,
      { hasTouch: true, isMobile: true },
    );
    const collectedFlashlight = await mobilePage.evaluate(() => window.MrFeastFresh.collectFlashlightForQA());
    assert(collectedFlashlight?.collected, `mobile Hunt setup should grant the real flashlight: ${JSON.stringify(collectedFlashlight)}`);
    await beginHunt(mobilePage);
    await mobilePage.evaluate(() => window.MrFeastFresh.placePlayerNearFeastHuntItemForQA("golden-bell"));
    await mobilePage.waitForFunction(() => /golden bell/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 10000 });
    const touchBox = await mobilePage.locator("#touch-interact").boundingBox();
    await mobilePage.locator("#touch-interact").dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true });
    await mobilePage.waitForFunction(() => window.MrFeastFresh.getFeastHuntState()?.collectedCount === 1);
    const hudBox = await mobilePage.locator("#mansion-feast-hunt").boundingBox();
    assert(
      hudBox && hudBox.height <= 64 && hudBox.x >= 0 && hudBox.x + hudBox.width <= 390,
      `mobile Feast Hunt HUD must stay compact and on-screen: ${JSON.stringify(hudBox)}`,
    );
    assert(touchBox && touchBox.width >= 44 && touchBox.height >= 44, `mobile Interact must remain touch-safe: ${JSON.stringify(touchBox)}`);
    await mobilePage.screenshot({ path: path.join(artifactDir, "feast-hunt-item-one-mobile.png") });
    await mobilePage.setViewportSize({ width: 844, height: 390 });
    await mobilePage.waitForTimeout(150);
    const lightButton = mobilePage.locator("#mansion-flashlight-button");
    const lightBox = await lightButton.boundingBox();
    assert(
      await lightButton.isVisible()
        && lightBox
        && lightBox.width >= 44
        && lightBox.height >= 44
        && lightBox.x >= 0
        && lightBox.y >= 0
        && lightBox.x + lightBox.width <= 844
        && lightBox.y + lightBox.height <= 390,
      `phone-landscape Feast Hunt must retain an on-screen touch flashlight: ${JSON.stringify(lightBox)}`,
    );
    await lightButton.tap();
    assert(
      (await mobilePage.evaluate(() => window.MrFeastFresh.getFlashlightState())).on,
      "phone-landscape Feast Hunt must toggle the authoritative flashlight by touch",
    );

    assert(errors.length === 0, `Feast Hunt browser run emitted errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast Feast Hunt browser test: gate, blackout, active Juniper rival, stealth pursuit, foyer return, persistence, catch, and mobile passed");
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
