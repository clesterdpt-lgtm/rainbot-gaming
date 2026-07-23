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
  assert((source.match(/reportDeadlineSeconds:\s*5\s*\*\s*60/g) || []).length >= 2, "both competition calls must share a five-minute Mr. Feast check-in deadline");
  assert(source.includes("addCompetitionFilmSet"), "Storm Run must use the shared film-set staging instead of a sign");
  const filmCameraTuning = source.match(/camera:\s*Object\.freeze\(\{([\s\S]*?)\}\),\s*lights:/)?.[1] || "";
  const filmCameraScale = Number(filmCameraTuning.match(/scale:\s*([\d.]+)/)?.[1]);
  const filmCameraX = Number(filmCameraTuning.match(/x:\s*(-?[\d.]+)/)?.[1]);
  const filmCameraAudienceZ = Number(filmCameraTuning.match(/audienceZ:\s*([\d.]+)/)?.[1]);
  assert(Number.isFinite(filmCameraScale) && filmCameraScale <= 0.8, `the shared production camera must be reduced below human scale: ${JSON.stringify({ filmCameraScale })}`);
  assert(Math.hypot(filmCameraX, filmCameraAudienceZ) >= 2.25, `the shared production camera must be pulled away from Mr. Feast: ${JSON.stringify({ filmCameraX, filmCameraAudienceZ })}`);
  assert(source.includes("backDoorZ"), "Storm Run staging must measure Mr. Feast against the actual back-door plane");
  assert(!source.includes("storm-run-live-display") && !source.includes("storm-run-report-plinth"), "Storm Run must remove the old live sign/plinth trigger");
  assert(source.includes('reason: "storm-run-no-show"'), "missing the Storm Run report deadline must eliminate the player");
  assert(source.includes('instructionDelivery: "visual-checkpoints"'), "Storm Run must declare its glowing checkpoints as the authoritative direction channel");
  assert(!source.includes("checkpointCallout"), "Storm Run must not retain a spoken checkpoint-announcement path");
  assert(!/beat[ -]mara/i.test(source), "Storm Run must not retain a Beat Mara objective or internal outcome label");
  assert(source.includes("storm-run-countdown-"), "Mr. Feast must verbally call the Storm Run countdown steps");
  assert(source.includes("class StormRunSystem"), "Storm Run must use a focused owning system");
  assert(source.includes("stormRun:"), "central state and diagnostics must expose Storm Run");
  assert(source.includes("competitionBlocksInvestigation"), "all competition clue holds must use a shared gate");
  assert(source.includes("noteMajorClueDiscovered"), "new major clues must dispatch through the competition scheduler");
  assert(source.includes("triggerGateSatisfied"), "Storm Run must own an explicit painting-code-or-hedge-key trigger gate");
  assert(source.includes("paintingNumbersRequired"), "Storm Run diagnostics must report the four-number requirement");
  assert(!/if \(this\.show\.intermissionElapsed >= STORM_RUN\.intermissionSeconds\) this\.call\("timer"\)/.test(source), "elapsed exploration time must not call Storm Run");
  assert(source.includes("getStormRunState"), "Storm Run diagnostics must have a focused QA hook");
  assert(source.includes("advanceStormRunForQA"), "Storm Run must support deterministic time stepping");
  assert(source.includes("collectStormCheckpointForQA"), "Storm Run checkpoints must use the focused QA contract");
  assert(source.includes("previewStormCheckpointForQA"), "every Storm Run leg needs a focused next-marker visibility QA hook");
  assert(source.includes("previewStormScareForQA"), "each Storm Run apparition needs a focused forward-view composition QA hook");
  assert(source.includes("placePlayerAlongStormLegForQA"), "the front-tree scare needs a QA path that follows the real checkpoint leg instead of teleporting into a tiny trigger");
  assert(source.includes("previewStormMazeNorthForQA"), "the phone-dark north maze route needs a focused lighting QA view");
  assert(source.includes("MAZE_NORTH_VISIBILITY"), "north-maze readability tuning must live in one named constant table");
  assert(source.includes("scareThunderVolumeMultiplier"), "Storm Run must own a louder thunder profile instead of changing ambient lightning globally");
  assert(source.includes("scareThunderMaximumVolumeMultiplier"), "the louder close bolt must keep an explicit safe multiplier ceiling");
  assert(source.includes("scareThunderCloseStrike"), "Storm Run must own a sharp close-bolt layer instead of relying on an ordinary distant roll");
  assert(source.includes("scareFacingMinimumDot"), "Storm Run apparitions must wait until the player faces their authored direction");
  assert(source.includes("scareFacingScreenMargin"), "Storm Run apparitions must be inside the actual camera view, not merely on the same compass heading");
  assert(source.includes("scareCandidateZoneId"), "crossing an apparition trigger must arm it until the player turns during the authored route window");
  assert(!source.includes("makeWhiteNoiseBuffer"), "the Storm Run bolt must not add a static-like white-noise crack ahead of the recorded thunder");
  assert(source.includes("duckRainForCloseStrike"), "the close thunder crack must briefly duck the outdoor rain so it remains audible on phones");
  assert(!source.includes("scheduleCloseThunderCrack"), "the Storm Run bolt must use the recorded thunder alone, without a procedural static layer");
  assert(source.includes("queueCloseThunder"), "a temporarily interrupted mobile audio context must queue the close bolt for the next trusted gesture");
  assert(source.includes("scareFlashStrengthMultiplier"), "Storm Run apparitions must use a stronger flash than ambient lightning");
  assert(source.includes('scareRevealLightTopology: "stable"'), "the apparition fill must stay shader-resident instead of recompiling yard materials on the first bolt");
  assert(source.includes("scareLightIntensityMultiplier"), "Storm Run apparitions must illuminate the surrounding grounds more strongly than ambient lightning");
  assert(source.includes("scareMaximumLightExposure"), "Storm Run apparitions must be authored in measured dark positions");
  assert(source.includes("briefingMark"), "Storm Run must distinguish the rear-door briefing view from the race-facing start orientation");
  assert(source.includes("briefingHostMark"), "Storm Run must define a host-facing-player briefing mark separate from the waiting pose");
  assert(source.includes("stageHostForBriefing"), "Storm Run must continuously reapply its face-to-face briefing pose until race release");
  const reportToStartSource = source.match(/reportToStart\(\) \{([\s\S]*?)\n    \}\n\n    beginRace\(\)/)?.[1] || "";
  assert(reportToStartSource && !reportToStartSource.includes("idlePoseTime"), "Storm Run must release the waiting-only frozen body pose when the player starts the spoken briefing");
  assert(source.includes("briefingLighting"), "Storm Run needs named temporary lighting for the initial face-to-face intro");
  assert(source.includes('profile: "briefing-only-uniform-lift"'), "Storm Run intro lighting must reuse existing uniforms instead of adding a new shader light");
  assert(source.includes("moonPosition"), "Storm Run intro lighting must aim the existing moon from the player side instead of leaving Mr. Feast backlit");
  assert(source.includes("stormCountdown"), "Storm Run must own an audible three-two-one countdown cue");
  assert(source.includes("stormCheckpoint"), "Storm Run checkpoints must use a dedicated audible progress cue");
  assert(source.includes("stormScare"), "Mr. Feast apparitions must use a dedicated sting in addition to thunder");
  assert(source.includes("placePlayerAtStormScareTriggerForQA"), "authored scare positions need a focused proximity QA hook");
  assert(source.includes("completeStormRunForQA"), "Storm Run outcomes must be deterministic in QA");
  assert(source.includes("beginStormRunAftermath"), "a player victory must stage Mara's witnessed Storm Run aftermath before removing her");
  assert(source.includes('eliminatedAction: "cover-face"'), "Storm Run must author Mara's hands-over-face loss separately from Kip's Feast Says pose");
  assert(source.includes('"storm-run-aftermath"'), "Storm Run must keep Mara and Juniper staged during the finish aftermath");
  assert(source.includes("completeStormRunWithAftermathForQA"), "Storm Run must expose a focused QA path that preserves its witnessed aftermath");
  assert(source.includes("syncStormRunAftermathVisibility"), "the witnessed Storm Run ending must continuously keep Mr. Feast visible at the back door");
  assert(source.includes("aftermathExitRequiresDistanceAndOcclusion"), "the Storm Run ending must require both distance and an occluded view before reset");
  assert(source.includes("stormRunPostGameLine"), "Juniper needs a one-use post-Storm Run conversation");
  assert(source.includes("postGameDialoguePendingIds"), "the one-use Juniper follow-up must persist in authoritative state");
  assert(source.includes("suspendThreatsForCompetition"), "a live-event call must suspend an active pursuit or alarm");
  assert(source.includes("skipStormRunBriefing") && source.includes("canSkipBriefing"), "Storm Run is missing an explicit briefing-only E/tap skip transition");
  assert(/briefingSkipAfterSeconds:\s*0/.test(source), "Storm Run briefing skip must be immediate");
  assert(!/skipLabel:\s*"Skip rules"/.test(source), "Storm Run rules must not attach a Skip rules bubble button");
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

async function hostFootPose(page) {
  return page.evaluate(() => {
    const host = window.MrFeastFresh.getMrFeastState();
    return {
      animation: host.currentAnimation,
      moving: host.moving,
      challengeIdlePoseTime: host.challengeIdlePoseTime,
      qaAnimationFrozen: host.qaAnimationFrozen,
      mixerTime: host.mixerTime,
      position: host.position,
      leftFoot: host.liveBones?.leftFoot || null,
      rightFoot: host.liveBones?.rightFoot || null,
    };
  });
}

function footPoseDistance(before, after) {
  const distance = (left, right) => Math.hypot(
    (right?.x || 0) - (left?.x || 0),
    (right?.y || 0) - (left?.y || 0),
    (right?.z || 0) - (left?.z || 0),
  );
  return Math.max(
    distance(before.leftFoot, after.leftFoot),
    distance(before.rightFoot, after.rightFoot),
  );
}

function rootPoseDistance(before, after) {
  return Math.hypot(
    (after.position?.x || 0) - (before.position?.x || 0),
    (after.position?.y || 0) - (before.position?.y || 0),
    (after.position?.z || 0) - (before.position?.z || 0),
  );
}

async function briefingFacing(page) {
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
    };
  });
}

async function bootPage(page) {
  page.setDefaultTimeout(120000);
  await page.addInitScript(() => localStorage.clear());
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
  assert(
    await page.evaluate(() => window.MrFeastFresh.startOptionalCharacterLoadsForQA?.()),
    "Storm Run QA must start optional host/cast loading deterministically after the core estate is ready",
  );
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
  const running = await stormState(page);
  assert(running.phase === "running", `deterministic Storm Run start must reach the live race: ${JSON.stringify(running)}`);
  return running;
}

async function collectCheckpoint(page, index) {
  return page.evaluate((checkpointIndex) => window.MrFeastFresh.collectStormCheckpointForQA(checkpointIndex), index);
}

async function previewCheckpoint(page, index) {
  return page.evaluate((checkpointIndex) => window.MrFeastFresh.previewStormCheckpointForQA(checkpointIndex), index);
}

async function triggerScareThroughFacingGate(page, index, expectedId) {
  const awayPlacement = await page.evaluate(
    ({ scareIndex }) => window.MrFeastFresh.placePlayerAtStormScareTriggerForQA(scareIndex, false),
    { scareIndex: index },
  );
  assert(awayPlacement?.id === expectedId && awayPlacement.lineOfSight, `scare ${index + 1} away-facing setup must stand in the authored clear view: ${JSON.stringify(awayPlacement)}`);
  assert(awayPlacement.facingDot < awayPlacement.facingMinimumDot, `scare ${index + 1} away-facing setup must fail the view gate: ${JSON.stringify(awayPlacement)}`);
  await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
  await page.waitForTimeout(120);
  const waiting = await stormState(page);
  assert(!waiting.scare.triggeredIds.includes(expectedId), `scare ${index + 1} must not fire while the player faces away: ${JSON.stringify(waiting.scare)}`);
  assert(waiting.scare.candidateId === expectedId && waiting.scare.waitingForFacing, `scare ${index + 1} should wait inside its trigger instead of consuming the one-shot: ${JSON.stringify(waiting.scare)}`);
  assert(!waiting.scare.hostVisible && waiting.scare.lightning === 0, `facing away must emit neither Mr. Feast nor lightning: ${JSON.stringify(waiting.scare)}`);
  assert(waiting.scare.revealFillShaderResident && !waiting.scare.revealFillActive, `the zero-intensity fill must already reside in the light topology before the bolt: ${JSON.stringify(waiting.scare)}`);
  const rendererBefore = (await diagnostics(page)).renderer;

  let facingOptions = {};
  if (index === 0) {
    const crossed = await page.evaluate(() => window.MrFeastFresh.placePlayerAlongStormLegForQA(3, 0.32, { pitch: -1.25 }));
    assert(crossed?.onAuthoredLeg && crossed.triggerZoneDistance > crossed.triggerRadius, `the player must naturally leave the small garden trigger while looking down: ${JSON.stringify(crossed)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    const armedAfterCrossing = await stormState(page);
    assert(
      armedAfterCrossing.scare.candidateId === expectedId
        && armedAfterCrossing.scare.armed
        && armedAfterCrossing.scare.waitingForFacing
        && !armedAfterCrossing.scare.onScreen
        && !armedAfterCrossing.scare.triggeredIds.includes(expectedId),
      `the one-shot must remain armed after a natural crossing and must not fire while the player looks at the ground: ${JSON.stringify(armedAfterCrossing.scare)}`,
    );
    facingOptions = {
      offsetX: crossed.position.x - awayPlacement.position.x,
      offsetZ: crossed.position.z - awayPlacement.position.z,
    };
  }

  const facingPlacement = await page.evaluate(
    ({ scareIndex, options }) => window.MrFeastFresh.placePlayerAtStormScareTriggerForQA(scareIndex, true, options),
    { scareIndex: index, options: facingOptions },
  );
  assert(facingPlacement?.facingDot >= facingPlacement?.facingMinimumDot && facingPlacement.onScreen && facingPlacement.lineOfSight, `scare ${index + 1} must have a clear in-view trigger pose: ${JSON.stringify(facingPlacement)}`);
  await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
  await page.waitForTimeout(120);
  const visible = await stormState(page);
  assert(visible.scare.triggeredIds.includes(expectedId) && visible.scare.hostVisible && visible.scare.lightning > 0, `scare ${index + 1} must fire as soon as the player faces Mr. Feast: ${JSON.stringify(visible.scare)}`);
  const rendererAfter = (await diagnostics(page)).renderer;
  assert(rendererAfter.programs <= rendererBefore.programs, `scare ${index + 1} must not compile a new yard-light shader variant on the lightning frame: before=${JSON.stringify(rendererBefore)} after=${JSON.stringify(rendererAfter)}`);
  return { awayPlacement, facingPlacement, waiting, visible, rendererBefore, rendererAfter };
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
    assert(storm.eligible === false && storm.triggerGate?.gameOneComplete && !storm.triggerGate?.satisfied, `Game 1 alone must not make Storm Run eligible: ${JSON.stringify(storm)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(1200));
    storm = await stormState(timerPage);
    assert(storm.phase === "dormant" && storm.callCount === 0 && !storm.triggerGate?.satisfied, `elapsed exploration time must never call Storm Run: ${JSON.stringify(storm)}`);
    const unrelatedClue = await timerPage.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("shovel"));
    assert(unrelatedClue.phase === "dormant" && unrelatedClue.callCount === 0 && unrelatedClue.quest.shovelTaken, `an unrelated major clue must remain earned without calling Storm Run: ${JSON.stringify(unrelatedClue)}`);
    for (let index = 0; index < 3; index += 1) {
      const partial = await timerPage.evaluate((scratchIndex) => window.MrFeastFresh.triggerStormRunClueForQA(`scratch-${scratchIndex + 1}`), index);
      assert(partial.phase === "dormant" && partial.callCount === 0, `painting digit ${index + 1} of 4 must not call Storm Run: ${JSON.stringify(partial)}`);
      assert(partial.triggerGate?.paintingNumbersFound === index + 1 && !partial.triggerGate?.paintingsComplete, `painting gate diagnostics drifted after digit ${index + 1}: ${JSON.stringify(partial.triggerGate)}`);
    }
    const paintingCall = await timerPage.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("scratch-4"));
    assert(paintingCall.phase === "called" && paintingCall.callCount === 1 && paintingCall.triggerReason === "painting-code", `the fourth painting digit must call Storm Run exactly once: ${JSON.stringify(paintingCall)}`);
    assert(paintingCall.triggerGate?.paintingNumbersFound === 4 && paintingCall.triggerGate?.paintingsComplete && paintingCall.triggerGate?.satisfied, `the completed painting gate must remain visible in diagnostics: ${JSON.stringify(paintingCall.triggerGate)}`);
    storm = await stormState(timerPage);
    assert(storm.phase === "called" && storm.callCount === 1 && storm.triggerReason === "painting-code", `Storm Run must remain singly called after the fourth digit: ${JSON.stringify(storm)}`);
    assert(storm.reportDeadlineSeconds === 300 && storm.reportRemaining === 300 && storm.hostWaiting, `Storm Run must give five minutes while Mr. Feast waits at the back-door set: ${JSON.stringify(storm)}`);
    assert(storm.filmSet?.visible && storm.filmSet?.cameraCount === 1 && storm.filmSet?.lightCount === 2 && storm.filmSet?.boomMicCount === 1 && !storm.filmSet?.hasSign, `the Storm Run trigger must be a camera/light/boom set rather than a sign: ${JSON.stringify(storm.filmSet)}`);
    assert(storm.filmSet.cameraScale <= 0.8 && storm.filmSet.cameraDistanceFromHost >= 2.25, `the Storm Run camera must stay smaller and farther from Mr. Feast: ${JSON.stringify(storm.filmSet)}`);
    assert(storm.briefing.hostFacingBackDoor && storm.briefing.hostDistanceFromBackDoor >= 2.5, `Mr. Feast must wait away from and facing the back door: ${JSON.stringify(storm.briefing)}`);
    assert(storm.briefing?.lighting?.active === false, `the Storm Run lighting lift must stay off while the player is still reporting: ${JSON.stringify(storm.briefing?.lighting)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0));
    const waitingPoseBefore = await hostFootPose(timerPage);
    await timerPage.waitForTimeout(650);
    const waitingPoseAfter = await hostFootPose(timerPage);
    assert(
      waitingPoseBefore.animation === "idle"
        && waitingPoseAfter.animation === "idle"
        && !waitingPoseBefore.moving
        && !waitingPoseAfter.moving
        && footPoseDistance(waitingPoseBefore, waitingPoseAfter) <= 0.002,
      `Mr. Feast must plant both feet instead of walking in place while waiting at the back door: ${JSON.stringify({ waitingPoseBefore, waitingPoseAfter, footTravel: footPoseDistance(waitingPoseBefore, waitingPoseAfter) })}`,
    );
    const calledPause = await timerPage.evaluate(() => {
      const before = window.MrFeastFresh.getStormRunState().reportRemaining;
      window.MrFeastFresh.setMenuOpenForQA(true);
      window.MrFeastFresh.advanceStormRunForQA(30);
      const during = window.MrFeastFresh.getStormRunState().reportRemaining;
      window.MrFeastFresh.setMenuOpenForQA(false);
      return { before, during };
    });
    assert(calledPause.before === calledPause.during, `blocking UI must pause the Storm Run check-in deadline: ${JSON.stringify(calledPause)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(30));
    storm = await stormState(timerPage);
    assert(storm.callCount === 1 && storm.reportRemaining === 270, `Storm Run must count down without duplicating its call: ${JSON.stringify(storm)}`);
    assert(await timerPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving during the Storm Run report window should succeed");
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(12));
    assert(await timerPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading a called Storm Run state should succeed");
    storm = await stormState(timerPage);
    assert(storm.phase === "called" && storm.reportRemaining === 270 && storm.hostWaiting, `called saves must preserve the exact Storm Run deadline and waiting host: ${JSON.stringify(storm)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(269.9));
    storm = await stormState(timerPage);
    assert(storm.phase === "called" && storm.reportRemaining > 0 && storm.reportRemaining <= 0.11, `Storm Run must remain available immediately before the deadline: ${JSON.stringify(storm)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.2));
    const missedCall = await diagnostics(timerPage);
    assert(missedCall.stormRun.phase === "failed" && missedCall.gameOver?.reason === "storm-run-no-show", `missing the Storm Run call must eliminate the player: ${JSON.stringify({ stormRun: missedCall.stormRun, gameOver: missedCall.gameOver })}`);

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
    const shovelOnly = await timerPage.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("shovel"));
    assert(shovelOnly.phase === "dormant" && shovelOnly.quest.shovelTaken, `the shovel must remain earned without calling Storm Run: ${JSON.stringify(shovelOnly)}`);
    const clueCall = await timerPage.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("key"));
    assert(clueCall.phase === "called" && clueCall.triggerReason === "hedge-maze-key", `recovering the hedge-maze key should call Storm Run: ${JSON.stringify(clueCall)}`);
    const clueDiagnostics = await diagnostics(timerPage);
    assert(clueDiagnostics.contestant13.shovelTaken && clueDiagnostics.contestant13.basementKeyFound, "the key that calls Storm Run must remain earned");
    assert(clueDiagnostics.stormRun.clueProgressLocked === true, "later clue progress must pause during Storm Run");
    assert(clueDiagnostics.mrFeast.pursuit.active === null && clueDiagnostics.mrFeast.security.activeAlarm === null, `the Storm call must suspend pursuit/alarm danger before reporting: ${JSON.stringify({ pursuit: clueDiagnostics.mrFeast.pursuit, security: clueDiagnostics.mrFeast.security })}`);
    const blockedScratch = await timerPage.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("scratch-1"));
    assert(blockedScratch.triggerGate.paintingNumbersFound === 0, `the next clue must remain held after the key calls Storm Run: ${JSON.stringify(blockedScratch)}`);

    await timerPage.evaluate(() => window.MrFeastFresh.teleport("stormRunStaging"));
    await timerPage.waitForTimeout(120);
    const station = await stormState(timerPage);
    const stationDiagnostics = await diagnostics(timerPage);
    assert(station.station.interactive && station.hostWaiting && /start storm run with mr\. feast/i.test(stationDiagnostics.prompt || ""), `called Storm Run must start by interacting with Mr. Feast on the rear film set: ${JSON.stringify({ station: station.station, prompt: stationDiagnostics.prompt })}`);
    await timerPage.keyboard.press("e");
    await timerPage.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "briefing", null, { timeout: 8000 });
    // Freeze the real-time clock before taking screenshots or running the
    // deterministic countdown probe; renderer work must not consume briefing.
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0));
    const briefingMoveBefore = (await diagnostics(timerPage)).player;
    await timerPage.keyboard.down("w");
    await timerPage.waitForTimeout(240);
    await timerPage.keyboard.up("w");
    const briefingMoveAfter = (await diagnostics(timerPage)).player;
    assert(Math.hypot(briefingMoveAfter.x - briefingMoveBefore.x, briefingMoveAfter.z - briefingMoveBefore.z) <= 0.03, "briefing must hold the player on the start mark");
    const briefingStorm = await stormState(timerPage);
    const briefingDiagnostics = await diagnostics(timerPage);
    assert(briefingStorm.briefing?.hostAtBackDoor && briefingStorm.briefing?.rulesExplained, `Mr. Feast must visibly explain the complete race from the back door: ${JSON.stringify(briefingStorm.briefing)}`);
    assert(!/beat mara/i.test(briefingStorm.briefing?.line || ""), `the briefing must state the elimination rule without a Beat Mara objective: ${JSON.stringify(briefingStorm.briefing)}`);
    const introLighting = briefingStorm.briefing?.lighting;
    assert(introLighting?.active && introLighting?.profile === "briefing-only-uniform-lift", `Storm Run must activate its named temporary intro lighting during the rules: ${JSON.stringify(introLighting)}`);
    assert(introLighting.hemisphereTarget > 0.34 && introLighting.moonTarget > 0.52 && introLighting.exposureTarget > 0.94, `Storm Run intro lighting must materially raise the existing grounds targets: ${JSON.stringify(introLighting)}`);
    assert(introLighting.moonPose === "storm-run-briefing" && introLighting.moonPosition?.z < -20, `Storm Run must swing the existing moon to a player-side key while Mr. Feast explains the rules: ${JSON.stringify(introLighting)}`);
    assert(briefingDiagnostics.lighting.hemisphereTarget === introLighting.hemisphereTarget && briefingDiagnostics.lighting.moonTarget === introLighting.moonTarget, `the live lighting targets must match the Storm Run briefing profile: ${JSON.stringify({ briefing: introLighting, lighting: briefingDiagnostics.lighting })}`);
    assert(angleDistance(briefingDiagnostics.player.yaw, Math.PI) <= 0.05, `the briefing camera must face Mr. Feast at the back door: ${JSON.stringify(briefingDiagnostics.player)}`);
    let faceToFace = await briefingFacing(timerPage);
    assert(faceToFace.distance >= 1.2 && faceToFace.hostForwardDot >= 0.96 && faceToFace.playerForwardDot >= 0.96, `Storm Run must stage Mr. Feast face-to-face with the held player during his briefing: ${JSON.stringify(faceToFace)}`);
    const briefingPoseBefore = await hostFootPose(timerPage);
    await timerPage.waitForFunction((startingMixerTime) => {
      const mixerTime = window.MrFeastFresh.getMrFeastState?.()?.mixerTime;
      return Number.isFinite(mixerTime) && mixerTime - startingMixerTime >= 0.25;
    }, briefingPoseBefore.mixerTime, { timeout: 10000 });
    const briefingPoseAfter = await hostFootPose(timerPage);
    const briefingBodyTravel = footPoseDistance(briefingPoseBefore, briefingPoseAfter);
    assert(
      briefingPoseBefore.animation === "idle"
        && briefingPoseAfter.animation === "idle"
        && !briefingPoseBefore.moving
        && !briefingPoseAfter.moving
        && briefingPoseBefore.challengeIdlePoseTime === null
        && briefingPoseAfter.challengeIdlePoseTime === null
        && briefingBodyTravel >= 0.005
        && briefingBodyTravel <= 0.25
        && rootPoseDistance(briefingPoseBefore, briefingPoseAfter) <= 0.002,
      `Mr. Feast must return to his living idle animation while holding position for the Storm Run rules: ${JSON.stringify({ briefingPoseBefore, briefingPoseAfter, bodyTravel: briefingBodyTravel, rootTravel: rootPoseDistance(briefingPoseBefore, briefingPoseAfter) })}`,
    );
    await timerPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "storm-run-rear-door-briefing-desktop.png") });
    await timerPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "storm-run-bright-intro-desktop.png") });
    const stormSpeechSkip = timerPage.locator("#mansion-speech-skip");
    assert(!(await stormSpeechSkip.isVisible()), "Storm Run rules must not use a speech-bubble Skip button");
    assert(!briefingDiagnostics.speech.skippable && briefingDiagnostics.speech.skipLabel == null, `Storm Run rules speech must not be bubble-skippable; got ${JSON.stringify(briefingDiagnostics.speech)}`);
    assert(briefingDiagnostics.stormRun.canSkipBriefing === true, `Storm Run E/tap skip must be available immediately during rules; got ${JSON.stringify(briefingDiagnostics.stormRun)}`);
    const stormPrompt = timerPage.locator("#mansion-prompt");
    assert(await stormPrompt.isVisible(), "Storm Run rules must expose an immediate E/tap Skip prompt");
    const stormPromptText = await timerPage.locator("#mansion-prompt-text").textContent();
    assert(/skip/i.test(stormPromptText || ""), `Storm Run E prompt should advertise Skip; got ${JSON.stringify(stormPromptText)}`);
    await timerPage.keyboard.press("e");
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    storm = await stormState(timerPage);
    assert(storm.phase === "briefing" && storm.briefingRemaining <= 3 && storm.briefing.countdownSequence[0] === 3, `E Skip must jump to, not past, the spoken countdown: ${JSON.stringify(storm.briefing)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.5));
    faceToFace = await briefingFacing(timerPage);
    assert(faceToFace.hostForwardDot >= 0.96 && faceToFace.playerForwardDot >= 0.96, `Mr. Feast must hold the face-to-face briefing pose through the countdown: ${JSON.stringify(faceToFace)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(3));
    storm = await stormState(timerPage);
    assert(storm.phase === "running" && storm.staging.mara && storm.staging.juniper && !storm.staging.kip, `race staging must include only surviving opponents: ${JSON.stringify(storm.staging)}`);
    assert(storm.briefing?.lighting?.active === false, `Storm Run intro lighting must return to the ordinary storm baseline at race release: ${JSON.stringify(storm.briefing?.lighting)}`);
    assert(storm.briefing?.lighting?.moonPose === "night" && storm.briefing?.lighting?.moonPosition?.z > 0, `Storm Run must restore the storm moon direction at race release: ${JSON.stringify(storm.briefing?.lighting)}`);
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
    const scares = storm.scares;
    const expectedScareIds = ["northwest-tree-line", "northeast-tree-line", "maze-turn"];
    assert(JSON.stringify(scares.map((entry) => entry.id)) === JSON.stringify(expectedScareIds), `Storm Run must use the three numbered garden, front-drive, and maze apparitions from the property map: ${JSON.stringify(scares)}`);
    assert(scares.every((entry) => entry.reveal.darkSpot), `every apparition must be authored as a measured dark spot: ${JSON.stringify(scares)}`);
    assert(scares.every((entry) => entry.reveal.scale >= 0.95 && entry.reveal.scale <= 1.15), `all three apparitions must remain believable human scale: ${JSON.stringify(scares.map((entry) => entry.reveal.scale))}`);
    assert(scares[0].reveal.fillScale >= 2.5 && scares[1].reveal.fillScale >= 2.5 && scares[2].reveal.fillScale === 1, `the two distant silhouettes must gain readability from lightning fill rather than giant models: ${JSON.stringify(scares.map((entry) => entry.reveal.fillScale))}`);
    const frontTreeAnchors = [
      { id: "northwest-east-trunk", x: -17.5, z: 30 },
      { id: "northeast-north-trunk", x: 24.5, z: 29 },
    ];
    for (let index = 0; index < frontTreeAnchors.length; index += 1) {
      const anchor = frontTreeAnchors[index];
      const reveal = scares[index].reveal.position;
      const trunkDistance = Math.hypot(reveal.x - anchor.x, reveal.z - anchor.z);
      assert(trunkDistance >= 1.3 && trunkDistance <= 2, `apparition ${index + 1} must lurk beside ${anchor.id} without intersecting its trunk: ${JSON.stringify({ reveal, anchor, trunkDistance })}`);
    }
    assert(scares[0].trigger.id === "garden-front-approach" && scares[0].trigger.z >= 8 && scares[0].completedCheckpointMinimum === 2, `the first apparition must wait until the player reaches the north garden/front-yard approach: ${JSON.stringify(scares[0])}`);
    assert(scares[1].trigger.id === "front-door-crossing" && Math.abs(scares[1].trigger.x) <= 3 && scares[1].trigger.z >= 14 && scares[1].trigger.z <= 17, `the second apparition must wait until the player passes close to the front door: ${JSON.stringify(scares[1])}`);
    assert(scares.every((entry) => entry.trigger.radius >= 1.1 && entry.completedCheckpointMinimum <= entry.completedCheckpointMaximum), `each apparition needs a real route trigger and bounded progress window: ${JSON.stringify(scares)}`);
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

    const secondCheckpoint = await collectCheckpoint(timerPage, 1);
    assert(secondCheckpoint.accepted === true && secondCheckpoint.completed === 2, `the first scare must wait until checkpoint two is complete: ${JSON.stringify(secondCheckpoint)}`);

    const firstComposition = await timerPage.evaluate(() => window.MrFeastFresh.previewStormScareForQA(0));
    assert(firstComposition?.onScreen && firstComposition.lineOfSight && Math.abs(firstComposition.projected.x) <= 0.06, `the northwest apparition must stand unobstructed between the marked trees: ${JSON.stringify(firstComposition)}`);
    assert(firstComposition.distance >= 19 && firstComposition.distance <= 22 && firstComposition.projectedHeight >= 0.13 && firstComposition.projectedHeight <= 0.17, `the northwest silhouette must read at human scale from the later front-yard approach: ${JSON.stringify(firstComposition)}`);
    const firstScare = await triggerScareThroughFacingGate(timerPage, 0, expectedScareIds[0]);
    const scareVisible = firstScare.visible;
    assert(scareVisible.completedCheckpoints === 3 && scareVisible.visitedCheckpointIds.includes("garden-front-turn"), `the later first scare should coincide naturally with collecting checkpoint three: ${JSON.stringify(scareVisible)}`);
    assert(scareVisible.scare.lightning >= 1.15 && scareVisible.scare.lightIntensityMultiplier >= 1.4, `the close bolt must light enough of the surrounding grounds to make Mr. Feast unmistakable: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.profile === "storm-run" && scareVisible.scare.flashDecayPerSecond < scareVisible.scare.normalFlashDecayPerSecond, `the race scare flash must last slightly longer than ambient lightning: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.flashStrengthMultiplier >= 1.1, `the apparition flash must be visibly stronger than ambient lightning: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.revealFillActive && scareVisible.scare.revealFillIntensity >= 250, `the close bolt must add a short local fill so the mapped silhouette reads against the trees: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.checkpointSubdued, `the active route marker must stay present but yield visual emphasis to Mr. Feast during the bolt: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.thunderVolumeMultiplier >= 2 && scareVisible.scare.thunderDelaySeconds <= 0.05 && scareVisible.scare.thunderCloseStrike, `the race scare must use a louder, immediate close-bolt crack: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.scare.baselineLightExposure <= scareVisible.scare.maximumLightExposure, `the northwest Mr. Feast must wait in a very dark tree-line position: ${JSON.stringify(scareVisible.scare)}`);
    assert(scareVisible.hazard.enabled === false && scareVisible.hazard.penaltySeconds === 0, `lightning must not be a hazard: ${JSON.stringify(scareVisible.hazard)}`);
    await timerPage.screenshot({ path: path.join(artifactDir, "mr-feast-northwest-tree-line-lightning-desktop.png") });
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.8));
    const firstHeld = await stormState(timerPage);
    assert(firstHeld.scare.hostVisible && firstHeld.scare.lightning > 0 && firstHeld.scare.revealFillActive, `the first flash must hold and emphasize Mr. Feast long enough to register: ${JSON.stringify(firstHeld.scare)}`);
    const visibleCast = await timerPage.evaluate(() => window.MrFeastFresh.getContestantState().entries.filter((entry) => entry.challengeStaged));
    assert(visibleCast.length === 2 && visibleCast.every((entry) => entry.visible && entry.modelVisible), `the runners must remain naturally visible during lightning instead of blinking out: ${JSON.stringify(visibleCast)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.42));
    assert(!(await stormState(timerPage)).scare.hostVisible, "the first Mr. Feast silhouette must vanish with darkness");
    assert(!(await stormState(timerPage)).scare.revealFillActive, "the local silhouette fill must extinguish with the lightning");
    assert((await stormState(timerPage)).scare.revealFillShaderResident, "the extinguished fill must remain shader-resident for later bolts");

    for (let index = 3; index <= 3; index += 1) {
      const preview = await previewCheckpoint(timerPage, index);
      assert(preview?.active && preview.onScreen && preview.guideVisible && preview.alwaysVisible, `checkpoint ${index + 1} must be visible from checkpoint ${index}: ${JSON.stringify(preview)}`);
      const collected = await collectCheckpoint(timerPage, index);
      assert(collected.accepted === true && collected.completed === index + 1, `breadcrumb checkpoint ${index + 1} must advance in order: ${JSON.stringify(collected)}`);
    }
    await timerPage.screenshot({ path: path.join(artifactDir, "storm-run-visible-checkpoint-chain-desktop.png") });
    const secondComposition = await timerPage.evaluate(() => window.MrFeastFresh.previewStormScareForQA(1));
    assert(secondComposition?.onScreen && secondComposition.lineOfSight && Math.abs(secondComposition.projected.x) <= 0.06, `the northeast apparition must stand unobstructed in the marked front tree line: ${JSON.stringify(secondComposition)}`);
    assert(secondComposition.distance >= 29 && secondComposition.distance <= 31.5 && secondComposition.projectedHeight >= 0.09 && secondComposition.projectedHeight <= 0.13, `the northeast silhouette must read at human scale from the front-door crossing: ${JSON.stringify(secondComposition)}`);
    const secondScare = await triggerScareThroughFacingGate(timerPage, 1, expectedScareIds[1]);
    assert(secondScare.visible.scare.baselineLightExposure <= secondScare.visible.scare.maximumLightExposure, `the northeast Mr. Feast must begin in deep shadow: ${JSON.stringify(secondScare.visible.scare)}`);
    await timerPage.screenshot({ path: path.join(artifactDir, "mr-feast-northeast-tree-line-lightning-desktop.png") });
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(1.25));

    for (let index = 4; index <= 9; index += 1) {
      const preview = await previewCheckpoint(timerPage, index);
      assert(preview?.active && preview.onScreen && preview.guideVisible && preview.alwaysVisible, `checkpoint ${index + 1} must be visible from checkpoint ${index}: ${JSON.stringify(preview)}`);
      const collected = await collectCheckpoint(timerPage, index);
      assert(collected.accepted === true && collected.completed === index + 1, `maze-approach checkpoint ${index + 1} must advance in order: ${JSON.stringify(collected)}`);
    }
    let mazeExitState = await stormState(timerPage);
    const mazeExitScare = mazeExitState.scares[2];
    assert(
      mazeExitScare.trigger.id === "maze-final-corridor-turn"
        && mazeExitScare.trigger.x === 22
        && mazeExitScare.trigger.z === -0.25,
      `the final scare must arm as the player turns into the long last straight: ${JSON.stringify(mazeExitScare.trigger)}`,
    );
    assert(
      mazeExitScare.reveal.position.x === 22
        && mazeExitScare.reveal.position.z === -13.75
        && angleDistance(mazeExitScare.reveal.yaw, 0) <= 0.001,
      `Mr. Feast must wait at the far end before the westward exit turn facing north toward the player: ${JSON.stringify(mazeExitScare.reveal)}`,
    );
    assert(
      mazeExitState.mazeExitLighting?.dark
        && !mazeExitState.mazeExitLighting.restoredAfterScare
        && mazeExitState.mazeExitLighting.energizedFixtureCount === 0
        && mazeExitState.mazeExitLighting.shaderResidentFixtureCount >= 1,
      `the maze rear exit must be dark before the final bolt without removing its fixed light slot: ${JSON.stringify(mazeExitState.mazeExitLighting)}`,
    );
    const thirdComposition = await timerPage.evaluate(() => window.MrFeastFresh.previewStormScareForQA(2));
    assert(thirdComposition?.onScreen && thirdComposition.lineOfSight && Math.abs(thirdComposition.projected.x) <= 0.06, `the maze apparition must center in the player's unobstructed final-straight view: ${JSON.stringify(thirdComposition)}`);
    assert(
      thirdComposition.distance >= 13.4
        && thirdComposition.distance <= 13.6
        && thirdComposition.projectedHeight >= 0.1
        && thirdComposition.hostFacingPlayerDot >= 0.99,
      `the final apparition must read life-size at the far end while facing north toward the approaching player: ${JSON.stringify(thirdComposition)}`,
    );
    const thirdScare = await triggerScareThroughFacingGate(timerPage, 2, expectedScareIds[2]);
    assert(thirdScare.visible.scare.baselineLightExposure <= thirdScare.visible.scare.maximumLightExposure, `the hedge-maze apparition must begin in deep shadow: ${JSON.stringify(thirdScare.visible.scare)}`);
    assert(
      thirdScare.visible.mazeExitLighting?.dark
        && !thirdScare.visible.mazeExitLighting.restoredAfterScare
        && thirdScare.visible.mazeExitLighting.energizedFixtureCount === 0,
      `the rear-exit practical must stay dark throughout Mr. Feast's lightning reveal: ${JSON.stringify(thirdScare.visible.mazeExitLighting)}`,
    );
    await timerPage.screenshot({ path: path.join(artifactDir, "mr-feast-final-straight-lightning-desktop.png") });
    await timerPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(1.25));
    const mazeScareGone = await stormState(timerPage);
    assert(!mazeScareGone.scare.hostVisible && mazeScareGone.scare.lightning === 0, `the final apparition must vanish with the close bolt: ${JSON.stringify(mazeScareGone.scare)}`);
    assert(
      !mazeScareGone.mazeExitLighting?.dark
        && mazeScareGone.mazeExitLighting.restoredAfterScare
        && mazeScareGone.mazeExitLighting.energizedFixtureCount >= 1,
      `the rear-exit practical must relight only after Mr. Feast has disappeared: ${JSON.stringify(mazeScareGone.mazeExitLighting)}`,
    );

    for (let index = 10; index < checkpoints.length; index += 1) {
      const preview = await previewCheckpoint(timerPage, index);
      assert(preview?.active && preview.onScreen && preview.guideVisible && preview.alwaysVisible, `closing checkpoint ${index + 1} must remain visible: ${JSON.stringify(preview)}`);
      const collected = await collectCheckpoint(timerPage, index);
      assert(collected.accepted === true && collected.completed === index + 1, `closing checkpoint ${index + 1} must advance in order: ${JSON.stringify(collected)}`);
      if (index === checkpoints.length - 1) assert(collected.survived === true, `the final checkpoint must complete the race: ${JSON.stringify(collected)}`);
    }
    assert(JSON.stringify((await stormState(timerPage)).scare.triggeredIds) === JSON.stringify(expectedScareIds), "the complete race must contain exactly the three mapped, facing-gated apparitions");
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
    await audioPage.waitForFunction(() => !document.getElementById("mansion-enter")?.disabled, null, { timeout: 120000 });
    await audioPage.locator("#mansion-enter").click({ force: true });
    await audioPage.waitForFunction(() => window.MrFeastFresh?.getAudioStateForQA?.()?.contextState === "running", null, { timeout: 15000 });
    await audioPage.waitForFunction(() => window.MrFeastFresh?.getMrFeastState?.()?.loadStatus === "ready", null, { timeout: 120000 });
    await audioPage.evaluate(() => window.MrFeastFresh.advanceOpeningWelcomeForQA(120));
    await audioPage.waitForFunction(() => window.MrFeastFresh?.getContestantState?.()?.settled, null, { timeout: 120000 });
    await completeFeastSays(audioPage);
    const audioCalled = await audioPage.evaluate(() => window.MrFeastFresh.callStormRunForQA("qa"));
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
    const audioFirstCheckpoint = await collectCheckpoint(audioPage, 0);
    assert(audioFirstCheckpoint.accepted === true, `audio probe checkpoint one should collect in order: ${JSON.stringify(audioFirstCheckpoint)}`);
    const audioSecondCheckpoint = await collectCheckpoint(audioPage, 1);
    assert(audioSecondCheckpoint.accepted === true, `audio probe checkpoint two should unlock the later first scare: ${JSON.stringify(audioSecondCheckpoint)}`);
    audioAfter = await audioPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert((audioAfter.cueCounts.stormCheckpoint || 0) - checkpointCueBefore === 2, `both collected setup checkpoints must emit their audible progress chimes: ${JSON.stringify(audioAfter.cueCounts)}`);
    const scareAudioBefore = audioAfter;
    await audioPage.evaluate(() => window.MrFeastFresh.placePlayerAtStormScareTriggerForQA(0, false));
    await audioPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    let audioFacingAway = await audioPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert((audioFacingAway.cueCounts.stormScare || 0) === (scareAudioBefore.cueCounts.stormScare || 0), `facing away must not schedule the scare sting: ${JSON.stringify(audioFacingAway.cueCounts)}`);
    assert((audioFacingAway.cueCounts.thunderClose || 0) === (scareAudioBefore.cueCounts.thunderClose || 0), `facing away must not schedule thunder: ${JSON.stringify(audioFacingAway.cueCounts)}`);
    const suspendedState = await audioPage.evaluate(() => window.MrFeastFresh.suspendAudioForQA());
    assert(suspendedState === "suspended", `the mobile-interruption probe must suspend Web Audio before the apparition: ${suspendedState}`);
    await audioPage.evaluate(() => window.MrFeastFresh.placePlayerAtStormScareTriggerForQA(0, true));
    await audioPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    const queuedAudio = await audioPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(queuedAudio.contextState === "suspended" && queuedAudio.thunder.pendingCloseStrikeCount === 1, `a close bolt reached during a phone interruption must remain queued: ${JSON.stringify(queuedAudio.thunder)}`);
    assert(queuedAudio.thunder.closeStrikeCount === scareAudioBefore.thunder.closeStrikeCount, `the queued bolt must not pretend it played while Web Audio is suspended: ${JSON.stringify(queuedAudio.thunder)}`);
    await audioPage.keyboard.press("KeyQ");
    await audioPage.waitForFunction(
      (beforeCount) => {
        const audio = window.MrFeastFresh.getAudioStateForQA?.();
        return audio?.contextState === "running"
          && audio?.thunder?.pendingCloseStrikeCount === 0
          && audio?.thunder?.closeStrikeCount === beforeCount + 1;
      },
      scareAudioBefore.thunder.closeStrikeCount,
      { timeout: 8000 },
    );
    await audioPage.waitForTimeout(80);
    audioAfter = await audioPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert((audioAfter.cueCounts.stormScare || 0) - (scareAudioBefore.cueCounts.stormScare || 0) === 1, `the tree-line apparition must retain its dedicated scare sting across an audio interruption: ${JSON.stringify(audioAfter.cueCounts)}`);
    assert((audioAfter.cueCounts.thunderClose || 0) - (scareAudioBefore.cueCounts.thunderClose || 0) === 1, `the apparition must emit the close-bolt recorded profile: ${JSON.stringify(audioAfter.cueCounts)}`);
    assert((audioAfter.cueCounts.thunder || 0) - (scareAudioBefore.cueCounts.thunder || 0) === 1, `the apparition must also emit the recorded thunder layer: ${JSON.stringify(audioAfter.cueCounts)}`);
    assert(audioAfter.thunder.playCount === scareAudioBefore.thunder.playCount + 1 && audioAfter.thunder.closeStrikeCount === scareAudioBefore.thunder.closeStrikeCount + 1, `the unmuted browser must schedule the apparition's recorded close-thunder profile: before=${JSON.stringify(scareAudioBefore.thunder)} after=${JSON.stringify(audioAfter.thunder)}`);
    assert(audioAfter.thunder.lastProfile === "storm-run" && audioAfter.thunder.lastVolumeMultiplier >= 2 && audioAfter.thunder.lastDelay <= 0.05, `the apparition must use the louder immediate Storm Run mix: ${JSON.stringify(audioAfter.thunder)}`);
    assert(audioAfter.thunder.lastContextStateAtPlayback === "running" && audioAfter.thunder.closeStrikeLayerCount === 0 && audioAfter.thunder.crackNoiseProfile === "recorded-only", `the live scare must preserve the loud recorded thunder without adding a static-like procedural crack: ${JSON.stringify(audioAfter.thunder)}`);
    assert(audioAfter.thunder.queuedCloseStrikeCount === scareAudioBefore.thunder.queuedCloseStrikeCount + 1 && audioAfter.thunder.resumedCloseStrikeCount === scareAudioBefore.thunder.resumedCloseStrikeCount + 1, `the interrupted close bolt must replay exactly once after the next trusted gesture: ${JSON.stringify(audioAfter.thunder)}`);
    assert(audioAfter.thunder.rainDuckCount === scareAudioBefore.thunder.rainDuckCount + 1 && audioAfter.rain.duckCount === audioAfter.thunder.rainDuckCount, `the close crack must duck the masking rain exactly once: ${JSON.stringify({ thunder: audioAfter.thunder, rain: audioAfter.rain })}`);
    assert(audioAfter.rain.duckActive && audioAfter.rain.duckTargetGain <= 0.18 && audioAfter.rain.duckGain < 0.75, `the rain bus must be in its authored deeper-duck window during the louder close crack: ${JSON.stringify(audioAfter.rain)}`);
    if (audioAfter.thunder.variantsReady > 0) assert(audioAfter.thunder.lastRollOffset >= 0.2, `the recorded roll must skip its quiet leading pad: ${JSON.stringify(audioAfter.thunder)}`);
    assert(audioErrors.length === 0, `unmuted Storm Run audio page produced console errors: ${JSON.stringify(audioErrors)}`);
    await audioContext.close();

    const restoreContext = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const restorePage = await restoreContext.newPage();
    const restoreErrors = [];
    watchErrors(restorePage, restoreErrors);
    await bootPage(restorePage);
    await callAndStartStorm(restorePage);
    await restorePage.evaluate(() => window.MrFeastFresh.completeStormRunWithAftermathForQA("player"));
    await restorePage.evaluate(() => window.MrFeastFresh.advanceStormRunCastForQA(20));
    let restoreDiagnostics = await diagnostics(restorePage);
    const walkingJuniper = restoreDiagnostics.contestants.entries.find((entry) => entry.id === "juniper-cross");
    const openedTerraceDoor = restoreDiagnostics.interactions.exteriorDoors.find((entry) => entry.name === "right terrace door");
    assert(walkingJuniper?.aftermathReturn?.active && openedTerraceDoor?.open, `the save/load regression must catch Juniper during her temporary door-opening route: ${JSON.stringify({ walkingJuniper, openedTerraceDoor })}`);
    assert(await restorePage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving during the Storm Run aftermath should succeed");
    assert(await restorePage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading during the Storm Run aftermath should succeed");
    restoreDiagnostics = await diagnostics(restorePage);
    const restoredJuniper = restoreDiagnostics.contestants.entries.find((entry) => entry.id === "juniper-cross");
    const restoredTerraceDoor = restoreDiagnostics.interactions.exteriorDoors.find((entry) => entry.name === "right terrace door");
    assert(restoreDiagnostics.stormRun.phase === "completed" && !restoreDiagnostics.stormRun.aftermath.active, `an aftermath save must normalize to the completed investigation state: ${JSON.stringify(restoreDiagnostics.stormRun)}`);
    assert(!restoreDiagnostics.contestants.challengeActive && !restoredJuniper?.aftermathReturn, `loading must clear Juniper's interrupted return route: ${JSON.stringify(restoredJuniper)}`);
    assert(!restoredTerraceDoor?.open, `loading must close a door opened only for Juniper's interrupted return route: ${JSON.stringify(restoredTerraceDoor)}`);
    assert(restoreErrors.length === 0, `aftermath restore page produced console errors: ${JSON.stringify(restoreErrors)}`);
    await restoreContext.close();

    const winContext = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const winPage = await winContext.newPage();
    const winErrors = [];
    watchErrors(winPage, winErrors);
    await bootPage(winPage);
    await callAndStartStorm(winPage);
    assert(await winPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving during Storm Run should succeed");
    assert(await winPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading a live Storm Run save should succeed");
    let restored = await stormState(winPage);
    assert(restored.phase === "called" && restored.reportRemaining === 300 && restored.hostWaiting && restored.completedCheckpoints === 0 && restored.raceElapsed === 0 && !restored.scare.hostVisible, `live saves must normalize to a clean five-minute production call: ${JSON.stringify(restored)}`);
    await winPage.evaluate(() => window.MrFeastFresh.startStormRunForQA());
    await winPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(16));
    const won = await winPage.evaluate(() => window.MrFeastFresh.completeStormRunWithAftermathForQA("player"));
    assert(won.survived === true && won.eliminatedContestantId === "mara-voss", `player victory must eliminate Mara: ${JSON.stringify(won)}`);
    let wonState = await stormState(winPage);
    assert(wonState.phase === "completed" && !wonState.clueProgressLocked, `winning must reopen investigation: ${JSON.stringify(wonState)}`);
    assert(wonState.aftermath.active && wonState.aftermath.stage === "result-speaking", `winning must begin the witnessed back-door aftermath: ${JSON.stringify(wonState.aftermath)}`);
    assert(Math.abs(wonState.aftermath.finishAnchor.x) <= 1 && wonState.aftermath.finishAnchor.z >= -15 && wonState.aftermath.finishAnchor.z <= -13, `the ending must be staged on the rear terrace at the back door: ${JSON.stringify(wonState.aftermath.finishAnchor)}`);
    let castAfterWin = await winPage.evaluate(() => window.MrFeastFresh.getContestantState());
    let maraAfterWin = castAfterWin.entries.find((entry) => entry.id === "mara-voss");
    let juniperAfterWin = castAfterWin.entries.find((entry) => entry.id === "juniper-cross");
    assert(castAfterWin.challengeMode === "storm-run-aftermath", `the finish cast must remain staged during Mara's loss: ${JSON.stringify(castAfterWin.challengeMode)}`);
    assert(!maraAfterWin.eliminated && maraAfterWin.modelVisible && !maraAfterWin.colliderEnabled && !maraAfterWin.interactionRegistered, `Mara must remain visible but unavailable during her scripted loss: ${JSON.stringify(maraAfterWin)}`);
    assert(maraAfterWin.challengeResponse?.action === "cover-face" && maraAfterWin.challengeResponse.motion?.kind === "cover-face", `Mara needs a dedicated hands-over-face loss pose: ${JSON.stringify(maraAfterWin.challengeResponse)}`);
    assert(maraAfterWin.challengeResponse.motion.upperBodyMaximumAngleDegrees >= 25, `Mara's grief pose must visibly raise and fold both arms: ${JSON.stringify(maraAfterWin.challengeResponse.motion)}`);
    assert(maraAfterWin.challengeResponse.motion.faceCoverHandDistances?.left <= 0.34 && maraAfterWin.challengeResponse.motion.faceCoverHandDistances?.right <= 0.34, `both of Mara's hands must reach her face: ${JSON.stringify(maraAfterWin.challengeResponse.motion.faceCoverHandDistances)}`);
    assert(!juniperAfterWin.eliminated && juniperAfterWin.modelVisible && juniperAfterWin.aftermathReturn?.active, `Juniper must survive Game 2 and start walking home: ${JSON.stringify(juniperAfterWin)}`);
    let aftermathDiagnostics = await diagnostics(winPage);
    assert(aftermathDiagnostics.speech?.speakerId === "mr-feast" && /twelve checkpoints, three contestants, one vacancy/i.test(aftermathDiagnostics.speech.text || "") && /all that strategy/i.test(aftermathDiagnostics.speech.text || ""), `Mr. Feast must deliver the sharper authored result before Mara answers: ${JSON.stringify(aftermathDiagnostics.speech)}`);

    await winPage.evaluate(() => window.MrFeastFresh.previewStormRunAftermathForQA());
    await winPage.waitForTimeout(180);
    wonState = await stormState(winPage);
    assert(wonState.aftermath.sceneOnScreen, `the authored finish view must clearly frame Mara: ${JSON.stringify(wonState.aftermath)}`);
    await winPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "mara-back-door-elimination.png") });

    await winPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(6.5));
    aftermathDiagnostics = await diagnostics(winPage);
    assert(aftermathDiagnostics.stormRun.aftermath.stage === "mara-speaking" && aftermathDiagnostics.speech?.speakerId === "mara-voss", `Mara must answer after the result announcement: ${JSON.stringify({ aftermath: aftermathDiagnostics.stormRun.aftermath, speech: aftermathDiagnostics.speech })}`);
    assert(/every lightning flash/i.test(aftermathDiagnostics.speech.text || "") && /counting survivors/i.test(aftermathDiagnostics.speech.text || ""), `Mara's last line must connect the impossible sightings to the missing contestants: ${JSON.stringify(aftermathDiagnostics.speech?.text)}`);
    await winPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "mara-back-door-cover-face.png") });
    await winPage.setViewportSize({ width: 390, height: 844 });
    await winPage.waitForTimeout(120);
    wonState = await stormState(winPage);
    assert(wonState.aftermath.sceneOnScreen, `the Mara aftermath must remain framed on a portrait phone: ${JSON.stringify(wonState.aftermath)}`);
    await winPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "mara-back-door-cover-face-mobile.png") });
    await winPage.setViewportSize({ width: 1280, height: 820 });
    await winPage.waitForTimeout(120);

    await winPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(7.3));
    await winPage.evaluate(() => window.MrFeastFresh.advanceStormRunCastForQA(70));
    aftermathDiagnostics = await diagnostics(winPage);
    const returnedJuniper = aftermathDiagnostics.contestants.entries.find((entry) => entry.id === "juniper-cross");
    assert(!returnedJuniper?.aftermathReturn && !returnedJuniper?.challengeStaged && returnedJuniper?.position.y >= 4.4 && returnedJuniper?.position.x > 5, `Juniper must physically return to her Reading Room routine: ${JSON.stringify(returnedJuniper)}`);
    assert(aftermathDiagnostics.stormRun.aftermath.active && aftermathDiagnostics.stormRun.aftermath.stage === "waiting-for-player-exit", `Mara must remain while the player stays beside the finish: ${JSON.stringify(aftermathDiagnostics.stormRun.aftermath)}`);

    await winPage.evaluate(() => window.MrFeastFresh.teleport("rearLounge"));
    await winPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.2));
    aftermathDiagnostics = await diagnostics(winPage);
    const hostJustInsideBackDoor = await winPage.evaluate(() => window.MrFeastFresh.getMrFeastState());
    assert(aftermathDiagnostics.stormRun.aftermath.active && !aftermathDiagnostics.stormRun.aftermath.playerHasLeft, `walking just inside the back door must not dismiss the witnessed ending: ${JSON.stringify(aftermathDiagnostics.stormRun.aftermath)}`);
    assert(hostJustInsideBackDoor.challengeStaged && hostJustInsideBackDoor.modelVisible, `Mr. Feast must stay visibly staged at the back door while the nearby player is indoors: ${JSON.stringify(hostJustInsideBackDoor)}`);

    await winPage.evaluate(() => window.MrFeastFresh.teleport("readingRoom"));
    await winPage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.2));
    aftermathDiagnostics = await diagnostics(winPage);
    maraAfterWin = aftermathDiagnostics.contestants.entries.find((entry) => entry.id === "mara-voss");
    assert(!aftermathDiagnostics.stormRun.aftermath.active && /player-left:SECOND FLOOR:READING ROOM/.test(aftermathDiagnostics.stormRun.aftermath.cleanupReason || ""), `moving far upstairs must resolve the offscreen back-door aftermath: ${JSON.stringify(aftermathDiagnostics.stormRun.aftermath)}`);
    assert(maraAfterWin.eliminated && !maraAfterWin.modelVisible && !maraAfterWin.colliderEnabled && !maraAfterWin.interactionRegistered, `Mara must disappear only after the player leaves the witnessed scene: ${JSON.stringify(maraAfterWin)}`);
    assert(!aftermathDiagnostics.stormRun.staging.host && !aftermathDiagnostics.contestants.challengeActive, `Mr. Feast must resume normal pathing after the offscreen cleanup: ${JSON.stringify({ staging: aftermathDiagnostics.stormRun.staging, challengeMode: aftermathDiagnostics.contestants.challengeMode })}`);
    assert(await winPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "completed Storm Run should save");
    assert(await winPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "completed Storm Run should load");
    restored = await stormState(winPage);
    assert(restored.phase === "completed" && restored.eliminatedContestantId === "mara-voss", `Mara elimination must persist: ${JSON.stringify(restored)}`);
    assert(restored.aftermath.postGameDialoguePendingIds.includes("juniper-cross"), `Juniper's first post-race line must survive save/load: ${JSON.stringify(restored.aftermath)}`);
    const juniperFirstTalk = await winPage.evaluate(() => window.MrFeastFresh.converseWithContestantForQA("juniper-cross"));
    let juniperConversation = await diagnostics(winPage);
    let juniperEntry = juniperConversation.contestants.entries.find((entry) => entry.id === "juniper-cross");
    assert(juniperFirstTalk?.speakerId === "juniper-cross" && /three places, one heartbeat/i.test(juniperFirstTalk.text || "") && /does not cross the ground/i.test(juniperFirstTalk.text || ""), `Juniper's first post-Storm Run conversation must interpret the lightning sightings: ${JSON.stringify(juniperFirstTalk)}`);
    assert(juniperEntry?.dialogue.lastKind === "storm-run-aftermath" && !juniperConversation.stormRun.aftermath.postGameDialoguePendingIds.includes("juniper-cross"), `Juniper's Storm Run follow-up must be consumed exactly once: ${JSON.stringify({ juniperEntry, aftermath: juniperConversation.stormRun.aftermath })}`);
    const juniperSecondTalk = await winPage.evaluate(() => window.MrFeastFresh.converseWithContestantForQA("juniper-cross"));
    juniperConversation = await diagnostics(winPage);
    juniperEntry = juniperConversation.contestants.entries.find((entry) => entry.id === "juniper-cross");
    assert(juniperSecondTalk?.text !== juniperFirstTalk.text && juniperEntry?.dialogue.lastKind !== "storm-run-aftermath", `Juniper's new Storm Run line must not repeat on the second conversation: ${JSON.stringify({ first: juniperFirstTalk, second: juniperSecondTalk, juniperEntry })}`);
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
    await phonePage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0));
    const phoneFaceToFace = await briefingFacing(phonePage);
    assert(phoneFaceToFace.distance >= 1.2 && phoneFaceToFace.hostForwardDot >= 0.96 && phoneFaceToFace.playerForwardDot >= 0.96, `the phone rear-door briefing must keep Mr. Feast face-to-face with the held player: ${JSON.stringify(phoneFaceToFace)}`);
    const phoneBriefing = await stormState(phonePage);
    assert(phoneBriefing.briefing?.lighting?.active, `the phone must receive the same temporary Storm Run intro-lighting lift: ${JSON.stringify(phoneBriefing.briefing?.lighting)}`);
    assert(phoneBriefing.briefing?.lighting?.moonPose === "storm-run-briefing", `the phone briefing must keep the player-side moon key: ${JSON.stringify(phoneBriefing.briefing?.lighting)}`);
    const phoneSpeechSkip = phonePage.locator("#mansion-speech-skip");
    assert(!(await phoneSpeechSkip.isVisible()), "the phone Storm Run briefing must not show a speech-bubble Skip button");
    const phonePrompt = phonePage.locator("#mansion-prompt");
    assert(await phonePrompt.isVisible(), "the phone Storm Run briefing must expose E/tap Skip immediately");
    const phonePromptBounds = await phonePrompt.boundingBox();
    assert(phonePromptBounds?.width >= 44 && phonePromptBounds?.height >= 44, `the phone Storm Run Skip prompt must remain at least 44px: ${JSON.stringify(phonePromptBounds)}`);
    await phonePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "storm-run-rear-door-briefing-mobile.png") });
    await phonePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "storm-run-bright-intro-mobile.png") });
    await phonePage.locator("#touch-interact").click({ force: true });
    await phonePage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(3.1));
    await phonePage.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "running", null, { timeout: 8000 });
    await assertHudFits(phonePage, true);
    await phonePage.screenshot({ path: path.join(artifactDir, "storm-run-mobile.png") });
    const phoneFirstCheckpoint = await collectCheckpoint(phonePage, 0);
    assert(phoneFirstCheckpoint.accepted === true, `phone scare setup checkpoint one should collect in order: ${JSON.stringify(phoneFirstCheckpoint)}`);
    const phoneSecondCheckpoint = await collectCheckpoint(phonePage, 1);
    assert(phoneSecondCheckpoint.accepted === true, `phone scare setup checkpoint two should unlock the later first scare: ${JSON.stringify(phoneSecondCheckpoint)}`);
    const phoneNorthwestComposition = await phonePage.evaluate(() => window.MrFeastFresh.previewStormScareForQA(0));
    assert(phoneNorthwestComposition?.onScreen && phoneNorthwestComposition.lineOfSight && phoneNorthwestComposition.projectedHeight >= 0.075 && phoneNorthwestComposition.projectedHeight <= 0.11, `the northwest tree-line apparition must remain human-sized in the phone camera from the later approach: ${JSON.stringify(phoneNorthwestComposition)}`);
    await triggerScareThroughFacingGate(phonePage, 0, "northwest-tree-line");
    await phonePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "mr-feast-northwest-tree-line-lightning-mobile.png") });
    await phonePage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(1.25));
    for (let index = 3; index <= 3; index += 1) {
      const collected = await collectCheckpoint(phonePage, index);
      assert(collected.accepted === true, `phone second-scare setup checkpoint ${index + 1} should collect in order: ${JSON.stringify(collected)}`);
    }
    const phoneNortheastComposition = await phonePage.evaluate(() => window.MrFeastFresh.previewStormScareForQA(1));
    assert(phoneNortheastComposition?.onScreen && phoneNortheastComposition.lineOfSight && phoneNortheastComposition.projectedHeight >= 0.055 && phoneNortheastComposition.projectedHeight <= 0.085, `the northeast tree-line apparition must remain human-sized in the phone camera from the front door: ${JSON.stringify(phoneNortheastComposition)}`);
    await triggerScareThroughFacingGate(phonePage, 1, "northeast-tree-line");
    await phonePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "mr-feast-northeast-tree-line-lightning-mobile.png") });
    await phonePage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(1.25));
    for (let index = 4; index <= 8; index += 1) {
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
    const phoneMazeCheckpoint = await collectCheckpoint(phonePage, 9);
    assert(phoneMazeCheckpoint.accepted === true && phoneMazeCheckpoint.completed === 10, `the phone maze checkpoint must arm the final mapped scare: ${JSON.stringify(phoneMazeCheckpoint)}`);
    const phoneMazeComposition = await phonePage.evaluate(() => window.MrFeastFresh.previewStormScareForQA(2));
    assert(phoneMazeComposition?.onScreen && phoneMazeComposition.lineOfSight && phoneMazeComposition.projectedHeight >= 0.1, `the final-straight apparition must remain readable at the far end on a phone: ${JSON.stringify(phoneMazeComposition)}`);
    await triggerScareThroughFacingGate(phonePage, 2, "maze-turn");
    await phonePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "mr-feast-final-straight-lightning-mobile.png") });
    await phonePage.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(1.25));
    const lost = await phonePage.evaluate(() => window.MrFeastFresh.completeStormRunForQA("mara"));
    assert(lost.survived === false && lost.eliminatedContestantId === "player" && !lost.aftermathActive, `Mara finishing first must eliminate the player without starting a survivor aftermath: ${JSON.stringify(lost)}`);
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
    console.error(`Mr. Feast Storm Run event checks failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
