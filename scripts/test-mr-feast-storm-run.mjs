import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_STORM_RUN_TEST_PORT || (54800 + (process.pid % 9000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-storm-run");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertSourceContract() {
  const [source, html, manifest] = await Promise.all([
    readFile(path.join(root, "assets", "js", "mr-feast-mansion.js"), "utf8"),
    readFile(path.join(root, "games", "mr-feast-mansion.html"), "utf8"),
    readFile(path.join(root, "assets", "models", "mr-feast", "contestants", "manifest.json"), "utf8"),
  ]);
  assert(source.includes("const STORM_RUN_PHASE"), "Storm Run must define an explicit phase enum");
  assert(source.includes("const STORM_RUN"), "Storm Run must keep tuning in a named constant table");
  assert(source.includes("class StormRunSystem"), "Storm Run must use a focused owning system");
  assert(source.includes("stormRun:"), "central state and diagnostics must expose Storm Run");
  assert(source.includes("competitionBlocksInvestigation"), "all competition clue holds must use a shared gate");
  assert(source.includes("noteMajorClueDiscovered"), "new major clues must dispatch through the competition scheduler");
  assert(source.includes("getStormRunState"), "Storm Run diagnostics must have a focused QA hook");
  assert(source.includes("advanceStormRunForQA"), "Storm Run must support deterministic time stepping");
  assert(source.includes("collectStormCheckpointForQA"), "Storm Run checkpoints must use the focused QA contract");
  assert(source.includes("previewStormCheckpointForQA"), "every Storm Run leg needs a focused next-marker visibility QA hook");
  assert(source.includes("previewStormScareForQA"), "each Storm Run apparition needs a focused forward-view composition QA hook");
  assert(source.includes("scareThunderVolumeMultiplier"), "Storm Run must own a louder thunder profile instead of changing ambient lightning globally");
  assert(source.includes("scareThunderCloseStrike"), "Storm Run must own a sharp close-bolt layer instead of relying on an ordinary distant roll");
  assert(source.includes("scareFlashStrengthMultiplier"), "Storm Run apparitions must use a stronger flash than ambient lightning");
  assert(source.includes("scareLightIntensityMultiplier"), "Storm Run apparitions must illuminate the surrounding grounds more strongly than ambient lightning");
  assert(source.includes("scareMaximumLightExposure"), "Storm Run apparitions must be authored in measured dark positions");
  assert(source.includes("placePlayerAtStormScareTriggerForQA"), "authored scare positions need a focused proximity QA hook");
  assert(source.includes("completeStormRunForQA"), "Storm Run outcomes must be deterministic in QA");
  assert(source.includes("suspendThreatsForCompetition"), "a live-event call must suspend an active pursuit or alarm");
  assert(html.includes('id="mansion-storm-run"'), "Storm Run must have a dedicated HUD region");
  assert(html.includes('id="mansion-storm-run-progress"'), "Storm Run HUD must expose checkpoint progress");
  assert(html.includes('id="mansion-storm-run-standings"'), "Storm Run HUD must expose contestant standings");
  const parsedManifest = JSON.parse(manifest);
  for (const id of ["mara-voss", "juniper-cross"]) {
    const spec = parsedManifest.characters.find((entry) => entry.id === id);
    assert(spec?.animations?.run?.file, `${id} must ship a real stationary run clip`);
  }
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
    const ignored = /favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text());
    if (message.type() === "error" && !ignored) errors.push(message.text());
  });
}

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function stormState(page) {
  return page.evaluate(() => window.MrFeastFresh.getStormRunState());
}

async function bootPage(page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
  await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState?.()?.loadStatus === "ready", null, { timeout: 120000 });
  await page.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
  await page.waitForTimeout(180);
}

async function completeFeastSays(page) {
  const result = await page.evaluate(() => window.MrFeastFresh.completeFeastSaysForQA(6));
  assert(result?.survived === true, `Feast Says setup should eliminate Kip: ${JSON.stringify(result)}`);
  const feast = await page.evaluate(() => window.MrFeastFresh.getFeastSaysState());
  assert(feast.phase === "completed" && feast.eliminatedContestantId === "kip-solano", `Feast Says setup failed: ${JSON.stringify(feast)}`);
}

async function callAndStartStorm(page) {
  await completeFeastSays(page);
  const called = await page.evaluate(() => window.MrFeastFresh.callStormRunForQA("qa"));
  assert(called?.started === true, `Storm Run QA call should start once: ${JSON.stringify(called)}`);
  const started = await page.evaluate(() => window.MrFeastFresh.startStormRunForQA());
  assert(started?.started === true, `Storm Run should stage at the rear terrace: ${JSON.stringify(started)}`);
  await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(6));
  await page.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "running", null, { timeout: 8000 });
  return stormState(page);
}

async function collectCheckpoint(page, index) {
  return page.evaluate((checkpointIndex) => window.MrFeastFresh.collectStormCheckpointForQA(checkpointIndex), index);
}

async function previewCheckpoint(page, index) {
  return page.evaluate((checkpointIndex) => window.MrFeastFresh.previewStormCheckpointForQA(checkpointIndex), index);
}

async function assertHudFits(page, mobile = false) {
  const geometry = await page.evaluate(() => {
    const stage = document.getElementById("mansion-stage").getBoundingClientRect();
    const hud = document.getElementById("mansion-storm-run").getBoundingClientRect();
    const sprint = document.getElementById("touch-sprint")?.getBoundingClientRect();
    const interact = document.getElementById("touch-interact")?.getBoundingClientRect();
    const menu = document.getElementById("touch-menu")?.getBoundingClientRect();
    const energyElement = document.getElementById("mansion-energy");
    const energy = energyElement?.getBoundingClientRect();
    const overlaps = (a, b) => Boolean(a && b && a.width && b.width && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    return {
      stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom },
      hud: { left: hud.left, top: hud.top, right: hud.right, bottom: hud.bottom, width: hud.width, height: hud.height },
      sprint: sprint ? { left: sprint.left, top: sprint.top, right: sprint.right, bottom: sprint.bottom, width: sprint.width, height: sprint.height } : null,
      interact: interact ? { left: interact.left, top: interact.top, right: interact.right, bottom: interact.bottom, width: interact.width, height: interact.height } : null,
      menu: menu ? { left: menu.left, top: menu.top, right: menu.right, bottom: menu.bottom, width: menu.width, height: menu.height } : null,
      energy: energy ? { left: energy.left, top: energy.top, right: energy.right, bottom: energy.bottom, width: energy.width, height: energy.height, hidden: energyElement.hidden } : null,
      overlapsSprint: overlaps(hud, sprint),
      overlapsInteract: overlaps(hud, interact),
      overlapsMenu: overlaps(hud, menu),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  assert(geometry.hud.left >= geometry.stage.left - 1 && geometry.hud.right <= geometry.stage.right + 1, `Storm HUD must fit stage width: ${JSON.stringify(geometry)}`);
  assert(geometry.hud.top >= geometry.stage.top - 1 && geometry.hud.bottom <= geometry.stage.bottom + 1, `Storm HUD must fit stage height: ${JSON.stringify(geometry)}`);
  assert(!geometry.overflow, `Storm HUD must not create horizontal overflow: ${JSON.stringify(geometry)}`);
  assert(geometry.energy && !geometry.energy.hidden && geometry.energy.width > 0, `the sprint-energy meter must remain visible during Storm Run: ${JSON.stringify(geometry)}`);
  if (mobile) {
    assert(!geometry.overlapsSprint && !geometry.overlapsInteract && !geometry.overlapsMenu, `Storm HUD must yield to touch controls: ${JSON.stringify(geometry)}`);
    assert(geometry.sprint?.width >= 44 && geometry.sprint?.height >= 44, `Sprint must remain a 44px target during Storm Run: ${JSON.stringify(geometry)}`);
  }
  return geometry;
}

async function run() {
  await assertSourceContract();
  await mkdir(artifactDir, { recursive: true });
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: "ignore",
  });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });

    const timerContext = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const timerPage = await timerContext.newPage();
    const timerErrors = [];
    watchErrors(timerPage, timerErrors);
    await bootPage(timerPage);

    let storm = await stormState(timerPage);
    assert(storm.phase === "dormant" && storm.eligible === false, `Storm Run must wait for Game 1: ${JSON.stringify(storm)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(900));
    storm = await stormState(timerPage);
    assert(storm.intermissionElapsed === 0 && storm.callCount === 0, `pre-Feast time must not count: ${JSON.stringify(storm)}`);

    await completeFeastSays(timerPage);
    storm = await stormState(timerPage);
    assert(storm.eligible === true && storm.intermissionElapsed === 0, `Game 1 completion should open a fresh Storm timer: ${JSON.stringify(storm)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(599.9));
    storm = await stormState(timerPage);
    assert(storm.phase === "dormant" && storm.callCount === 0, `Storm Run must remain dormant at 599.9 seconds: ${JSON.stringify(storm)}`);
    await timerPage.keyboard.press("Escape");
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(5));
    const paused = await stormState(timerPage);
    assert(paused.intermissionElapsed === storm.intermissionElapsed, `Escape menu must pause Storm Run: before=${JSON.stringify(storm)} after=${JSON.stringify(paused)}`);
    await timerPage.keyboard.press("Escape");
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.2));
    storm = await stormState(timerPage);
    assert(storm.phase === "called" && storm.callCount === 1 && storm.triggerReason === "timer", `Storm Run must call once at ten active minutes: ${JSON.stringify(storm)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(30));
    assert((await stormState(timerPage)).callCount === 1, "Storm Run timer must not duplicate its call");

    await timerPage.reload({ waitUntil: "domcontentloaded" });
    await bootPage(timerPage);
    const firstClueCall = await timerPage.evaluate(() => window.MrFeastFresh.triggerFeastSaysClueForQA("book"));
    assert(firstClueCall?.phase === "called", `the setup book should call Feast Says: ${JSON.stringify(firstClueCall)}`);
    await completeFeastSays(timerPage);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(7));
    await timerPage.waitForTimeout(120);
    const dormantLayout = await timerPage.evaluate(() => {
      const caseFile = document.getElementById("mansion-casefile");
      const stormHud = document.getElementById("mansion-storm-run");
      const caseRect = caseFile.getBoundingClientRect();
      const stormRect = stormHud.getBoundingClientRect();
      const overlaps = caseRect.width > 0 && stormRect.width > 0
        && caseRect.left < stormRect.right && caseRect.right > stormRect.left
        && caseRect.top < stormRect.bottom && caseRect.bottom > stormRect.top;
      return {
        caseVisible: !caseFile.hidden,
        stormVisible: !stormHud.hidden,
        stormPhase: stormHud.dataset.phase,
        stormHeight: stormRect.height,
        overlaps,
      };
    });
    assert(!dormantLayout.caseVisible && !dormantLayout.stormVisible && dormantLayout.stormPhase === "dormant", `free investigation must hide trail and next-game countdown HUDs: ${JSON.stringify(dormantLayout)}`);
    await timerPage.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 10.6, y: 0, z: 7.8, yaw: Math.PI / 2 });
      window.MrFeastFresh.teleport("tamperMusicPortrait");
      window.MrFeastFresh.reportInfractionForQA("portrait");
    });
    const pursuitBeforeCall = await diagnostics(timerPage);
    assert(pursuitBeforeCall.mrFeast.pursuit.active?.reason === "witnessed", `the threat-suspension setup must begin a pursuit: ${JSON.stringify(pursuitBeforeCall.mrFeast.pursuit)}`);
    const clueCall = await timerPage.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("shovel"));
    assert(clueCall.phase === "called" && clueCall.triggerReason === "clue", `the next clue should call Storm Run: ${JSON.stringify(clueCall)}`);
    const clueDiagnostics = await diagnostics(timerPage);
    assert(clueDiagnostics.contestant13.shovelTaken === true, "the clue that calls Storm Run must remain earned");
    assert(clueDiagnostics.stormRun.clueProgressLocked === true, "later clue progress must pause during Storm Run");
    assert(clueDiagnostics.mrFeast.pursuit.active === null && clueDiagnostics.mrFeast.security.activeAlarm === null, `the Storm call must suspend pursuit/alarm danger before reporting: ${JSON.stringify({ pursuit: clueDiagnostics.mrFeast.pursuit, security: clueDiagnostics.mrFeast.security })}`);
    const blockedDig = await timerPage.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("dig"));
    assert(blockedDig.quest.digSiteExcavated === false, `the next clue must remain held: ${JSON.stringify(blockedDig)}`);

    await timerPage.evaluate(() => window.MrFeastFresh.teleport("stormRunStaging"));
    await timerPage.waitForTimeout(120);
    const station = await stormState(timerPage);
    const stationDiagnostics = await diagnostics(timerPage);
    assert(station.station.interactive && /report for storm run/i.test(stationDiagnostics.prompt || ""), `called Storm Run must expose a physical rear-terrace report station: ${JSON.stringify({ station: station.station, prompt: stationDiagnostics.prompt })}`);
    await timerPage.keyboard.press("e");
    await timerPage.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "briefing", null, { timeout: 8000 });
    const briefingMoveBefore = (await diagnostics(timerPage)).player;
    await timerPage.keyboard.down("w");
    await timerPage.waitForTimeout(240);
    await timerPage.keyboard.up("w");
    const briefingMoveAfter = (await diagnostics(timerPage)).player;
    assert(Math.hypot(briefingMoveAfter.x - briefingMoveBefore.x, briefingMoveAfter.z - briefingMoveBefore.z) <= 0.03, "briefing must hold the player on the start mark");
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(6));
    storm = await stormState(timerPage);
    assert(storm.phase === "running" && storm.staging.mara && storm.staging.juniper && !storm.staging.kip, `race staging must include only surviving opponents: ${JSON.stringify(storm.staging)}`);
    assert(storm.player.sprintAvailable === true, `normal sprint must remain available during the race: ${JSON.stringify(storm.player)}`);

    const checkpoints = storm.checkpoints;
    const expectedCheckpointOrder = [
      "formal-garden",
      "garden-cross-east",
      "garden-front-turn",
      "garden-front-junction",
      "front-carriage",
      "front-drive",
      "east-front-lawn",
      "maze-promenade",
      "maze-north-entrance",
      "hedge-maze",
      "east-rear-lawn",
      "pool-terrace",
    ];
    assert(checkpoints.length === 12, `Storm Run must use twelve breadcrumb checkpoints: ${JSON.stringify(checkpoints)}`);
    assert(JSON.stringify(checkpoints.map((entry) => entry.id)) === JSON.stringify(expectedCheckpointOrder), `the race must run through the garden and around to the front without returning to the start after checkpoint one: ${JSON.stringify(checkpoints.map((entry) => entry.id))}`);
    assert(checkpoints[1].position.z > checkpoints[0].position.z && checkpoints[2].position.z > checkpoints[1].position.z, `checkpoints two and three must continue forward through the formal garden: ${JSON.stringify(checkpoints.slice(0, 4))}`);
    assert(checkpoints[3].position.x < checkpoints[2].position.x && checkpoints[4].id === "front-carriage" && checkpoints[5].id === "front-drive", `the garden exit must wrap across its north edge onto the front carriage turn before running up the drive: ${JSON.stringify(checkpoints.slice(2, 6))}`);
    assert(new Set(checkpoints.map((entry) => entry.region)).size >= 7, `checkpoints must still span the named yard regions: ${JSON.stringify(checkpoints)}`);
    assert(checkpoints.filter((entry) => entry.insideMaze).length === 1, `exactly one checkpoint must be inside the hedge maze: ${JSON.stringify(checkpoints)}`);
    assert(checkpoints.every((entry) => entry.inYardBounds && entry.walkable), `every checkpoint must be in a walkable yard position: ${JSON.stringify(checkpoints)}`);
    const postFirstGardenSegments = storm.courseRoute?.segments.filter((entry) => entry.index >= 3 && entry.index <= 10) || [];
    assert(storm.courseRoute?.postFirstGardenToFrontClear && postFirstGardenSegments.length === 8 && postFirstGardenSegments.every((entry) => entry.clear), `the route after checkpoint one must physically clear the garden and front-drive colliders for the player capsule: ${JSON.stringify(storm.courseRoute)}`);
    assert(checkpoints.every((entry) => entry.guidance?.visibleFromPrevious), `every next marker must be configured as visible from the previous checkpoint: ${JSON.stringify(checkpoints)}`);
    assert(checkpoints.every((entry) => entry.guidance?.distanceFromPrevious <= 32), `no breadcrumb leg may exceed the readable yard distance: ${JSON.stringify(checkpoints)}`);
    const scareCheckpoints = checkpoints.filter((entry) => entry.scareReveal);
    assert(JSON.stringify(scareCheckpoints.map((entry) => entry.id)) === JSON.stringify(["front-drive", "hedge-maze"]), `Storm Run must use exactly two well-spaced Mr. Feast apparitions: ${JSON.stringify(scareCheckpoints)}`);
    assert(scareCheckpoints.every((entry) => entry.scareReveal.darkSpot), `every apparition must be authored as a measured dark spot: ${JSON.stringify(scareCheckpoints)}`);
    assert(Math.max(...checkpoints.map((entry) => entry.position.x)) - Math.min(...checkpoints.map((entry) => entry.position.x)) >= 35, "Storm checkpoints must span the yard's east/west axis");
    assert(Math.max(...checkpoints.map((entry) => entry.position.z)) - Math.min(...checkpoints.map((entry) => entry.position.z)) >= 35, "Storm checkpoints must span the yard's front/rear axis");
    const outOfOrder = await collectCheckpoint(timerPage, 3);
    assert(outOfOrder.accepted === false && outOfOrder.reason === "out-of-order" && outOfOrder.completed === 0, `out-of-order markers must not advance: ${JSON.stringify(outOfOrder)}`);
    const firstPreview = await previewCheckpoint(timerPage, 0);
    assert(firstPreview?.active && firstPreview.onScreen && firstPreview.guideVisible && firstPreview.alwaysVisible, `checkpoint one must be visible from the start line: ${JSON.stringify(firstPreview)}`);
    const first = await collectCheckpoint(timerPage, 0);
    assert(first.accepted === true && first.completed === 1, `checkpoint one should advance exactly once: ${JSON.stringify(first)}`);
    const duplicate = await collectCheckpoint(timerPage, 0);
    assert(duplicate.accepted === false && duplicate.completed === 1, `re-crossing a marker must not double count: ${JSON.stringify(duplicate)}`);
    const standingsAfterFirst = await timerPage.locator("#mansion-storm-run-standings").textContent();
    assert(/YOU\s+1.*JUNIPER\s+\d+.*MARA\s+\d+/i.test(standingsAfterFirst || ""), `standings must report checkpoint progress instead of a hard-coded order: ${JSON.stringify(standingsAfterFirst)}`);

    const runnerBefore = await stormState(timerPage);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(1.25));
    const runnerAfter = await stormState(timerPage);
    for (const id of ["mara-voss", "juniper-cross"]) {
      const before = runnerBefore.contestants.find((entry) => entry.id === id);
      const after = runnerAfter.contestants.find((entry) => entry.id === id);
      assert(after.activity === "running" && after.animation.name === "run", `${id} must use a real run animation: ${JSON.stringify(after)}`);
      assert(after.animation.poseChanged && after.animation.playbackRate > 0, `${id} run pose must visibly animate: ${JSON.stringify(after.animation)}`);
      assert(after.distanceTravelled > before.distanceTravelled, `${id} must move continuously along the course`);
      assert(after.configuredSpeed <= 2.5, `${id} must use the stamina-fair tuned speed: ${JSON.stringify(after)}`);
      assert(after.maximumObservedSpeed <= after.configuredSpeed + 0.001, `${id} may not exceed its tuned race speed: ${JSON.stringify(after)}`);
      assert(after.maximumObservedSpeed <= storm.player.maximumSprintSpeed + 0.001, `${id} may not outrun the player's maximum: ${JSON.stringify(after)}`);
      assert(after.teleports === 0, `${id} must not teleport between visible race points: ${JSON.stringify(after)}`);
    }

    const frontDriveIndex = checkpoints.findIndex((entry) => entry.id === "front-drive");
    const mazeIndex = checkpoints.findIndex((entry) => entry.id === "hedge-maze");
    assert(frontDriveIndex === 5 && mazeIndex === 9, `the two scare checkpoints must bracket the middle of the clockwise course: ${JSON.stringify({ frontDriveIndex, mazeIndex })}`);
    for (let index = 1; index < frontDriveIndex; index += 1) {
      const preview = await previewCheckpoint(timerPage, index);
      assert(preview?.active && preview.onScreen && preview.guideVisible && preview.alwaysVisible, `checkpoint ${index + 1} must be visible from checkpoint ${index}: ${JSON.stringify(preview)}`);
      const collected = await collectCheckpoint(timerPage, index);
      assert(collected.accepted === true && collected.completed === index + 1, `breadcrumb checkpoint ${index + 1} must advance in order: ${JSON.stringify(collected)}`);
    }
    const frontPreview = await previewCheckpoint(timerPage, frontDriveIndex);
    assert(frontPreview?.active && frontPreview.onScreen && frontPreview.guideVisible && frontPreview.alwaysVisible, `front-drive marker must be visible from the carriage-turn marker: ${JSON.stringify(frontPreview)}`);
    const frontScareComposition = await timerPage.evaluate((index) => window.MrFeastFresh.previewStormScareForQA(index), frontDriveIndex);
    assert(frontScareComposition?.onScreen && frontScareComposition.lineOfSight && Math.abs(frontScareComposition.projected.x) <= 0.18, `the front-drive apparition must sit unobstructed near the center of the player's natural incoming view: ${JSON.stringify(frontScareComposition)}`);
    assert(frontScareComposition.distance >= 4 && frontScareComposition.distance <= 14 && frontScareComposition.projectedHeight >= 0.12, `the front-drive apparition must be large enough to read immediately without touching the player: ${JSON.stringify(frontScareComposition)}`);
    const scareBefore = await stormState(timerPage);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    const scareVisible = await stormState(timerPage);
    assert(scareVisible.scare.triggeredCheckpointIds.includes("front-drive"), `the natural front-drive approach must trigger lightning automatically: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.hostVisible && scareVisible.scare.lightning > 0, `Mr. Feast must appear only with the flash: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.lightning >= 1.15 && scareVisible.scare.lightIntensityMultiplier >= 1.4, `the close bolt must light enough of the surrounding grounds to make Mr. Feast unmistakable: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.profile === "storm-run" && scareVisible.scare.flashDecayPerSecond < scareVisible.scare.normalFlashDecayPerSecond, `the race scare flash must last slightly longer than ambient lightning: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.flashStrengthMultiplier >= 1.1, `the apparition flash must be visibly stronger than ambient lightning: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.thunderVolumeMultiplier >= 1.6 && scareVisible.scare.thunderDelaySeconds <= 0.05 && scareVisible.scare.thunderCloseStrike, `the race scare must use a loud, immediate close-bolt crack: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.baselineLightExposure <= scareVisible.scare.maximumLightExposure, `Mr. Feast must wait in a very dark front-drive position: ${JSON.stringify(scareVisible.scare)}`);
    const frontThunder = await timerPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA().thunder);
    assert(frontThunder.lastProfile === "storm-run" && frontThunder.lastVolumeMultiplier >= 1.6 && frontThunder.lastCloseStrike, `the audio system must receive the close Storm Run thunder mix: ${JSON.stringify(frontThunder)}`);
    assert(scareVisible.hazard.enabled === false && scareVisible.hazard.penaltySeconds === 0, `lightning must not be a hazard: ${JSON.stringify(scareVisible.hazard)}`);
    assert(scareVisible.raceElapsed >= scareBefore.raceElapsed, "the scare must not subtract race time or checkpoint progress");
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.8));
    const scareHeld = await stormState(timerPage);
    assert(scareHeld.scare.hostVisible && scareHeld.scare.lightning > 0, `the authored flash must hold Mr. Feast long enough to be unmistakable while still brief: ${JSON.stringify(scareHeld.scare)}`);
    await timerPage.screenshot({ path: path.join(artifactDir, "mr-feast-dark-lightning-reveal-desktop.png") });
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.42));
    const scareGone = await stormState(timerPage);
    assert(scareGone.scare.hostVisible === false && scareGone.scare.lightning === 0, `Mr. Feast must disappear exactly when the close bolt falls back to darkness: ${JSON.stringify(scareGone.scare)}`);
    await timerPage.screenshot({ path: path.join(artifactDir, "mr-feast-front-dark-after-reveal-desktop.png") });
    const frontDrive = await collectCheckpoint(timerPage, frontDriveIndex);
    assert(frontDrive.accepted === true && frontDrive.completed === frontDriveIndex + 1, `front-drive checkpoint should open the maze approach: ${JSON.stringify(frontDrive)}`);
    for (let index = frontDriveIndex + 1; index < mazeIndex; index += 1) {
      const preview = await previewCheckpoint(timerPage, index);
      assert(preview?.active && preview.onScreen && preview.guideVisible && preview.alwaysVisible, `checkpoint ${index + 1} must be visible from checkpoint ${index}: ${JSON.stringify(preview)}`);
      if (index === frontDriveIndex + 1) {
        await timerPage.screenshot({ path: path.join(artifactDir, "storm-run-visible-checkpoint-chain-desktop.png") });
      }
      const collected = await collectCheckpoint(timerPage, index);
      assert(collected.accepted === true && collected.completed === index + 1, `maze-approach checkpoint ${index + 1} must advance in order: ${JSON.stringify(collected)}`);
    }
    const mazePreview = await previewCheckpoint(timerPage, mazeIndex);
    assert(mazePreview?.active && mazePreview.onScreen && mazePreview.guideVisible && mazePreview.alwaysVisible, `hedge-maze marker must remain visible from its entrance: ${JSON.stringify(mazePreview)}`);
    const mazeScareComposition = await timerPage.evaluate((index) => window.MrFeastFresh.previewStormScareForQA(index), mazeIndex);
    assert(mazeScareComposition?.onScreen && mazeScareComposition.lineOfSight && Math.abs(mazeScareComposition.projected.x) <= 0.18, `the maze apparition must fill the player's unobstructed natural corridor view: ${JSON.stringify(mazeScareComposition)}`);
    assert(mazeScareComposition.distance >= 3 && mazeScareComposition.distance <= 9 && mazeScareComposition.projectedHeight >= 0.2, `the maze apparition must be large enough to read immediately: ${JSON.stringify(mazeScareComposition)}`);
    await timerPage.evaluate((index) => window.MrFeastFresh.placePlayerBeforeStormCheckpointForQA(index, 4), mazeIndex);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    const mazeBlockedApproach = await stormState(timerPage);
    assert(!mazeBlockedApproach.scare.triggeredCheckpointIds.includes("hedge-maze"), `maze walls must not consume the one-shot reveal from an adjacent corridor: ${JSON.stringify(mazeBlockedApproach.scare)}`);
    await timerPage.evaluate((index) => window.MrFeastFresh.placePlayerAtStormScareTriggerForQA(index), mazeIndex);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    const mazeVisibleApproach = await stormState(timerPage);
    assert(mazeVisibleApproach.scare.triggeredCheckpointIds.includes("hedge-maze") && mazeVisibleApproach.scare.hostVisible, `entering the authored maze corridor must reveal Mr. Feast: ${JSON.stringify(mazeVisibleApproach.scare)}`);
    assert(mazeVisibleApproach.scare.baselineLightExposure <= mazeVisibleApproach.scare.maximumLightExposure, `the hedge-maze apparition must begin in deep shadow: ${JSON.stringify(mazeVisibleApproach.scare)}`);
    await timerPage.screenshot({ path: path.join(artifactDir, "mr-feast-maze-lightning-reveal-desktop.png") });
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(1.25));
    const mazeScareGone = await stormState(timerPage);
    assert(!mazeScareGone.scare.hostVisible && mazeScareGone.scare.lightning === 0, `the maze apparition must vanish with the close bolt: ${JSON.stringify(mazeScareGone.scare)}`);
    await timerPage.screenshot({ path: path.join(artifactDir, "mr-feast-maze-dark-after-reveal-desktop.png") });
    const mazeCollected = await collectCheckpoint(timerPage, mazeIndex);
    assert(mazeCollected.accepted === true && mazeCollected.completed === mazeIndex + 1, `hedge-maze checkpoint must advance in order: ${JSON.stringify(mazeCollected)}`);
    for (let index = mazeIndex + 1; index < checkpoints.length; index += 1) {
      const preview = await previewCheckpoint(timerPage, index);
      assert(preview?.active && preview.onScreen && preview.guideVisible && preview.alwaysVisible, `checkpoint ${index + 1} must be visible from checkpoint ${index}: ${JSON.stringify(preview)}`);
      const collected = await collectCheckpoint(timerPage, index);
      assert(collected.accepted === true && collected.completed === index + 1, `closing checkpoint ${index + 1} must advance in order: ${JSON.stringify(collected)}`);
      if (index === checkpoints.length - 1) assert(collected.survived === true, `the final checkpoint must complete the race: ${JSON.stringify(collected)}`);
    }
    assert(JSON.stringify((await stormState(timerPage)).scare.triggeredCheckpointIds) === JSON.stringify(["front-drive", "hedge-maze"]), "the complete race must contain exactly the two authored apparitions");
    await assertHudFits(timerPage, false);
    const timerWin = await timerPage.evaluate(() => window.MrFeastFresh.completeStormRunForQA("player"));
    assert(timerWin.survived === true, `the HUD integration page should finish cleanly: ${JSON.stringify(timerWin)}`);
    const resultLayout = await timerPage.evaluate(() => ({
      caseHidden: document.getElementById("mansion-casefile").hidden,
      stormHidden: document.getElementById("mansion-storm-run").hidden,
      stormPhase: document.getElementById("mansion-storm-run").dataset.phase,
    }));
    assert(resultLayout.caseHidden && !resultLayout.stormHidden && resultLayout.stormPhase === "completed", `the result card must show without a trail/objective card: ${JSON.stringify(resultLayout)}`);
    assert(timerErrors.length === 0, `timer/clue/race page produced console errors: ${JSON.stringify(timerErrors)}`);
    await timerContext.close();

    const winContext = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const winPage = await winContext.newPage();
    const winErrors = [];
    watchErrors(winPage, winErrors);
    await bootPage(winPage);
    await callAndStartStorm(winPage);
    assert(await winPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving during Storm Run should succeed");
    assert(await winPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading a live Storm Run save should succeed");
    let restored = await stormState(winPage);
    assert(restored.phase === "called" && restored.completedCheckpoints === 0 && restored.raceElapsed === 0 && !restored.scare.hostVisible, `live saves must normalize to a clean call: ${JSON.stringify(restored)}`);
    await winPage.evaluate(() => window.MrFeastFresh.startStormRunForQA());
    await winPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(6));
    const won = await winPage.evaluate(() => window.MrFeastFresh.completeStormRunForQA("player"));
    assert(won.survived === true && won.eliminatedContestantId === "mara-voss", `player victory must eliminate Mara: ${JSON.stringify(won)}`);
    const wonState = await stormState(winPage);
    assert(wonState.phase === "completed" && !wonState.clueProgressLocked, `winning must reopen investigation: ${JSON.stringify(wonState)}`);
    const castAfterWin = await winPage.evaluate(() => window.MrFeastFresh.getContestantState());
    const maraAfterWin = castAfterWin.entries.find((entry) => entry.id === "mara-voss");
    const juniperAfterWin = castAfterWin.entries.find((entry) => entry.id === "juniper-cross");
    assert(maraAfterWin.eliminated && !maraAfterWin.visible && !maraAfterWin.colliderEnabled && !maraAfterWin.interactionRegistered, `Mara must leave every gameplay surface: ${JSON.stringify(maraAfterWin)}`);
    assert(!juniperAfterWin.eliminated && juniperAfterWin.visible, `Juniper must survive Game 2: ${JSON.stringify(juniperAfterWin)}`);
    assert(await winPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "completed Storm Run should save");
    assert(await winPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "completed Storm Run should load");
    restored = await stormState(winPage);
    assert(restored.phase === "completed" && restored.eliminatedContestantId === "mara-voss", `Mara elimination must persist: ${JSON.stringify(restored)}`);
    assert(winErrors.length === 0, `win page produced console errors: ${JSON.stringify(winErrors)}`);
    await winContext.close();

    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phonePage = await phoneContext.newPage();
    const phoneErrors = [];
    watchErrors(phonePage, phoneErrors);
    await bootPage(phonePage);
    const phoneFeastCall = await phonePage.evaluate(() => window.MrFeastFresh.triggerFeastSaysClueForQA("book"));
    assert(phoneFeastCall?.phase === "called", `the phone setup book should call Feast Says: ${JSON.stringify(phoneFeastCall)}`);
    await completeFeastSays(phonePage);
    await phonePage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(7));
    await phonePage.waitForTimeout(120);
    const phoneDormantLayout = await phonePage.evaluate(() => {
      const caseFile = document.getElementById("mansion-casefile");
      const stormHud = document.getElementById("mansion-storm-run");
      const caseRect = caseFile.getBoundingClientRect();
      const stormRect = stormHud.getBoundingClientRect();
      return {
        caseVisible: !caseFile.hidden,
        stormVisible: !stormHud.hidden,
        stormHeight: stormRect.height,
        overlaps: caseRect.left < stormRect.right && caseRect.right > stormRect.left
          && caseRect.top < stormRect.bottom && caseRect.bottom > stormRect.top,
      };
    });
    assert(!phoneDormantLayout.caseVisible && !phoneDormantLayout.stormVisible, `phone free investigation must hide trail and next-game countdown HUDs: ${JSON.stringify(phoneDormantLayout)}`);
    const phoneCalled = await phonePage.evaluate(() => window.MrFeastFresh.callStormRunForQA("qa"));
    assert(phoneCalled?.started === true, `the phone Storm Run call should start: ${JSON.stringify(phoneCalled)}`);
    const phoneStarted = await phonePage.evaluate(() => window.MrFeastFresh.startStormRunForQA());
    assert(phoneStarted?.started === true, `the phone Storm Run should stage: ${JSON.stringify(phoneStarted)}`);
    await phonePage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(6));
    await phonePage.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "running", null, { timeout: 8000 });
    await assertHudFits(phonePage, true);
    await phonePage.screenshot({ path: path.join(artifactDir, "storm-run-mobile.png") });
    const lost = await phonePage.evaluate(() => window.MrFeastFresh.completeStormRunForQA("mara"));
    assert(lost.survived === false && lost.eliminatedContestantId === "player", `Mara finishing first must eliminate the player: ${JSON.stringify(lost)}`);
    const lossDiagnostics = await diagnostics(phonePage);
    assert(lossDiagnostics.gameOver?.kind === "storm-run" && lossDiagnostics.gameOver?.reason === "storm-run-eliminated", `Storm Run loss must use the recoverable game-over path: ${JSON.stringify(lossDiagnostics.gameOver)}`);
    const modal = await phonePage.locator("#mansion-gameover").innerText();
    assert(/eliminated/i.test(modal) && /storm run|mara/i.test(modal), `loss modal must explain the Storm Run result: ${JSON.stringify(modal)}`);
    assert(phoneErrors.length === 0, `phone/loss page produced console errors: ${JSON.stringify(phoneErrors)}`);
    await phoneContext.close();
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

run()
  .then(() => console.log("Mr. Feast Storm Run event checks passed."))
  .catch((error) => {
    console.error(`Mr. Feast Storm Run event checks failed: ${error.message}`);
    process.exitCode = 1;
  });
