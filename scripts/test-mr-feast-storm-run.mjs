import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_STORM_RUN_TEST_PORT || (54800 + (process.pid % 9000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-storm-run");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function angleDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

async function assertSourceContract() {
  const [source, html, manifest] = await Promise.all([
    readFile(path.join(root, "assets", "js", "mr-feast-mansion.js"), "utf8"),
    readFile(path.join(root, "games", "mr-feast-mansion.html"), "utf8"),
    readFile(path.join(root, "assets", "models", "mr-feast", "contestants", "manifest.json"), "utf8"),
  ]);
  assert(source.includes("const STORM_RUN_PHASE"), "Storm Run must define an explicit phase enum");
  assert(source.includes("const STORM_RUN"), "Storm Run must keep tuning in a named constant table");
  assert(source.includes('instructionDelivery: "visual-checkpoints"'), "Storm Run must declare its glowing checkpoints as the authoritative direction channel");
  assert(!source.includes("checkpointCallout"), "Storm Run must not retain a spoken checkpoint-announcement path");
  assert(source.includes("storm-run-countdown-"), "Mr. Feast must verbally call the Storm Run countdown steps");
  assert(source.includes("class StormRunSystem"), "Storm Run must use a focused owning system");
  assert(source.includes("stormRun:"), "central state and diagnostics must expose Storm Run");
  assert(source.includes("competitionBlocksInvestigation"), "all competition clue holds must use a shared gate");
  assert(source.includes("noteMajorClueDiscovered"), "new major clues must dispatch through the competition scheduler");
  assert(source.includes("getStormRunState"), "Storm Run diagnostics must have a focused QA hook");
  assert(source.includes("advanceStormRunForQA"), "Storm Run must support deterministic time stepping");
  assert(source.includes("collectStormCheckpointForQA"), "Storm Run checkpoints must use the focused QA contract");
  assert(source.includes("previewStormCheckpointForQA"), "every Storm Run leg needs a focused next-marker visibility QA hook");
  assert(source.includes("previewStormScareForQA"), "each Storm Run apparition needs a focused forward-view composition QA hook");
  assert(source.includes("placePlayerAlongStormLegForQA"), "the front-tree scare needs a QA path that follows the real checkpoint leg instead of teleporting into a tiny trigger");
  assert(source.includes("previewStormMazeNorthForQA"), "the phone-dark north maze route needs a focused lighting QA view");
  assert(source.includes("MAZE_NORTH_VISIBILITY"), "north-maze readability tuning must live in one named constant table");
  assert(source.includes("scareThunderVolumeMultiplier"), "Storm Run must own a louder thunder profile instead of changing ambient lightning globally");
  assert(source.includes("scareThunderCloseStrike"), "Storm Run must own a sharp close-bolt layer instead of relying on an ordinary distant roll");
  assert(source.includes("scareFlashStrengthMultiplier"), "Storm Run apparitions must use a stronger flash than ambient lightning");
  assert(source.includes("scareLightIntensityMultiplier"), "Storm Run apparitions must illuminate the surrounding grounds more strongly than ambient lightning");
  assert(source.includes("scareMaximumLightExposure"), "Storm Run apparitions must be authored in measured dark positions");
  assert(source.includes("briefingMark"), "Storm Run must distinguish the rear-door briefing view from the race-facing start orientation");
  assert(source.includes("stormCountdown"), "Storm Run must own an audible three-two-one countdown cue");
  assert(source.includes("stormCheckpoint"), "Storm Run checkpoints must use a dedicated audible progress cue");
  assert(source.includes("stormScare"), "Mr. Feast apparitions must use a dedicated sting in addition to thunder");
  assert(source.includes("placePlayerAtStormScareTriggerForQA"), "authored scare positions need a focused proximity QA hook");
  assert(source.includes("completeStormRunForQA"), "Storm Run outcomes must be deterministic in QA");
  assert(source.includes("suspendThreatsForCompetition"), "a live-event call must suspend an active pursuit or alarm");
  assert(html.includes('id="mansion-storm-run"'), "Storm Run must have a dedicated HUD region");
  assert(html.includes('id="mansion-storm-run" role="region" aria-label="Storm Run minimal status" aria-live="polite" aria-atomic="true" data-guidance="speech"'), "Storm Run must ship a speech-led minimal status strip");
  assert(!/#mansion-stage:has\(#mansion-storm-run[^\n]+#mansion-speech\s*\{\s*display:\s*none/.test(html), "active Storm Run must never hide Mr. Feast's speech bubble");
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
  await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(16));
  await page.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "running", null, { timeout: 8000 });
  return stormState(page);
}

async function collectCheckpoint(page, index) {
  return page.evaluate((checkpointIndex) => window.MrFeastFresh.collectStormCheckpointForQA(checkpointIndex), index);
}

async function previewCheckpoint(page, index) {
  return page.evaluate((checkpointIndex) => window.MrFeastFresh.previewStormCheckpointForQA(checkpointIndex), index);
}

async function canvasLuminance(page) {
  const screenshot = await page.locator("#mansion-canvas").screenshot();
  const metadata = await sharp(screenshot).metadata();
  const width = Math.max(1, Math.floor((metadata.width || 1) * 0.8));
  const height = Math.max(1, Math.floor((metadata.height || 1) * 0.58));
  const left = Math.max(0, Math.floor(((metadata.width || width) - width) / 2));
  const top = Math.max(0, Math.floor((metadata.height || height) * 0.16));
  const stats = await sharp(screenshot).extract({ left, top, width, height }).stats();
  const [red, green, blue] = stats.channels;
  return Number(((0.2126 * red.mean + 0.7152 * green.mean + 0.0722 * blue.mean) / 255).toFixed(4));
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
      titleDisplay: getComputedStyle(document.getElementById("mansion-storm-run-title")).display,
      checkpointDisplay: getComputedStyle(document.getElementById("mansion-storm-run-checkpoint")).display,
      standingsDisplay: getComputedStyle(document.getElementById("mansion-storm-run-standings")).display,
      speechDisplay: getComputedStyle(document.getElementById("mansion-speech")).display,
    };
  });
  assert(geometry.hud.left >= geometry.stage.left - 1 && geometry.hud.right <= geometry.stage.right + 1, `Storm HUD must fit stage width: ${JSON.stringify(geometry)}`);
  assert(geometry.hud.top >= geometry.stage.top - 1 && geometry.hud.bottom <= geometry.stage.bottom + 1, `Storm HUD must fit stage height: ${JSON.stringify(geometry)}`);
  assert(!geometry.overflow, `Storm HUD must not create horizontal overflow: ${JSON.stringify(geometry)}`);
  assert(geometry.energy && !geometry.energy.hidden && geometry.energy.width > 0, `the sprint-energy meter must remain visible during Storm Run: ${JSON.stringify(geometry)}`);
  assert(geometry.hud.height <= 58 && geometry.titleDisplay === "none" && geometry.checkpointDisplay === "none" && geometry.standingsDisplay === "none", `Storm Run must use only a shallow progress/time strip with no written directions or standings: ${JSON.stringify(geometry)}`);
  assert(geometry.speechDisplay !== "none", `Mr. Feast's speech must remain visible while Storm Run owns the HUD: ${JSON.stringify(geometry)}`);
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
    const briefingStorm = await stormState(timerPage);
    const briefingDiagnostics = await diagnostics(timerPage);
    assert(briefingStorm.briefing?.hostAtBackDoor && briefingStorm.briefing?.rulesExplained, `Mr. Feast must visibly explain the complete race from the back door: ${JSON.stringify(briefingStorm.briefing)}`);
    assert(angleDistance(briefingDiagnostics.player.yaw, Math.PI) <= 0.05, `the briefing camera must face Mr. Feast at the back door: ${JSON.stringify(briefingDiagnostics.player)}`);
    await timerPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "storm-run-rear-door-briefing-desktop.png") });
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(16));
    storm = await stormState(timerPage);
    assert(storm.phase === "running" && storm.staging.mara && storm.staging.juniper && !storm.staging.kip, `race staging must include only surviving opponents: ${JSON.stringify(storm.staging)}`);
    assert(storm.player.sprintAvailable === true, `normal sprint must remain available during the race: ${JSON.stringify(storm.player)}`);
    assert(JSON.stringify(storm.briefing?.countdownSequence) === JSON.stringify([3, 2, 1, 0]), `the race must emit a complete three-two-one-start countdown: ${JSON.stringify(storm.briefing)}`);
    assert(angleDistance((await diagnostics(timerPage)).player.yaw, Math.PI / 2) <= 0.05, "the released player must face west toward checkpoint one instead of south");
    const startSpeech = (await diagnostics(timerPage)).speech;
    const startCategories = startSpeech.history.map((entry) => entry.category);
    for (const category of ["storm-run-rules", "storm-run-countdown-3", "storm-run-countdown-2", "storm-run-countdown-1", "storm-run-start"]) {
      assert(startCategories.includes(category), `Mr. Feast must verbally deliver ${category}: ${JSON.stringify(startSpeech.history)}`);
    }
    assert(startSpeech.text === "Run!", `GO must release the contestants without naming a checkpoint or landmark: ${JSON.stringify(startSpeech)}`);
    assert(storm.instructionDelivery === "visual-checkpoints" && storm.ui?.minimal, `Storm Run must expose visual checkpoint guidance and a minimal HUD: ${JSON.stringify({ delivery: storm.instructionDelivery, ui: storm.ui })}`);

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
    assert(checkpoints.every((entry) => entry.callout == null), `checkpoint diagnostics must not expose unused spoken landmark lines: ${JSON.stringify(checkpoints.map((entry) => entry.callout))}`);
    const scareCheckpoints = checkpoints.filter((entry) => entry.scareReveal);
    assert(JSON.stringify(scareCheckpoints.map((entry) => entry.id)) === JSON.stringify(["east-front-lawn", "hedge-maze"]), `Storm Run must use exactly two well-spaced Mr. Feast apparitions, with the first in the trees after the driveway turn: ${JSON.stringify(scareCheckpoints)}`);
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
    const checkpointSpeech = (await diagnostics(timerPage)).speech;
    assert(checkpointSpeech.category === "storm-run-start" && checkpointSpeech.text === "Run!" && checkpointSpeech.history.length === startSpeech.history.length, `collecting a checkpoint must not make Mr. Feast announce a landmark: ${JSON.stringify(checkpointSpeech)}`);
    const standingsAfterFirst = await timerPage.locator("#mansion-storm-run-standings").evaluate((element) => ({ text: element.textContent, display: getComputedStyle(element).display }));
    assert(standingsAfterFirst.text === "" && standingsAfterFirst.display === "none", `the minimal HUD must not duplicate contestant standings: ${JSON.stringify(standingsAfterFirst)}`);

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
    const treeScareIndex = checkpoints.findIndex((entry) => entry.id === "east-front-lawn");
    const mazeIndex = checkpoints.findIndex((entry) => entry.id === "hedge-maze");
    assert(frontDriveIndex === 5 && treeScareIndex === 6 && mazeIndex === 9, `the tree-line scare must follow the driveway checkpoint before the maze scare: ${JSON.stringify({ frontDriveIndex, treeScareIndex, mazeIndex })}`);
    for (let index = 1; index <= frontDriveIndex; index += 1) {
      const preview = await previewCheckpoint(timerPage, index);
      assert(preview?.active && preview.onScreen && preview.guideVisible && preview.alwaysVisible, `checkpoint ${index + 1} must be visible from checkpoint ${index}: ${JSON.stringify(preview)}`);
      const collected = await collectCheckpoint(timerPage, index);
      assert(collected.accepted === true && collected.completed === index + 1, `breadcrumb checkpoint ${index + 1} must advance in order: ${JSON.stringify(collected)}`);
    }
    assert(!(await stormState(timerPage)).scare.triggeredCheckpointIds.includes("east-front-lawn"), "the tree-line apparition must not fire before the driveway checkpoint is collected");
    const treePreview = await previewCheckpoint(timerPage, treeScareIndex);
    assert(treePreview?.active && treePreview.onScreen && treePreview.guideVisible && treePreview.alwaysVisible, `front-lawn marker must be visible after leaving the driveway checkpoint: ${JSON.stringify(treePreview)}`);
    await timerPage.screenshot({ path: path.join(artifactDir, "storm-run-visible-checkpoint-chain-desktop.png") });
    const treeScareComposition = await timerPage.evaluate((index) => window.MrFeastFresh.previewStormScareForQA(index), treeScareIndex);
    assert(treeScareComposition?.onScreen && treeScareComposition.lineOfSight && Math.abs(treeScareComposition.projected.x) <= 0.65, `the first apparition must stand unobstructed in the trees within the player's left-turn view: ${JSON.stringify(treeScareComposition)}`);
    assert(treeScareComposition.distance >= 6 && treeScareComposition.distance <= 13 && treeScareComposition.projectedHeight >= 0.15, `the tree-line apparition must be large enough to read without blocking the route: ${JSON.stringify(treeScareComposition)}`);
    const naturalTreeApproach = await timerPage.evaluate((index) => window.MrFeastFresh.placePlayerAlongStormLegForQA(index, 0.42), treeScareIndex);
    assert(naturalTreeApproach?.onAuthoredLeg && naturalTreeApproach.triggerZoneDistance <= naturalTreeApproach.triggerRadius, `the normal diagonal run from driveway checkpoint six to checkpoint seven must cross the front-tree scare trigger: ${JSON.stringify(naturalTreeApproach)}`);
    const scareBefore = await stormState(timerPage);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    const scareVisible = await stormState(timerPage);
    assert(scareVisible.visitedCheckpointIds.includes("front-drive") && scareVisible.scare.triggeredCheckpointIds.includes("east-front-lawn"), `the natural post-driveway route must trigger the tree-line lightning automatically: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.hostVisible && scareVisible.scare.lightning > 0, `Mr. Feast must appear only with the flash: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.lightning >= 1.15 && scareVisible.scare.lightIntensityMultiplier >= 1.4, `the close bolt must light enough of the surrounding grounds to make Mr. Feast unmistakable: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.profile === "storm-run" && scareVisible.scare.flashDecayPerSecond < scareVisible.scare.normalFlashDecayPerSecond, `the race scare flash must last slightly longer than ambient lightning: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.flashStrengthMultiplier >= 1.1, `the apparition flash must be visibly stronger than ambient lightning: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.thunderVolumeMultiplier >= 1.6 && scareVisible.scare.thunderDelaySeconds <= 0.05 && scareVisible.scare.thunderCloseStrike, `the race scare must use a loud, immediate close-bolt crack: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.baselineLightExposure <= scareVisible.scare.maximumLightExposure, `Mr. Feast must wait in a very dark tree-line position: ${JSON.stringify(scareVisible.scare)}`);
    const treeThunder = await timerPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA().thunder);
    assert(treeThunder.lastProfile === "storm-run" && treeThunder.lastVolumeMultiplier >= 1.6 && treeThunder.lastCloseStrike, `the audio system must receive the close Storm Run thunder mix: ${JSON.stringify(treeThunder)}`);
    assert(scareVisible.hazard.enabled === false && scareVisible.hazard.penaltySeconds === 0, `lightning must not be a hazard: ${JSON.stringify(scareVisible.hazard)}`);
    assert(scareVisible.raceElapsed >= scareBefore.raceElapsed, "the scare must not subtract race time or checkpoint progress");
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.8));
    const scareHeld = await stormState(timerPage);
    assert(scareHeld.scare.hostVisible && scareHeld.scare.lightning > 0, `the authored flash must hold Mr. Feast long enough to be unmistakable while still brief: ${JSON.stringify(scareHeld.scare)}`);
    await timerPage.screenshot({ path: path.join(artifactDir, "mr-feast-tree-line-lightning-reveal-desktop.png") });
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.42));
    const scareGone = await stormState(timerPage);
    assert(scareGone.scare.hostVisible === false && scareGone.scare.lightning === 0, `Mr. Feast must disappear exactly when the close bolt falls back to darkness: ${JSON.stringify(scareGone.scare)}`);
    await timerPage.screenshot({ path: path.join(artifactDir, "mr-feast-tree-line-dark-after-reveal-desktop.png") });
    const treeCheckpoint = await collectCheckpoint(timerPage, treeScareIndex);
    assert(treeCheckpoint.accepted === true && treeCheckpoint.completed === treeScareIndex + 1, `east-front checkpoint should open the maze approach: ${JSON.stringify(treeCheckpoint)}`);
    for (let index = treeScareIndex + 1; index < mazeIndex; index += 1) {
      const preview = await previewCheckpoint(timerPage, index);
      assert(preview?.active && preview.onScreen && preview.guideVisible && preview.alwaysVisible, `checkpoint ${index + 1} must be visible from checkpoint ${index}: ${JSON.stringify(preview)}`);
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
    assert(JSON.stringify((await stormState(timerPage)).scare.triggeredCheckpointIds) === JSON.stringify(["east-front-lawn", "hedge-maze"]), "the complete race must contain exactly the two authored apparitions");
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

    const audioContext = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const audioPage = await audioContext.newPage();
    const audioErrors = [];
    watchErrors(audioPage, audioErrors);
    await audioPage.addInitScript(() => localStorage.clear());
    await audioPage.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&allLights=1`, { waitUntil: "domcontentloaded" });
    await audioPage.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await audioPage.locator("#mansion-enter").click();
    await audioPage.waitForFunction(() => window.MrFeastFresh?.getAudioStateForQA?.()?.contextState === "running", null, { timeout: 15000 });
    await audioPage.waitForFunction(() => window.MrFeastFresh?.getMrFeastState?.()?.loadStatus === "ready", null, { timeout: 120000 });
    await audioPage.evaluate(() => window.MrFeastFresh.advanceOpeningWelcomeForQA(120));
    await audioPage.waitForFunction(() => window.MrFeastFresh?.getContestantState?.()?.settled, null, { timeout: 120000 });
    await completeFeastSays(audioPage);
    const audioCalled = await audioPage.evaluate(() => window.MrFeastFresh.callStormRunForQA("audio-qa"));
    assert(audioCalled?.started === true, `the unmuted Storm Run audio probe should call the event: ${JSON.stringify(audioCalled)}`);
    const audioStarted = await audioPage.evaluate(() => window.MrFeastFresh.startStormRunForQA());
    assert(audioStarted?.started === true, `the unmuted Storm Run audio probe should stage the event: ${JSON.stringify(audioStarted)}`);
    const audioBeforeCountdown = await audioPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    await audioPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(16));
    await audioPage.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "running", null, { timeout: 8000 });
    let audioAfter = await audioPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(audioAfter.enabled && audioAfter.contextState === "running", `trusted entry must keep Web Audio running through the Storm Run briefing: ${JSON.stringify(audioAfter)}`);
    assert((audioAfter.cueCounts.stormCountdown || 0) - (audioBeforeCountdown.cueCounts.stormCountdown || 0) === 3, `the unmuted browser must schedule three audible countdown beeps: ${JSON.stringify(audioAfter.cueCounts)}`);
    for (const step of [3, 2, 1]) {
      assert((audioAfter.cueCounts[`stormCountdown${step}`] || 0) - (audioBeforeCountdown.cueCounts[`stormCountdown${step}`] || 0) === 1, `countdown step ${step} must emit exactly one audible cue: ${JSON.stringify(audioAfter.cueCounts)}`);
    }
    assert((audioAfter.cueCounts.stormRaceStart || 0) - (audioBeforeCountdown.cueCounts.stormRaceStart || 0) === 1, `GO must emit its own audible start cue: ${JSON.stringify(audioAfter.cueCounts)}`);
    const checkpointCueBefore = audioAfter.cueCounts.stormCheckpoint || 0;
    for (let index = 0; index <= 5; index += 1) {
      const collected = await collectCheckpoint(audioPage, index);
      assert(collected.accepted === true, `audio probe checkpoint ${index + 1} should collect in order: ${JSON.stringify(collected)}`);
    }
    audioAfter = await audioPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert((audioAfter.cueCounts.stormCheckpoint || 0) - checkpointCueBefore === 6, `each collected checkpoint must emit its own audible progress chime: ${JSON.stringify(audioAfter.cueCounts)}`);
    const scareAudioBefore = audioAfter;
    await audioPage.evaluate(() => window.MrFeastFresh.placePlayerAtStormScareTriggerForQA(6));
    await audioPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    await audioPage.waitForTimeout(250);
    audioAfter = await audioPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert((audioAfter.cueCounts.stormScare || 0) - (scareAudioBefore.cueCounts.stormScare || 0) === 1, `the tree-line apparition must emit its dedicated scare sting in a running audio context: ${JSON.stringify(audioAfter.cueCounts)}`);
    assert((audioAfter.cueCounts.thunderClose || 0) - (scareAudioBefore.cueCounts.thunderClose || 0) === 1, `the apparition must emit the close-bolt crack layer: ${JSON.stringify(audioAfter.cueCounts)}`);
    assert((audioAfter.cueCounts.thunder || 0) - (scareAudioBefore.cueCounts.thunder || 0) === 1, `the apparition must also emit the recorded thunder layer: ${JSON.stringify(audioAfter.cueCounts)}`);
    assert(audioAfter.thunder.playCount === scareAudioBefore.thunder.playCount + 1 && audioAfter.thunder.closeStrikeCount === scareAudioBefore.thunder.closeStrikeCount + 1, `the unmuted browser must actually schedule both apparition thunder layers: before=${JSON.stringify(scareAudioBefore.thunder)} after=${JSON.stringify(audioAfter.thunder)}`);
    assert(audioAfter.thunder.lastProfile === "storm-run" && audioAfter.thunder.lastVolumeMultiplier >= 1.6 && audioAfter.thunder.lastDelay <= 0.05, `the apparition must use the loud immediate Storm Run mix: ${JSON.stringify(audioAfter.thunder)}`);
    assert(audioErrors.length === 0, `unmuted Storm Run audio page produced console errors: ${JSON.stringify(audioErrors)}`);
    await audioContext.close();

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
    await winPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(16));
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
    await phonePage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(16));
    await phonePage.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "running", null, { timeout: 8000 });
    await assertHudFits(phonePage, true);
    await phonePage.screenshot({ path: path.join(artifactDir, "storm-run-mobile.png") });
    for (let index = 0; index <= 5; index += 1) {
      const collected = await collectCheckpoint(phonePage, index);
      assert(collected.accepted === true, `phone scare setup checkpoint ${index + 1} should collect in order: ${JSON.stringify(collected)}`);
    }
    const phoneTreeComposition = await phonePage.evaluate((index) => window.MrFeastFresh.previewStormScareForQA(index), 6);
    assert(phoneTreeComposition?.onScreen && phoneTreeComposition.projectedHeight >= 0.15, `the front-tree apparition must compose clearly in the phone camera: ${JSON.stringify(phoneTreeComposition)}`);
    const phoneNaturalApproach = await phonePage.evaluate(() => window.MrFeastFresh.placePlayerAlongStormLegForQA(6, 0.42));
    assert(phoneNaturalApproach?.onAuthoredLeg && phoneNaturalApproach.triggerZoneDistance <= phoneNaturalApproach.triggerRadius, `the phone's natural checkpoint-six-to-seven line must enter the scare trigger: ${JSON.stringify(phoneNaturalApproach)}`);
    await phonePage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    const phoneTreeScare = await stormState(phonePage);
    assert(phoneTreeScare.scare.hostVisible && phoneTreeScare.scare.triggeredCheckpointIds.includes("east-front-lawn"), `the real phone race line must reveal Mr. Feast among the front trees: ${JSON.stringify(phoneTreeScare.scare)}`);
    await phonePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "mr-feast-tree-line-lightning-reveal-mobile.png") });
    await phonePage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(1.25));
    for (let index = 6; index <= 8; index += 1) {
      const collected = await collectCheckpoint(phonePage, index);
      assert(collected.accepted === true, `phone north-maze setup checkpoint ${index + 1} should collect in order: ${JSON.stringify(collected)}`);
    }
    const northMaze = await phonePage.evaluate(() => window.MrFeastFresh.previewStormMazeNorthForQA());
    await phonePage.waitForTimeout(180);
    const northMazeLuminance = await canvasLuminance(phonePage);
    assert(northMaze.mazeLightingContext && northMaze.activeFixtureNames.includes(northMaze.fixture), `the localized north-maze light must be active in the fixed phone light budget: ${JSON.stringify(northMaze)}`);
    assert(northMaze.minimumRouteExposure >= northMaze.minimumExposure, `the north-maze route must retain enough measured light to navigate on a phone: ${JSON.stringify(northMaze)}`);
    assert(northMazeLuminance >= northMaze.minimumCanvasLuminance, `the phone north-maze view is still visually black: luminance=${northMazeLuminance} contract=${JSON.stringify(northMaze)}`);
    await phonePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "hedge-maze-north-mobile.png") });
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
