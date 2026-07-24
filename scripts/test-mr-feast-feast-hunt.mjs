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

function angularDelta(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
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

async function feastHuntBriefingFacing(page) {
  return page.evaluate(() => {
    const game = JSON.parse(window.render_game_to_text());
    const host = window.MrFeastFresh.getMrFeastState();
    const dx = game.player.x - host.position.x;
    const dz = game.player.z - host.position.z;
    const distance = Math.hypot(dx, dz);
    const hostForwardDot = distance > 0.0001
      ? (Math.sin(host.yaw) * dx + Math.cos(host.yaw) * dz) / distance
      : 1;
    const playerToHostX = -dx;
    const playerToHostZ = -dz;
    const playerForwardDot = distance > 0.0001
      ? ((-Math.sin(game.player.yaw)) * playerToHostX + (-Math.cos(game.player.yaw)) * playerToHostZ) / distance
      : 1;
    return {
      distance,
      hostForwardDot,
      playerForwardDot,
      hostYaw: host.yaw,
      playerYaw: game.player.yaw,
      hostPosition: host.position,
      playerPosition: game.player,
    };
  });
}

async function prepareCalledHunt(page) {
  return page.evaluate(() => {
    window.MrFeastFresh.setFeastHuntGateForQA({ stormCompleted: true, relaySabotaged: true });
    return window.MrFeastFresh.callFeastHuntForQA("gate");
  });
}

async function beginHunt(page, { verifyBriefingFacing = false } = {}) {
  const called = await prepareCalledHunt(page);
  assert(called?.started, `Feast Hunt should call after both gates: ${JSON.stringify(called)}`);
  const started = await page.evaluate(() => window.MrFeastFresh.startFeastHuntForQA());
  assert(started?.started, `Feast Hunt should stage the foyer briefing: ${JSON.stringify(started)}`);
  if (verifyBriefingFacing) {
    let facing = await feastHuntBriefingFacing(page);
    assert(
      facing.distance >= 2
        && facing.hostForwardDot >= 0.96
        && facing.playerForwardDot >= 0.96,
      `Mr. Feast must face the held player while explaining Game 3: ${JSON.stringify(facing)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(0.75));
    facing = await feastHuntBriefingFacing(page);
    assert(
      facing.hostForwardDot >= 0.96 && facing.playerForwardDot >= 0.96,
      `Mr. Feast must retain the face-to-face Game 3 pose throughout the explanation: ${JSON.stringify(facing)}`,
    );
    await page.screenshot({ path: path.join(artifactDir, "feast-hunt-briefing-facing-player.png") });
  }
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
  assert(
    /id:\s*"golden-carving-knife"[\s\S]{0,260}?level:\s*"main-level"[\s\S]{0,160}?room:\s*"KITCHEN"/.test(runtime),
    "the player carving knife must be relocated from the basement to the Kitchen",
  );
  assert(
    /golden-carving-knife-blade/.test(runtime)
      && /golden-carving-knife-bolster/.test(runtime)
      && /golden-carving-knife-rivet/.test(runtime),
    "the smaller carving knife needs a pointed blade, bolster, handle, and rivets",
  );
  assert(
    /visualScale:/.test(runtime) && /hidingContext:/.test(runtime) && /interactionSize:/.test(runtime),
    "Feast Hunt props need authored smaller scales, dressed hiding contexts, and tighter interaction volumes",
  );
  assert(/allowsSecuritySystems/.test(runtime), "Feast Hunt must distinguish clue hold from active camera/security ownership");
  assert(/feast-hunt-eliminated/.test(runtime) && /feast-hunt-no-show/.test(runtime) && /feast-hunt-juniper-won/.test(runtime), "Feast Hunt catch, no-show, and rival-win losses need explicit recoverable outcomes");
  assert(/getFeastHuntState/.test(runtime) && /advanceFeastHuntForQA/.test(runtime), "focused Feast Hunt diagnostics and deterministic clock are missing");
  assert(/briefingHostMark/.test(runtime) && /stageHostForBriefing/.test(runtime), "Feast Hunt must own a face-to-face host pose throughout the Game 3 explanation");
  assert(/collectFeastHuntItemForQA/.test(runtime) && /placePlayerNearFeastHuntItemForQA/.test(runtime), "Feast Hunt item QA controls are missing");
  assert(/placePlayerAtFeastHuntReturnForQA/.test(runtime), "Feast Hunt needs a real foyer return QA control");
  assert(/startFeastHuntRace/.test(runtime) && /updateFeastHuntEntry/.test(runtime), "Juniper needs an authored active Feast Hunt route");
  assert(/rivalPendingItemId/.test(runtime) && /searchPauseSeconds:\s*(?:[3-9]\d|[1-9]\d{2,})/.test(runtime), "Juniper needs a substantial pre-find search delay");
  assert(/returnedIds:\s*\[\]/.test(runtime) && /carriedItemId:\s*null/.test(runtime), "Feast Hunt must track individual foyer hand-ins and one carried item");
  assert(/stageThree:/.test(runtime) && /colliderBody/.test(runtime), "the foyer statues need a dramatic third relocation with aligned physical colliders");
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
    hunt = await beginHunt(playPage, { verifyBriefingFacing: true });
    assert(
      hunt.briefing.countdownSequence.join(",") === "3,2,1,0"
        && hunt.briefing.rulesLine.includes("three")
        && hunt.briefing.rulesLine.toLowerCase().includes("caught"),
      `Feast Hunt needs a complete spoken countdown and explicit rules: ${JSON.stringify(hunt.briefing)}`,
    );
    assert(hunt.items.length === 3 && hunt.items.every((item) => item.visible && item.registered), `all three props should appear at release: ${JSON.stringify(hunt.items)}`);
    assert(
      hunt.items.every((item) => item.level !== "basement-level")
        && new Set(hunt.items.map((item) => item.level)).size === 2,
      `the player's props should remain above grade after relocating the knife: ${JSON.stringify(hunt.items)}`,
    );
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
    assert(
      hunt.readyToReturn
        && hunt.carriedItemId === "golden-bell"
        && hunt.returnedCount === 0
        && hunt.returnStation.visible
        && hunt.returnStation.registered
        && /return.*golden bell/i.test(hunt.ui.status),
      `the Bell must be carried back before another object can be taken: ${JSON.stringify(hunt)}`,
    );
    const blockedGoblet = await playPage.evaluate(() => window.MrFeastFresh.collectFeastHuntItemForQA("golden-goblet"));
    assert(
      !blockedGoblet.accepted
        && blockedGoblet.reason === "return-current-first"
        && blockedGoblet.carriedItemId === "golden-bell",
      `a second pickup must be blocked until the Bell is handed in: ${JSON.stringify(blockedGoblet)}`,
    );
    await playPage.evaluate(() => window.MrFeastFresh.placePlayerAtFeastHuntReturnForQA());
    await playPage.waitForFunction(() => /return|place/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 10000 });
    await playPage.keyboard.press("e");
    await playPage.waitForFunction(() => window.MrFeastFresh.getFeastHuntState()?.returnedCount === 1);
    hunt = await huntState(playPage);
    assert(
      hunt.phase === "hunting"
        && hunt.returnedIds.join(",") === "golden-bell"
        && hunt.carriedItemId === null
        && !hunt.readyToReturn
        && !hunt.returnStation.visible
        && !hunt.returnStation.registered
        && /find/i.test(hunt.ui.status),
      `the first foyer hand-in should reopen the hunt without completing it: ${JSON.stringify(hunt)}`,
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
        && hunt.returnedIds.join(",") === "golden-bell"
        && hunt.carriedItemId === null
        && !hunt.readyToReturn
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

    // --- Juniper searches deliberately, then can still return and win --------
    const rivalPage = await bootPage(browser, { width: 1280, height: 820 }, errors);
    await beginHunt(rivalPage);
    await rivalPage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(20));
    let rivalHunt = await huntState(rivalPage);
    assert(
      rivalHunt.phase === "hunting"
        && rivalHunt.rival.collectedCount === 0
        && rivalHunt.rival.active
        && rivalHunt.rival.distanceTravelled > 20,
      `Juniper should still be traveling toward the first hiding place at 20 seconds: ${JSON.stringify(rivalHunt.rival)}`,
    );
    await rivalPage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(10));
    rivalHunt = await huntState(rivalPage);
    assert(
      rivalHunt.rival.collectedCount === 0
        && rivalHunt.rival.pendingItemId === "golden-bell"
        && rivalHunt.rival.pauseRemaining > 0,
      `Juniper should spend real time searching after reaching the first object: ${JSON.stringify(rivalHunt.rival)}`,
    );
    await rivalPage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(210));
    diagnostics = await rivalPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert(
      !diagnostics.gameOver
        && diagnostics.feastHunt.phase === "hunting"
        && !diagnostics.feastHunt.rival.returned,
      `Juniper should take substantially longer than the former 240-second finish: ${JSON.stringify(diagnostics.feastHunt.rival)}`,
    );
    await rivalPage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(180));
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

    // --- Every item must be individually returned to the foyer ----------------
    const winPage = await bootPage(browser, { width: 1280, height: 820 }, errors);
    await beginHunt(winPage);
    hunt = await huntState(winPage);
    const hiddenBell = hunt.items.find((entry) => entry.id === "golden-bell");
    const hiddenGoblet = hunt.items.find((entry) => entry.id === "golden-goblet");
    const kitchenKnife = hunt.items.find((entry) => entry.id === "golden-carving-knife");
    assert(
      hiddenBell?.hidingContext === "dining-sideboard-back-corner"
        && hiddenBell.position.x <= -13.5
        && hiddenBell.position.z <= -11
        && hiddenBell.visualSize.y <= 0.35
        && hiddenBell.interactionSize <= 0.62,
      `the smaller bell should be tucked into the Dining Room sideboard dressing: ${JSON.stringify(hiddenBell)}`,
    );
    assert(
      hiddenGoblet?.hidingContext === "reading-room-low-bookcase"
        && hiddenGoblet.position.x >= 14
        && hiddenGoblet.position.z >= 2.4
        && hiddenGoblet.position.y <= 5.4
        && hiddenGoblet.visualSize.y <= 0.31
        && hiddenGoblet.interactionSize <= 0.62,
      `the smaller goblet should be tucked onto a low Reading Room bookcase shelf: ${JSON.stringify(hiddenGoblet)}`,
    );
    assert(
      kitchenKnife?.level === "main-level"
        && kitchenKnife.room === "KITCHEN"
        && kitchenKnife.hidingContext === "kitchen-bread-board"
        && kitchenKnife.position.x >= 6.3
        && kitchenKnife.position.x <= 6.8
        && kitchenKnife.position.z <= -11.2
        && kitchenKnife.position.y >= 0.95
        && kitchenKnife.position.y <= 1.1
        && Math.max(kitchenKnife.visualSize.x, kitchenKnife.visualSize.z) <= 0.31
        && Math.max(kitchenKnife.visualSize.x, kitchenKnife.visualSize.z)
          >= Math.min(kitchenKnife.visualSize.x, kitchenKnife.visualSize.z) * 4
        && kitchenKnife.interactionSize <= 0.62,
      `the smaller carving knife should remain recognizable while partly hidden on the Kitchen bread board: ${JSON.stringify(kitchenKnife)}`,
    );
    const itemIds = ["golden-bell", "golden-goblet", "golden-carving-knife"];
    const statueDeltas = [];
    const statuePositionDeltas = [];
    for (let index = 0; index < itemIds.length; index += 1) {
      const id = itemIds[index];
      const itemStaging = await winPage.evaluate(
        (itemId) => window.MrFeastFresh.placePlayerNearFeastHuntItemForQA(itemId),
        id,
      );
      assert(itemStaging?.itemId === id, `QA should stage the player outside the foyer for ${id}: ${JSON.stringify(itemStaging)}`);
      await winPage.waitForFunction(
        (label) => (JSON.parse(window.render_game_to_text()).prompt || "").toLowerCase().includes(label),
        id.replace(/^golden-/, "").replaceAll("-", " "),
        { timeout: 10000 },
      );
      await winPage.locator("#mansion-stage").screenshot({
        path: path.join(artifactDir, `feast-hunt-hidden-${id}.png`),
      });
      if (id === "golden-carving-knife") {
        await winPage.screenshot({ path: path.join(artifactDir, "feast-hunt-kitchen-knife.png") });
      }
      const result = await winPage.evaluate((itemId) => window.MrFeastFresh.collectFeastHuntItemForQA(itemId), id);
      assert(result?.accepted, `QA should collect ${id}: ${JSON.stringify(result)}`);
      hunt = await huntState(winPage);
      assert(
        hunt.phase === "hunting"
          && hunt.collectedCount === index + 1
          && hunt.returnedCount === index
          && hunt.carriedItemId === id
          && hunt.readyToReturn
          && hunt.returnStation.visible
          && hunt.returnStation.registered,
        `pickup ${index + 1} must require its own foyer return: ${JSON.stringify(hunt)}`,
      );
      const deltas = hunt.statues.entries.map((entry) => angularDelta(entry.rotationY, entry.baseRotationY));
      const positionDeltas = hunt.statues.entries.map((entry) => entry.positionDelta);
      statueDeltas.push(deltas);
      statuePositionDeltas.push(positionDeltas);
      assert(
        hunt.statues.stage === index + 1
          && hunt.statues.entries.every((entry) => entry.rotationChanged && entry.colliderAligned),
        `pickup ${index + 1} should advance the physical statues to stage ${index + 1}: ${JSON.stringify(hunt.statues)}`,
      );
      if (index === 0) {
        assert(deltas.every((delta) => delta >= 0.12 && delta <= 0.32), `stage one should be slight: ${JSON.stringify(deltas)}`);
        assert(positionDeltas.every((delta) => delta <= 0.01), `stage one should turn without relocating: ${JSON.stringify(positionDeltas)}`);
      } else if (index === 1) {
        assert(
          positionDeltas.every((delta) => delta >= 0.2 && delta <= 0.45),
          `stage two should shift each statue slightly: ${JSON.stringify(positionDeltas)}`,
        );
        assert(
          deltas.every((delta, entryIndex) => delta >= statueDeltas[index - 1][entryIndex] * 1.55),
          `statue rotation should escalate strongly at stage ${index + 1}: ${JSON.stringify(statueDeltas)}`,
        );
      } else {
        assert(
          deltas.every((delta, entryIndex) => delta >= statueDeltas[index - 1][entryIndex] * 1.55),
          `statue rotation should escalate strongly at stage ${index + 1}: ${JSON.stringify(statueDeltas)}`,
        );
        assert(
          positionDeltas.every((delta, entryIndex) => (
            delta >= 2
            && delta >= statuePositionDeltas[index - 1][entryIndex] * 5
          )),
          `stage three should relocate each statue drastically: ${JSON.stringify(statuePositionDeltas)}`,
        );
      }

      const returnStaging = await winPage.evaluate(() => window.MrFeastFresh.placePlayerAtFeastHuntReturnForQA());
      assert(
        returnStaging?.readyToReturn && returnStaging.carriedItemId === id,
        `QA must stage the player for the ${id} hand-in: ${JSON.stringify(returnStaging)}`,
      );
      await winPage.waitForFunction(() => /return|place/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 10000 });
      await winPage.screenshot({ path: path.join(artifactDir, `feast-hunt-statues-stage-${index + 1}.png`) });
      await winPage.keyboard.press("e");
      if (index < itemIds.length - 1) {
        await winPage.waitForFunction((count) => {
          const state = window.MrFeastFresh.getFeastHuntState();
          return state?.returnedCount === count && !state.readyToReturn;
        }, index + 1);
        hunt = await huntState(winPage);
        assert(
          hunt.phase === "hunting"
            && hunt.returnedCount === index + 1
            && hunt.carriedItemId === null
            && !hunt.returnStation.visible
            && !hunt.returnStation.registered,
          `hand-in ${index + 1} should resume the hunt: ${JSON.stringify(hunt)}`,
        );
      }
    }
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
