import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_FEAST_SAYS_TEST_PORT || (53600 + (process.pid % 10000)));
const baseUrl = `http://127.0.0.1:${port}`;
const introUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&allLights=1`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-feast-says");
const FEAST_COMMAND_FLOW = Object.freeze([
  Object.freeze({ action: "left", text: "Feast says step left.", obey: true }),
  Object.freeze({ action: "right", text: "Step right.", obey: false }),
  Object.freeze({ action: "back", text: "Feast says step back.", obey: true }),
  Object.freeze({ action: "crouch", text: "Crouch.", obey: false }),
  Object.freeze({ action: "point", text: "Feast says point to the contestant you distrust most.", obey: true }),
  Object.freeze({ action: "approach", text: "Feast says step toward the contestant you would sacrifice.", obey: true }),
]);
const FEAST_TARGET_IDS = new Set(["mara-voss", "kip-solano", "juniper-cross", "player"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function angleDistance(a, b) {
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
    const ignoredExternalAsset = /favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text());
    if (message.type() === "error" && !ignoredExternalAsset) errors.push(message.text());
  });
}

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function feastState(page) {
  return page.evaluate(() => window.MrFeastFresh.getFeastSaysState());
}

function assertLiveProductionCamera(state, label, lockedFilmSet = null) {
  const filmSet = state.feastSays?.filmSet;
  const camera = filmSet?.camera;
  const lights = filmSet?.lights;
  const floorMarkers = state.feastSays?.floorMarkers;
  assert(
    floorMarkers?.lineupRingCount === 0 && floorMarkers?.actionPadCount === 0,
    `${label} must keep the authored lineup positions logic-only, without colored floor circles or action pads; got ${JSON.stringify(floorMarkers)}`,
  );
  assert(filmSet?.visible && camera?.visible, `${label} must keep the production camera visible while Feast Says is live; got ${JSON.stringify(filmSet)}`);
  assert(camera?.model === "long-lens-cinema-pedestal" && camera?.profile === "long-lens-cinema", `${label} must use the long-lens cinema broadcast silhouette; got ${JSON.stringify(camera)}`);
  assert(
    Array.isArray(camera?.components)
      && ["body", "matte-box", "lens-rails", "rear-battery", "viewfinder", "monitor", "pan-handle", "pedestal"].every((component) => camera.components.includes(component)),
    `${label} must expose the readable long-lens cinema camera components; got ${JSON.stringify(camera)}`,
  );
  assert(camera.dimensions?.bodyDepth >= camera.dimensions?.bodyWidth * 1.3, `${label} must use a narrow, visibly longer camera body; got ${JSON.stringify(camera.dimensions)}`);
  assert(camera.dimensions?.lensProjection >= 0.75 && camera.dimensions?.overallLength >= 2.3, `${label} must expose a clearly long lens and overall cinema-rig profile; got ${JSON.stringify(camera.dimensions)}`);
  assert(camera.horizontalDistanceToTarget >= 2.75, `${label} must keep the Feast Says camera about two feet back from the player lineup; got ${JSON.stringify(camera)}`);
  assert(camera.subject === "player-contestant-lineup" && camera.locked === true, `${label} must keep the camera locked on the player/contestant lineup; got ${JSON.stringify(camera)}`);
  assert(camera.facingTargetDot >= 0.94, `${label} must actually point its lens toward the player/contestant lineup; got ${JSON.stringify(camera)}`);
  assert(lights?.subject === "player-contestant-lineup" && lights?.locked === true, `${label} must lock its studio-light aim to the player/contestant lineup; got ${JSON.stringify(lights)}`);
  assert(
    Array.isArray(lights?.fixtures)
      && lights.fixtures.length === 2
      && lights.fixtures.every((fixture) => fixture.visible && fixture.facingTargetDot >= 0.94),
    `${label} must keep both physical studio lights facing the player lineup; got ${JSON.stringify(lights)}`,
  );
  if (lockedFilmSet) {
    const lockedCamera = lockedFilmSet.camera;
    const positionDrift = Math.hypot(
      camera.position.x - lockedCamera.position.x,
      camera.position.y - lockedCamera.position.y,
      camera.position.z - lockedCamera.position.z,
    );
    assert(positionDrift <= 0.001 && angleDistance(camera.yaw, lockedCamera.yaw) <= 0.001, `${label} must preserve the camera's locked pose; before=${JSON.stringify(lockedCamera)} after=${JSON.stringify(camera)}`);
    const lockedFixtures = lockedFilmSet.lights?.fixtures || [];
    for (const [index, fixture] of lights.fixtures.entries()) {
      const lockedFixture = lockedFixtures[index];
      const positionDrift = lockedFixture ? Math.hypot(
        fixture.position.x - lockedFixture.position.x,
        fixture.position.y - lockedFixture.position.y,
        fixture.position.z - lockedFixture.position.z,
      ) : Infinity;
      assert(
        positionDrift <= 0.001 && angleDistance(fixture.yaw, lockedFixture.yaw) <= 0.001,
        `${label} must preserve studio-light ${index + 1}'s locked player-facing pose; before=${JSON.stringify(lockedFixture)} after=${JSON.stringify(fixture)}`,
      );
    }
  }
  return { camera, lights };
}

async function waitForPaintFrames(page, count = 2) {
  await page.evaluate((frameCount) => new Promise((resolve) => {
    let remaining = Math.max(1, Number(frameCount) || 1);
    const next = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }), count);
}

async function assertStableCommandPaint(page, command, label) {
  await waitForPaintFrames(page, 2);
  const paint = await page.evaluate(() => {
    const commandElement = document.getElementById("mansion-feast-command");
    const hintElement = document.getElementById("mansion-feast-hint");
    const speech = document.getElementById("mansion-speech");
    const panel = document.getElementById("mansion-feast-says");
    const commandStyle = getComputedStyle(commandElement);
    const hintStyle = getComputedStyle(hintElement);
    const speechStyle = getComputedStyle(speech);
    return {
      commandText: commandElement.textContent,
      hintText: hintElement.textContent,
      commandDisplay: commandStyle.display,
      hintDisplay: hintStyle.display,
      speechDisplay: speechStyle.display,
      speechHidden: speech.hidden,
      speechSpeaker: document.getElementById("mansion-speech-speaker").textContent,
      speechText: document.getElementById("mansion-speech-text").textContent,
      speechRect: speech.getBoundingClientRect().toJSON(),
      panelHeight: panel.getBoundingClientRect().height,
    };
  });
  assert(
    paint.commandText === ""
      && paint.commandDisplay === "none"
      && paint.hintText === ""
      && paint.hintDisplay === "none",
    `${label} must not duplicate Mr. Feast's instruction in the minimal HUD; got ${JSON.stringify(paint)}`,
  );
  assert(
    !paint.speechHidden
      && paint.speechDisplay !== "none"
      && /mr\.?\s*feast/i.test(paint.speechSpeaker)
      && paint.speechText === (command.spokenText || command.text)
      && paint.speechRect.width > 0
      && paint.speechRect.height > 0,
    `${label} must render the complete command through Mr. Feast's visible speech; got ${JSON.stringify(paint)}`,
  );
  assert(paint.panelHeight <= 58, `${label} should leave only a shallow status strip; got ${JSON.stringify(paint)}`);
  return paint;
}

async function bootPage(page, url = gameUrl, { waitForCast = true } = {}) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
  if (waitForCast) {
    await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState?.()?.loadStatus === "ready", null, { timeout: 120000 });
    await page.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
  }
  const feastAvailability = await page.evaluate(() => ({
    available: Boolean(window.MrFeastFresh.getFeastSaysState?.()),
    keys: Object.keys(window.MrFeastFresh || {}).filter((key) => /feast/i.test(key)),
    runtimeVersion: window.render_game_to_text ? JSON.parse(window.render_game_to_text()).runtimeVersion : null,
    script: document.querySelector('script[src*="mr-feast-mansion.js"]')?.src || null,
  }));
  assert(feastAvailability.available, `Feast Says diagnostics did not install: ${JSON.stringify(feastAvailability)}`);
  await page.waitForTimeout(200);
}

async function pressInteract(page) {
  await page.evaluate(() => {
    const canvas = document.getElementById("mansion-canvas");
    canvas.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", key: "e", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyE", key: "e", bubbles: true }));
  });
  await page.waitForTimeout(120);
}

async function teleportForInteraction(page, view, promptPattern = null) {
  await page.evaluate((name) => window.MrFeastFresh.teleport(name), view);
  await page.evaluate(() => window.advanceTime(120));
  if (!promptPattern) return;
  try {
    await page.waitForFunction(
      ({ source, flags }) => new RegExp(source, flags).test(JSON.parse(window.render_game_to_text()).prompt || ""),
      { source: promptPattern.source, flags: promptPattern.flags },
      { timeout: 8000, polling: 100 },
    );
  } catch (_) {
    const state = await diagnostics(page);
    throw new Error(`${view} did not expose ${promptPattern}; prompt=${JSON.stringify(state.prompt)} ray=${JSON.stringify(state.interactionRay)}`);
  }
}

async function aimAtFeastContestant(page, targetId, { expectPrompt = false, expectAimDiagnostic = expectPrompt } = {}) {
  assert(FEAST_TARGET_IDS.has(targetId) && targetId !== "player", `cannot aim at unknown contestant ${targetId}`);
  const aim = await page.evaluate((id) => ({
    available: typeof window.MrFeastFresh.aimFeastSaysTargetForQA === "function",
    result: window.MrFeastFresh.aimFeastSaysTargetForQA?.(id) || null,
  }), targetId);
  assert(aim.available, "the live look-selection contract needs aimFeastSaysTargetForQA");
  assert(aim.result?.targetId === targetId, `the focused camera hook should aim at ${targetId}; got ${JSON.stringify(aim)}`);
  await page.evaluate(() => window.advanceTime(80));
  const state = await diagnostics(page);
  if (expectAimDiagnostic) {
    assert(state.feastSays.player.aimedTargetId === targetId, `the point-command camera ray should identify ${targetId}; aim=${JSON.stringify(aim)} player=${JSON.stringify(state.feastSays.player)}`);
  }
  if (expectPrompt) {
    assert(/point|select/i.test(state.prompt || "") && new RegExp(targetId.split("-")[0], "i").test(state.prompt || ""), `looking at ${targetId} should expose its point interaction; prompt=${JSON.stringify(state.prompt)} ray=${JSON.stringify(state.interactionRay)}`);
  }
  return state;
}

async function startBallroomRound(page, useTouch = false, { skipBriefing = false } = {}) {
  await teleportForInteraction(page, "feastSaysStaging", /feast says|take your mark|begin|join/i);
  if (useTouch) await page.locator("#touch-interact").click({ force: true });
  else await pressInteract(page);
  await page.waitForFunction(() => window.MrFeastFresh.getFeastSaysState?.()?.phase === "briefing", null, { timeout: 8000 });
  const briefing = await diagnostics(page);
  assert(
    briefing.speech?.speakerId === "mr-feast"
      && /only follow.*(?:if|when).*feast says/i.test(briefing.speech.text || "")
      && /look.*press E/i.test(briefing.speech.text || "")
      && /lowest score.*eliminated/i.test(briefing.speech.text || ""),
    `Mr. Feast should verbally explain the rule and special choice control before naming any rival; got ${JSON.stringify(briefing.speech)}`,
  );
  assert(!/kip|beat\s+\w+/i.test(briefing.speech.text || ""), `the briefing must not spoil the authored loser or tell the player whom to beat; got ${JSON.stringify(briefing.speech.text)}`);
  assert(briefing.feastSays.instructionDelivery === "speech" && briefing.feastSays.ui?.minimal && briefing.feastSays.ui?.command === null, `the briefing HUD must defer completely to Mr. Feast's speech; got ${JSON.stringify(briefing.feastSays.ui)}`);
  if (skipBriefing) {
    const speechSkip = page.locator("#mansion-speech-skip");
    assert(!(await speechSkip.isVisible()), "Feast Says rules must not use a speech-bubble Skip button");
    assert(!briefing.speech.skippable && briefing.speech.skipLabel == null, `Feast Says rules speech must not be bubble-skippable; got ${JSON.stringify(briefing.speech)}`);
    assert(briefing.feastSays.canSkipBriefing === true, `Feast Says E/tap skip must be available immediately; got ${JSON.stringify(briefing.feastSays)}`);
    const prompt = page.locator("#mansion-prompt");
    assert(await prompt.isVisible(), "Feast Says rules must expose an immediate E/tap Skip prompt");
    const promptText = await page.locator("#mansion-prompt-text").textContent();
    assert(/skip/i.test(promptText || ""), `Feast Says E prompt should advertise Skip; got ${JSON.stringify(promptText)}`);
    if (useTouch) await page.locator("#touch-interact").click({ force: true });
    else await pressInteract(page);
  }
  const briefingCamera = assertLiveProductionCamera(briefing, "Feast Says briefing");
  if (!useTouch) {
    const beforeBriefingMove = await diagnostics(page);
    await page.keyboard.down("w");
    await page.waitForTimeout(260);
    await page.keyboard.up("w");
    const afterBriefingMove = await diagnostics(page);
    const briefingDrift = Math.hypot(
      afterBriefingMove.player.x - beforeBriefingMove.player.x,
      afterBriefingMove.player.z - beforeBriefingMove.player.z,
    );
    assert(briefingDrift <= 0.03, `the player must remain on their mark during the briefing; drift=${briefingDrift}`);
  }
  if (!skipBriefing) {
    await page.evaluate(
      (seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds),
      briefing.feastSays.phaseRemaining + 0.02,
    );
  }
  await page.waitForFunction(() => {
    const current = window.MrFeastFresh.getFeastSaysState?.();
    return current?.phase === "command" && current?.command;
  }, null, { timeout: 8000 });
  const state = await diagnostics(page);
  assert(state.room === "BALLROOM", `Feast Says must begin in the Ballroom; got room=${state.room}`);
  assert(state.feastSays.staging?.contestantsReady === true, `all contestants should be staged before play; got ${JSON.stringify(state.feastSays.staging)}`);
  assert(state.speech?.speakerId === "mr-feast" && state.speech?.text === state.feastSays.command.spokenText, `Mr. Feast should visibly deliver the complete live command; got ${JSON.stringify(state.speech)}`);
  assertLiveProductionCamera(state, "Feast Says opening command", briefingCamera);
  const responseStart = state.contestants.entries.map((entry) => entry.challengeResponse?.progress).filter(Number.isFinite);
  assert(responseStart.length === 3 && responseStart.every((progress) => progress >= 0 && progress < 0.35), `contestants should begin each eased response near their marks; got ${JSON.stringify(responseStart)}`);
  await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.18));
  const responseMidState = await diagnostics(page);
  const responseMid = responseMidState.contestants.entries.map((entry) => entry.challengeResponse?.progress).filter(Number.isFinite);
  assert(responseMid.some((progress) => progress > 0 && progress < 1), `contestant actions should ease instead of snapping; got ${JSON.stringify(responseMid)}`);
  assertContestantLocomotionInFlight(responseMidState.feastSays.command, responseMidState);
  await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.8));
  const settled = await diagnostics(page);
  const responseEnd = settled.contestants.entries.map((entry) => entry.challengeResponse?.progress).filter(Number.isFinite);
  assert(responseEnd.length === 3 && responseEnd.every((progress) => progress === 1), `contestant responses should reach their authored poses; got ${JSON.stringify(responseEnd)}`);
  assert(settled.feastSays.command.text === FEAST_COMMAND_FLOW[0].text && settled.feastSays.command.action === "left", `the live round should open with the plain left-step instruction; got ${JSON.stringify(settled.feastSays.command)}`);
  assert(settled.feastSays.command.obey === true && !settled.feastSays.command.targetByAction, `the ordered deck should contain only genuine instructions and no directional name map; got ${JSON.stringify(settled.feastSays.command)}`);
  assertContestantResponseMotion(settled.feastSays.command, settled);
  const liveRegionMutations = await page.evaluate(async () => {
    const targets = ["mansion-feast-command", "mansion-feast-score", "mansion-feast-standings"]
      .map((id) => document.getElementById(id));
    let count = 0;
    const observer = new MutationObserver((records) => { count += records.length; });
    for (const target of targets) observer.observe(target, { childList: true, characterData: true, subtree: true });
    await new Promise((resolve) => setTimeout(resolve, 180));
    observer.disconnect();
    return count;
  });
  assert(liveRegionMutations === 0, `static command and score live regions should not mutate every frame; got ${liveRegionMutations}`);
  await assertStableCommandPaint(page, state.feastSays.command, "opening speech-led command");
  return settled;
}

function wrongActionFor(expectedAction) {
  if (expectedAction === "point") return "crouch";
  return expectedAction === "crouch" ? "stand" : "crouch";
}

function assertContestantResponseMotion(command, state) {
  const responders = state.contestants.entries.filter((entry) => entry.challengeResponse?.action !== "still");
  assert(responders.length > 0, `round ${command.index + 1} should visibly move at least one contestant; got ${JSON.stringify(state.contestants.entries.map((entry) => entry.challengeResponse))}`);
  for (const entry of responders) {
    const response = entry.challengeResponse;
    const motion = response.motion;
    assert(motion && motion.poseWeight >= 0.98, `${entry.id} ${response.action} needs a settled skeletal response pose; got ${JSON.stringify(response)}`);
    if (response.action === "point") {
      assert(response.targetId && FEAST_TARGET_IDS.has(response.targetId) && response.targetId !== entry.id, `${entry.id} must point at a different authored target, including the player where authored; got ${JSON.stringify(response)}`);
      assert(motion.kind === "point" && motion.upperBodyMaximumAngleDegrees >= 18, `${entry.id} point response must visibly raise an arm; got ${JSON.stringify(motion)}`);
    } else if (response.action === "crouch") {
      assert(motion.kind === "crouch" && motion.lowerBodyMaximumAngleDegrees >= 12, `${entry.id} crouch must bend the lower-body rig; got ${JSON.stringify(motion)}`);
      assert(motion.modelDrop >= 0.08 && motion.modelDrop <= 0.2, `${entry.id} crouch should combine a bounded root drop with bent knees instead of sinking the whole model; got ${JSON.stringify(motion)}`);
      assert(entry.animation.name === "idle", `${entry.id} crouch should use the planted idle base; got ${JSON.stringify(entry.animation)}`);
    } else if (response.action === "left" || response.action === "right") {
      assert(motion.kind === `sidestep-${response.action}`, `${entry.id} needs a directional sidestep pose; got ${JSON.stringify(motion)}`);
      assert(entry.animation.name === "idle", `${entry.id} should settle from its sidestep gait instead of walking in place; got ${JSON.stringify(entry.animation)}`);
      assert(motion.lowerBodyMaximumAngleDegrees >= 4 && Math.abs(motion.facingDeltaRadians) <= 0.03, `${entry.id} sidestep should move the legs while keeping Feast-facing staging; got ${JSON.stringify(motion)}`);
    } else if (response.action === "back") {
      assert(motion.kind === "backpedal", `${entry.id} backward response needs a dedicated backpedal state; got ${JSON.stringify(motion)}`);
      assert(entry.animation.name === "idle", `${entry.id} should settle from its reversed gait instead of walking in place; got ${JSON.stringify(entry.animation)}`);
      assert(motion.lowerBodyMaximumAngleDegrees >= 3 && Math.abs(motion.facingDeltaRadians) <= 0.03, `${entry.id} backpedal should preserve host-facing staging and add a readable lean; got ${JSON.stringify(motion)}`);
    } else if (response.action === "approach") {
      assert(response.targetId && FEAST_TARGET_IDS.has(response.targetId) && response.targetId !== entry.id, `${entry.id} must approach a different authored target; got ${JSON.stringify(response)}`);
      assert(motion.kind === "approach" && motion.markOffsetDistance >= 0.35, `${entry.id} should finish a visible target-directed approach rather than mime in place; got ${JSON.stringify(motion)}`);
      assert(entry.animation.name === "idle", `${entry.id} should finish the approach animation before the result hold; got ${JSON.stringify(entry.animation)}`);
    }
  }
}

function assertContestantLocomotionInFlight(command, state) {
  if (!["left", "right", "back", "approach"].includes(command.action)) return;
  const movers = state.contestants.entries.filter((entry) => (
    entry.challengeResponse?.action !== "still"
      && entry.challengeResponse?.progress > 0
      && entry.challengeResponse?.progress < 1
  ));
  assert(movers.length > 0, `round ${command.index + 1} needs an observable in-flight gait; got ${JSON.stringify(state.contestants.entries.map((entry) => entry.challengeResponse))}`);
  for (const entry of movers) {
    const response = entry.challengeResponse;
    if (response.action === "left" || response.action === "right") {
      assert(entry.animation.name === "idle", `${entry.id} ${response.action} should use the planted base while the mirrored lateral pose moves both legs; got ${JSON.stringify(entry.animation)}`);
      const minimumBlendedLegAngle = Math.max(0.2, response.motion.poseWeight * 6);
      assert(response.motion.kind === `sidestep-${response.action}` && response.motion.lowerBodyMaximumAngleDegrees >= minimumBlendedLegAngle, `${entry.id} ${response.action} should already show proportional lateral leg motion in flight; got ${JSON.stringify(response.motion)}`);
    } else {
      assert(entry.animation.name === "walk", `${entry.id} ${response.action} should use the walk clip while translating; got ${JSON.stringify(entry.animation)}`);
    }
    if (response.action === "back") {
      assert(entry.animation.playbackRate < 0, `${entry.id} backpedal should reverse the walk clip while moving outward; got ${JSON.stringify(entry.animation)}`);
      assert(response.motion.torsoTiltDegrees <= 25, `${entry.id} backpedal should read as an upright backward walk, not a fall; got ${JSON.stringify(response.motion)}`);
    } else if (response.action === "approach") {
      assert(entry.animation.playbackRate > 0, `${entry.id} ${response.action} should advance the walk clip while moving; got ${JSON.stringify(entry.animation)}`);
    }
  }
}

function assertAuthoredDecisionTargets(command, state) {
  if (!["point", "approach"].includes(command.action)) return;
  const authored = command.npcTargets || {};
  const targetIds = ["mara-voss", "kip-solano", "juniper-cross"].map((id) => authored[id]);
  assert(targetIds.every((id) => FEAST_TARGET_IDS.has(id)), `${command.action} must author a valid target for every NPC; got ${JSON.stringify(authored)}`);
  assert(new Set(targetIds).size === 3, `${command.action} choices should be individually authored instead of cloning one target; got ${JSON.stringify(authored)}`);
  for (const entry of state.contestants.entries.filter((candidate) => candidate.status === "ready" && candidate.challengeResponse?.action === command.action)) {
    assert(entry.challengeResponse.targetId === authored[entry.id], `${entry.id} should perform its authored ${command.action} choice; command=${JSON.stringify(authored)} response=${JSON.stringify(entry.challengeResponse)}`);
  }
}

function assertContestantResponsesReturned(state) {
  const responses = state.contestants.entries
    .filter((entry) => entry.status === "ready")
    .map((entry) => ({ id: entry.id, animation: entry.animation, response: entry.challengeResponse }));
  assert(responses.length > 0, "the staged cast should remain available through the response return");
  for (const { id, animation, response } of responses) {
    assert(response?.returning && response.progress === 0, `${id} should finish its eased return before the next command; got ${JSON.stringify(response)}`);
    assert(response.motion.poseWeight === 0 && response.motion.modelDrop === 0, `${id} should have no residual response pose after returning; got ${JSON.stringify(response.motion)}`);
    assert(response.motion.markOffsetDistance <= 0.01, `${id} should return to its mark without a next-round teleport; got ${JSON.stringify(response.motion)}`);
    assert(animation.name === "idle", `${id} should be idle after returning; got ${JSON.stringify(animation)}`);
  }
}

async function visibleSpeechBubble(page) {
  return page.evaluate(() => {
    const bubble = document.getElementById("mansion-speech");
    const speaker = document.getElementById("mansion-speech-speaker");
    const speechText = document.getElementById("mansion-speech-text");
    const stage = document.getElementById("mansion-stage");
    const panel = document.getElementById("mansion-feast-says");
    const plain = (rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const style = bubble ? getComputedStyle(bubble) : null;
    return {
      exists: Boolean(bubble),
      hidden: bubble?.hidden ?? true,
      display: style?.display || null,
      visibility: style?.visibility || null,
      opacity: Number(style?.opacity || 0),
      speaker: speaker?.textContent?.trim() || "",
      text: speechText?.textContent?.trim() || "",
      bubble: bubble ? plain(bubble.getBoundingClientRect()) : null,
      stage: stage ? plain(stage.getBoundingClientRect()) : null,
      panel: panel ? plain(panel.getBoundingClientRect()) : null,
      feastPhase: panel?.dataset.phase || null,
    };
  });
}

async function assertVisibleResultSpeech(page, speakerId, text, label) {
  await waitForPaintFrames(page, 2);
  const bubble = await visibleSpeechBubble(page);
  const expectedSpeaker = speakerId === "mr-feast"
    ? /mr\.?\s*feast/i
    : new RegExp(speakerId.split("-")[0], "i");
  assert(
    bubble.exists
      && !bubble.hidden
      && bubble.display !== "none"
      && bubble.visibility !== "hidden"
      && bubble.opacity > 0
      && bubble.bubble?.width > 0
      && bubble.bubble?.height > 0,
    `${label} must render as a visible speech bubble; got ${JSON.stringify(bubble)}`,
  );
  assert(bubble.feastPhase === "result", `${label} should remain inside the result phase; got ${JSON.stringify(bubble)}`);
  assert(expectedSpeaker.test(bubble.speaker) && bubble.text === text, `${label} should render the authored speaker and line; got ${JSON.stringify(bubble)}`);
  assertInside(bubble.bubble, bubble.stage, label);
  assert(bubble.panel && !rectanglesOverlap(bubble.bubble, bubble.panel), `${label} must not sit behind the Feast Says result card; got ${JSON.stringify(bubble)}`);
  return bubble;
}

async function finishReadableResult(page, command, { captureProof = false } = {}) {
  let state = await diagnostics(page);
  assert(state.feastSays.phase === "result", `round ${command.index + 1} should enter a judged result hold; got ${JSON.stringify(state.feastSays)}`);
  const resultCamera = assertLiveProductionCamera(state, `Feast Says result ${command.index + 1}`);
  const initialRemaining = state.feastSays.phaseRemaining;
  assert(initialRemaining >= 3.9, `round ${command.index + 1} should leave at least four readable seconds for animation and dialogue; remaining=${initialRemaining}`);
  assert(
    /^(?:mara-voss|kip-solano|juniper-cross)$/.test(command.contestantSpeakerId || "")
      && typeof command.contestantLine === "string"
      && command.contestantLine.length > 0,
    `round ${command.index + 1} needs authored contestant banter; got ${JSON.stringify(command)}`,
  );
  assert(
    state.speech?.speakerId === "mr-feast"
      && state.speech?.category === `feast-says-verdict-${command.index + 1}`
      && state.speech?.text === state.feastSays.resultDialogue?.verdictLine,
    `round ${command.index + 1} should begin with Mr. Feast's verbal verdict instead of result-card text; speech=${JSON.stringify(state.speech)} command=${JSON.stringify(command)}`,
  );
  await assertVisibleResultSpeech(page, "mr-feast", state.feastSays.resultDialogue.verdictLine, `round ${command.index + 1} Mr. Feast verdict`);
  await page.evaluate(
    (seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds),
    state.feastSays.pacing.verdictSpeechSeconds + 0.03,
  );
  state = await diagnostics(page);
  assert(
    state.speech?.speakerId === command.contestantSpeakerId
      && state.speech?.text === command.contestantLine,
    `round ${command.index + 1} should follow the verdict with the authored contestant line; speech=${JSON.stringify(state.speech)} command=${JSON.stringify(command)}`,
  );
  await assertVisibleResultSpeech(page, command.contestantSpeakerId, command.contestantLine, `round ${command.index + 1} contestant banter`);
  if (captureProof) {
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, `result-banter-${command.action}-desktop.png`) });
  }

  await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.24));
  const returning = await diagnostics(page);
  const returningResponses = returning.contestants.entries
    .filter((entry) => entry.status === "ready")
    .map((entry) => entry.challengeResponse);
  assert(returningResponses.every((response) => response?.returning && response.progress >= 0 && response.progress < 1), `contestants should be easing back or already returned during the longer result; got ${JSON.stringify(returningResponses)}`);

  await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.8));
  state = await diagnostics(page);
  assert(state.feastSays.phase === "result", `finishing the cast animation must not skip the readable result hold; got ${JSON.stringify(state.feastSays)}`);
  assertLiveProductionCamera(state, `Feast Says settled result ${command.index + 1}`, resultCamera);
  assertContestantResponsesReturned(state);

  let warningSeen = false;
  for (let guard = 0; guard < 100; guard += 1) {
    state = await diagnostics(page);
    if (state.speech?.speakerId === "mr-feast" && state.speech?.text === command.hostWarning) {
      warningSeen = true;
      break;
    }
    if (state.feastSays.phase !== "result" || state.feastSays.phaseRemaining <= 0.12) break;
    await page.evaluate(
      (seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds),
      Math.min(0.1, Math.max(0, state.feastSays.phaseRemaining - 0.1)),
    );
  }
  state = await diagnostics(page);
  assert(warningSeen && state.feastSays.phase === "result" && state.feastSays.phaseRemaining > 0, `Mr. Feast's warning should occur before the next instruction; got ${JSON.stringify({ feastSays: state.feastSays, speech: state.speech })}`);
  assert(
    typeof command.hostWarning === "string"
      && command.hostWarning.length > 0
      && state.speech?.speakerId === "mr-feast"
      && state.speech?.text === command.hostWarning
      && /quiet|silence|no talking|save it/i.test(command.hostWarning),
    `Mr. Feast should cut off the contestant banter with the authored warning; speech=${JSON.stringify(state.speech)} command=${JSON.stringify(command)}`,
  );
  await assertVisibleResultSpeech(page, "mr-feast", command.hostWarning, `round ${command.index + 1} Mr. Feast warning`);
  if (captureProof) {
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, `result-warning-${command.action}-desktop.png`) });
  }

  await page.evaluate(
    (seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds),
    state.feastSays.phaseRemaining + 0.02,
  );
  return diagnostics(page);
}

async function playSixCommandRound(page, intendedOutcome) {
  const observed = [];
  const answered = new Set();

  for (let guard = 0; guard < 160; guard += 1) {
    const state = await diagnostics(page);
    const feast = state.feastSays;
    if (state.gameOver || feast.phase === "completed") break;
    if (feast.phase === "result") {
      await page.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), feast.phaseRemaining + 0.02);
      continue;
    }

    const command = feast.command;
    if (feast.phase !== "command" || !command || command.resolved) {
      await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(0.25));
      continue;
    }

    const key = `${command.index}:${command.text}`;
    if (answered.has(key)) {
      await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(0.25));
      continue;
    }
    assert(command.total === 6, `Feast Says should be one readable six-command round; got ${JSON.stringify(command)}`);
    const expected = FEAST_COMMAND_FLOW[command.index];
    assert(expected && command.action === expected.action && command.text === expected.text && command.obey === expected.obey, `command ${command.index + 1} is out of the locked fake-out-to-psychological order; expected=${JSON.stringify(expected)} got=${JSON.stringify(command)}`);

    const beforeMotion = await diagnostics(page);
    const alreadySettled = beforeMotion.contestants.entries
      .filter((entry) => entry.challengeResponse?.action !== "still")
      .every((entry) => entry.challengeResponse?.progress === 1);
    if (!alreadySettled) await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.32));
    const movingMotion = await diagnostics(page);
    if (alreadySettled) {
      assert(command.index === 0, `only startBallroomRound may pre-settle the opening response; command=${JSON.stringify(command)}`);
    } else {
      assertContestantLocomotionInFlight(command, movingMotion);
    }
    if (intendedOutcome === "win" && ["left", "right", "back", "approach"].includes(command.action)) {
      const visualProofName = {
        left: "contestant-sidestep-left-desktop.png",
        right: "contestant-sidestep-right-desktop.png",
        back: "contestant-backpedal-desktop.png",
        approach: "contestant-approach-desktop.png",
      }[command.action];
      if (visualProofName) {
        await assertStableCommandPaint(page, command, `${command.action} response capture`);
        await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, visualProofName) });
      }
    }
    await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.68));
    const stagedMotion = await diagnostics(page);
    assertContestantResponseMotion(command, stagedMotion);
    assertAuthoredDecisionTargets(command, stagedMotion);
    if (intendedOutcome === "win" && !["left", "right", "back", "approach"].includes(command.action)) {
      const visualProofName = {
        point: "contestant-point-desktop.png",
        crouch: "contestant-crouch-desktop.png",
      }[command.action];
      if (visualProofName) {
        await assertStableCommandPaint(page, command, `${command.action} response capture`);
        await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, visualProofName) });
      }
    }

    let responseAction = intendedOutcome === "win"
      ? (command.obey ? command.action : "still")
      : wrongActionFor(command.action);
    let result;
    const useRealPoint = intendedOutcome === "win" && command.action === "point";
    const useRealApproach = intendedOutcome === "win" && command.action === "approach";
    const useRealCrouch = intendedOutcome === "win" && command.obey && command.action === "crouch";
    if (useRealPoint) {
      responseAction = "point:juniper-cross";
      const beforePoint = await aimAtFeastContestant(page, "juniper-cross", { expectPrompt: true });
      assert(beforePoint.feastSays.player.distanceFromMark <= 0.03, `looking must not move the player off their mark; got ${JSON.stringify(beforePoint.feastSays.player)}`);
      await pressInteract(page);
      let selected = await feastState(page);
      assert(selected.player.selectedTargetId === "juniper-cross", `real look + E should select Juniper without an A/W/D name map; got ${JSON.stringify(selected.player)}`);
      if (selected.phase === "command") {
        await page.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), selected.phaseRemaining + 0.02);
        selected = await feastState(page);
      }
      result = { accepted: true, ...(selected.command?.result || {}) };
    } else if (useRealApproach) {
      responseAction = "approach:mara-voss";
      const beforeApproach = await aimAtFeastContestant(page, "mara-voss");
      await page.keyboard.down("w");
      try {
        await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.38));
      } finally {
        await page.keyboard.up("w");
      }
      const liveInput = await feastState(page);
      assert(liveInput.player.detectedAction === "approach" && liveInput.player.detectedTargetId === "mara-voss", `actual forward displacement toward Mara should drive the sacrifice choice; got ${JSON.stringify(liveInput.player)}`);
      assert(liveInput.player.distanceFromMark >= 0.48 && liveInput.player.distanceFromMark > beforeApproach.feastSays.player.distanceFromMark + 0.4, `the approach choice must come from real displacement, not a key-to-name shortcut; before=${JSON.stringify(beforeApproach.feastSays.player)} after=${JSON.stringify(liveInput.player)}`);
      await page.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), liveInput.phaseRemaining + 0.02);
      const resolved = await feastState(page);
      result = { accepted: true, ...(resolved.command?.result || {}) };
    } else if (useRealCrouch) {
      await page.keyboard.press("c");
      const liveInput = await feastState(page);
      assert(liveInput.player.detectedAction === "crouch", `real crouch input was not detected; got ${JSON.stringify(liveInput.player)}`);
      await page.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), liveInput.phaseRemaining + 0.02);
      const resolved = await feastState(page);
      result = { accepted: true, ...(resolved.command?.result || {}) };
    } else {
      result = await page.evaluate(
        (action) => window.MrFeastFresh.respondToFeastSaysForQA(action),
        intendedOutcome === "win" ? "correct" : "incorrect",
      );
    }
    assert(result?.accepted === true, `focused QA response was rejected; command=${JSON.stringify(command)} result=${JSON.stringify(result)}`);
    assert(result.correct === (intendedOutcome === "win"), `command result drifted from the intended ${intendedOutcome}; got ${JSON.stringify(result)}`);
    if (command.index === 0) {
      const beforeResultMove = await diagnostics(page);
      await page.keyboard.down("w");
      await page.waitForTimeout(180);
      await page.keyboard.up("w");
      const afterResultMove = await diagnostics(page);
      const resultDrift = Math.hypot(
        afterResultMove.player.x - beforeResultMove.player.x,
        afterResultMove.player.z - beforeResultMove.player.z,
      );
      assert(resultDrift <= 0.03, `the player must remain frozen while a result is judged; drift=${resultDrift}`);
    }
    answered.add(key);
    observed.push({ ...command, responseAction, result });
    await finishReadableResult(page, command, {
      captureProof: intendedOutcome === "win" && command.action === "point",
    });
  }

  const state = await diagnostics(page);
  assert(observed.length === 6, `the round should resolve exactly six unique commands; got ${JSON.stringify(observed)}`);
  assert(observed.filter((entry) => !entry.obey).length === 2, `the revised deck should contain two physical fake-outs without “Feast says”; got ${JSON.stringify(observed)}`);
  assert(JSON.stringify(observed.map(({ action, text, obey }) => ({ action, text, obey }))) === JSON.stringify(FEAST_COMMAND_FLOW), `the six commands should progress through two physical fake-outs into two psychological choices; got ${JSON.stringify(observed.map(({ action, text, obey }) => ({ action, text, obey })))}`);
  const trustPrompt = observed[4];
  const eliminationPrompt = observed[5];
  const authoredDecisionTargets = [trustPrompt, eliminationPrompt].flatMap((entry) => Object.values(entry.npcTargets || {}));
  assert(authoredDecisionTargets.includes("player"), `at least one authored NPC choice should visibly implicate the player; got ${JSON.stringify(authoredDecisionTargets)}`);
  if (intendedOutcome === "win") {
    assert(trustPrompt.result?.targetId === "juniper-cross" && trustPrompt.result?.correct, `look + E should record the looked-at distrust choice without judging who was selected; got ${JSON.stringify(trustPrompt)}`);
    assert(eliminationPrompt.result?.targetId === "mara-voss" && eliminationPrompt.result?.correct, `real displacement should record the approached sacrifice choice without judging who was selected; got ${JSON.stringify(eliminationPrompt)}`);
  } else {
    assert(!trustPrompt.result?.correct && trustPrompt.result?.targetId === null, `a non-choice response must fail the trust prompt; got ${JSON.stringify(trustPrompt)}`);
    assert(!eliminationPrompt.result?.correct && eliminationPrompt.result?.targetId === null, `remaining on the mark must fail the approach prompt; got ${JSON.stringify(eliminationPrompt)}`);
  }
  return { observed, state };
}

function assertInside(inner, outer, label) {
  assert(
    inner.left >= outer.left - 0.5
      && inner.top >= outer.top - 0.5
      && inner.right <= outer.right + 0.5
      && inner.bottom <= outer.bottom + 0.5,
    `${label} must fit inside the game stage; got ${JSON.stringify({ inner, outer })}`,
  );
}

function rectanglesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function holdTouchDirection(page, session, direction, { expectedAction = direction, advanceSeconds = 0.34 } = {}) {
  const button = await page.locator(`#touch-${direction}`).boundingBox();
  assert(button, `the mobile ${direction} action needs its visible touch control`);
  const center = { x: button.x + button.width / 2, y: button.y + button.height / 2 };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, ...center }],
  });
  try {
    await page.evaluate((seconds) => window.MrFeastFresh.advancePlayerForQA(seconds), advanceSeconds);
    try {
      await page.waitForFunction(
        (expected) => window.MrFeastFresh.getFeastSaysState?.()?.player?.detectedAction === expected,
        expectedAction,
        { timeout: 3500, polling: 50 },
      );
    } catch (_) {
      const probe = await page.evaluate(({ x, y, id }) => ({
        hitId: document.elementFromPoint(x, y)?.id || null,
        hitStack: document.elementsFromPoint(x, y).slice(0, 6).map((element) => ({
          tag: element.tagName,
          id: element.id || null,
          className: typeof element.className === "string" ? element.className : null,
          hidden: element.hidden,
          pointerEvents: getComputedStyle(element).pointerEvents,
        })),
        held: document.getElementById(id)?.classList.contains("is-held") || false,
        rect: (() => {
          const rect = document.getElementById(id)?.getBoundingClientRect();
          return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
        })(),
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        center: { x, y },
      }), { ...center, id: `touch-${direction}` });
      throw new Error(`visible touch-${direction} did not produce ${expectedAction}; input=${JSON.stringify(probe)} player=${JSON.stringify((await feastState(page)).player)}`);
    }
  } finally {
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
}

async function playTouchOnlyLandscapeRound(page) {
  const observed = [];
  const touchSession = await page.context().newCDPSession(page);
  for (let expectedIndex = 0; expectedIndex < 6; expectedIndex += 1) {
    await page.waitForFunction(
      (index) => {
        const feast = window.MrFeastFresh.getFeastSaysState?.();
        return feast?.phase === "command" && feast?.command?.index === index && !feast.command.resolved;
      },
      expectedIndex,
      { timeout: 8000, polling: 50 },
    );
    const before = await feastState(page);
    const layout = await feastHudLayout(page);
    assertInside(layout.panel, layout.stage, `landscape command ${expectedIndex + 1}`);
    assert(layout.panel.height <= 58, `landscape command ${expectedIndex + 1} should leave only a shallow status strip; got ${JSON.stringify(layout)}`);
    assert(layout.commandDisplay === "none" && layout.hintDisplay === "none", `landscape command ${expectedIndex + 1} must not duplicate instructions in the HUD; got ${JSON.stringify(layout)}`);
    assert(!layout.speechHidden && layout.speechDisplay !== "none" && layout.speechText === before.command.spokenText, `landscape command ${expectedIndex + 1} must come from Mr. Feast's speech; got ${JSON.stringify(layout)}`);
    assertInside(layout.speech, layout.stage, `landscape command ${expectedIndex + 1} speech`);
    assert(!rectanglesOverlap(layout.panel, layout.speech), `landscape command ${expectedIndex + 1} speech overlaps the minimal status strip; got ${JSON.stringify(layout)}`);
    assert(layout.leaderboardDisplay === "none", `landscape command ${expectedIndex + 1} must hide the global Scores control so it cannot intercept movement; got ${JSON.stringify(layout)}`);
    assert(Object.values(layout.auxiliaryHudDisplays).every((display) => display === "none"), `landscape command ${expectedIndex + 1} should yield duplicate and irrelevant HUDs; got ${JSON.stringify(layout.auxiliaryHudDisplays)}`);
    if (expectedIndex === 3 && before.command.obey) {
      assert(!layout.crouchHidden && layout.crouch.height >= 44 && layout.crouch.width >= 44, `landscape crouch command lost its 44px action target; got ${JSON.stringify(layout.crouch)}`);
    } else {
      assert(layout.crouchHidden && layout.crouch.height === 0 && layout.crouch.width === 0, `the challenge-only crouch target should take no space outside round four; got ${JSON.stringify(layout)}`);
    }
    assert(!rectanglesOverlap(layout.panel, layout.movement), `landscape command ${expectedIndex + 1} overlaps movement controls; got ${JSON.stringify(layout)}`);
    assert(!rectanglesOverlap(layout.panel, layout.interact), `landscape command ${expectedIndex + 1} overlaps the interaction control; got ${JSON.stringify(layout)}`);
    assert(layout.documentWidth <= layout.viewportWidth + 1, `landscape command ${expectedIndex + 1} introduced horizontal overflow; got ${JSON.stringify(layout)}`);

    const expected = FEAST_COMMAND_FLOW[expectedIndex];
    assert(before.command.obey === expected.obey && before.command.action === expected.action && before.command.text === expected.text, `touch-only command ${expectedIndex + 1} is out of order; expected=${JSON.stringify(expected)} got=${JSON.stringify(before.command)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));

    if (!before.command.obey) {
      // The correct touch response to a fake-out is no input at all.
    } else if (before.command.action === "crouch") {
      await page.locator("#mansion-feast-crouch").click({ force: true });
      assert((await feastState(page)).player.detectedAction === "crouch", `command ${expectedIndex + 1} did not accept the visible mobile crouch action`);
    } else if (before.command.action === "point") {
      await aimAtFeastContestant(page, "juniper-cross", { expectPrompt: true });
      await page.locator("#touch-interact").click({ force: true });
      const selected = await feastState(page);
      assert(selected.player.selectedTargetId === "juniper-cross", `touch Interact should select the contestant in the camera ray; got ${JSON.stringify(selected.player)}`);
    } else if (before.command.action === "approach") {
      const aimed = await aimAtFeastContestant(page, "mara-voss");
      await holdTouchDirection(page, touchSession, "forward", { expectedAction: "approach", advanceSeconds: 0.38 });
      const approached = await feastState(page);
      assert(approached.player.detectedTargetId === "mara-voss" && approached.player.distanceFromMark > aimed.feastSays.player.distanceFromMark + 0.4, `touch movement should physically approach Mara; before=${JSON.stringify(aimed.feastSays.player)} after=${JSON.stringify(approached.player)}`);
    } else {
      await holdTouchDirection(page, touchSession, before.command.action);
    }

    let active = await feastState(page);
    if (active.phase === "command") {
      await page.evaluate(
        (seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds),
        active.phaseRemaining + 0.02,
      );
      active = await feastState(page);
    }
    const resolved = await feastState(page);
    assert(resolved.phase === "result" && resolved.command.result?.correct, `touch-only command ${expectedIndex + 1} should score correctly; got ${JSON.stringify(resolved.command)}`);
    if (before.command.action === "point") {
      assert(resolved.command.result.targetId === "juniper-cross", `look + touch Interact should point to Juniper; got ${JSON.stringify(resolved.command.result)}`);
    } else if (before.command.action === "approach") {
      assert(resolved.command.result.targetId === "mara-voss", `touch displacement should approach Mara; got ${JSON.stringify(resolved.command.result)}`);
    }
    observed.push({ text: before.command.text, obey: before.command.obey, action: before.command.action });
    await finishReadableResult(page, before.command);
  }
  await touchSession.detach();

  await page.waitForFunction(() => window.MrFeastFresh.getFeastSaysState?.()?.phase === "completed", null, { timeout: 8000 });
  const completed = await diagnostics(page);
  assert(observed.length === 6 && observed.filter((entry) => !entry.obey).length === 2, `touch-only landscape run must hold still through two fake-outs; got ${JSON.stringify(observed)}`);
  assert(JSON.stringify(observed.map(({ action, text, obey }) => ({ action, text, obey }))) === JSON.stringify(FEAST_COMMAND_FLOW), `touch-only flow should retain the locked command order; got ${JSON.stringify(observed)}`);
  assert(completed.feastSays.player.score === 6 && completed.feastSays.player.qualified, `touch-only landscape player should qualify with a perfect score; got ${JSON.stringify(completed.feastSays)}`);
  const aftermathKip = completed.contestants.entries.find((entry) => entry.id === "kip-solano");
  assert(completed.feastSays.eliminatedContestantId === "kip-solano" && completed.feastSays.aftermath.active && !aftermathKip?.eliminated && aftermathKip?.modelVisible, `touch-only landscape completion should record Kip's elimination while preserving the witnessed aftermath; got ${JSON.stringify({ feast: completed.feastSays.eliminatedContestantId, aftermath: completed.feastSays.aftermath, kip: aftermathKip })}`);
  assert(!completed.feastSays.clueProgressLocked, "touch-only landscape completion should reopen clue progression");
  return completed;
}

async function feastHudLayout(page) {
  return page.evaluate(() => {
    const byId = (id) => document.getElementById(id);
    const plain = (rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const stage = byId("mansion-stage");
    const panel = byId("mansion-feast-says");
    const command = byId("mansion-feast-command");
    const hint = byId("mansion-feast-hint");
    const timer = byId("mansion-feast-timer");
    const round = byId("mansion-feast-round");
    const footer = panel.querySelector(".mansion-feast__footer");
    const score = byId("mansion-feast-score");
    const standings = byId("mansion-feast-standings");
    const crouch = byId("mansion-feast-crouch");
    const interact = byId("touch-interact");
    const movement = document.querySelector(".mansion-touch__move");
    const tools = document.querySelector(".mansion-tools");
    const location = document.querySelector(".mansion-location");
    const sprint = byId("touch-sprint");
    const touchCrouch = byId("touch-crouch");
    const leaderboardButton = document.querySelector(".rb-standalone-leaderboard-btn");
    const speech = byId("mansion-speech");
    const auxiliaryHud = ["mansion-energy", "mansion-stealth", "mansion-security"]
      .map((id) => byId(id));
    return {
      stage: plain(stage.getBoundingClientRect()),
      panel: plain(panel.getBoundingClientRect()),
      command: plain(command.getBoundingClientRect()),
      hint: plain(hint.getBoundingClientRect()),
      timer: plain(timer.getBoundingClientRect()),
      score: plain(score.getBoundingClientRect()),
      crouch: plain(crouch.getBoundingClientRect()),
      interact: plain(interact.getBoundingClientRect()),
      movement: plain(movement.getBoundingClientRect()),
      tools: plain(tools.getBoundingClientRect()),
      location: plain(location.getBoundingClientRect()),
      sprint: plain(sprint.getBoundingClientRect()),
      touchCrouch: plain(touchCrouch.getBoundingClientRect()),
      panelHidden: panel.hidden,
      crouchHidden: crouch.hidden,
      phase: panel.dataset.phase,
      hintHidden: hint.hidden,
      roundDisplay: getComputedStyle(round).display,
      footerDisplay: getComputedStyle(footer).display,
      standingsDisplay: getComputedStyle(standings).display,
      commandDisplay: getComputedStyle(command).display,
      hintDisplay: getComputedStyle(hint).display,
      speechDisplay: getComputedStyle(speech).display,
      speechHidden: speech.hidden,
      speech: plain(speech.getBoundingClientRect()),
      speechText: byId("mansion-speech-text").textContent,
      toolsDisplay: getComputedStyle(tools).display,
      locationDisplay: getComputedStyle(location).display,
      leaderboardDisplay: leaderboardButton ? getComputedStyle(leaderboardButton).display : "missing",
      auxiliaryHudDisplays: Object.fromEntries(auxiliaryHud.map((element) => [element.id, getComputedStyle(element).display])),
      commandFontPx: Number.parseFloat(getComputedStyle(command).fontSize),
      timerFontPx: Number.parseFloat(getComputedStyle(timer).fontSize),
      commandOverflow: command.scrollWidth - command.clientWidth,
      interactHeight: interact.getBoundingClientRect().height,
      interactWidth: interact.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
}

async function run() {
  const [runtimeSource, pageSource] = await Promise.all([
    readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8"),
    readFile(path.join(root, "games/mr-feast-mansion.html"), "utf8"),
  ]);

  // Red-first contracts: fail here before Chromium starts until the event is
  // represented as a named, persistable system with focused diagnostics.
  assert(/const FEAST_SAYS\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the named FEAST_SAYS tuning and command contract");
  assert((runtimeSource.match(/reportDeadlineSeconds:\s*5\s*\*\s*60/g) || []).length >= 2, "both competitions must allow exactly five active minutes to interact with Mr. Feast");
  assert(runtimeSource.includes("addCompetitionFilmSet"), "competition calls must replace the report sign with a reusable production set");
  for (const prop of ["broadcast-camera", "studio-key-light", "boom-microphone"]) {
    assert(runtimeSource.includes(prop), `the competition production set is missing its ${prop} dressing`);
  }
  assert(runtimeSource.includes('model: "long-lens-cinema-pedestal"'), "the production camera must use a named long-lens cinema profile");
  assert(runtimeSource.includes('profile: "long-lens-cinema"'), "the production camera must expose a named long-lens silhouette profile");
  for (const prop of ["camera-matte-box", "camera-lens-rail", "camera-rear-battery", "camera-viewfinder", "camera-monitor", "camera-pan-handle", "camera-pedestal-base"]) {
    assert(runtimeSource.includes(prop), `the rebuilt long-lens camera is missing its ${prop} component`);
  }
  assert(runtimeSource.includes('subject: "player-contestant-lineup"'), "Feast Says needs an explicit player/contestant camera framing target");
  assert(runtimeSource.includes("cameraPlacement"), "Feast Says must keep its player-lineup setback separate from the shared Storm Run camera placement");
  assert(runtimeSource.includes("getLightDiagnostics"), "the production rig needs focused player-facing studio-light diagnostics");
  assert(runtimeSource.includes("floorMarkers"), "Feast Says needs diagnostics that prove its authored lineup positions have no floor-marker geometry");
  assert(!runtimeSource.includes("feast-says-player-mark") && !runtimeSource.includes("feast-says-contestant-mark-") && !runtimeSource.includes("feast-says-action-pad-"), "Feast Says must not construct colored floor rings or circular action pads");
  assert(/reportRoot\.visible\s*=\s*productionVisible/.test(runtimeSource), "the Feast Says production rig must remain visible through briefing, command, and result");
  assert(!runtimeSource.includes("feast-says-live-display") && !runtimeSource.includes("feast-says-report-plinth"), "Feast Says must remove the old sign/plinth trigger");
  assert(runtimeSource.includes('reason: "feast-says-no-show"'), "missing the Feast Says report deadline must eliminate the player");
  assert(runtimeSource.includes('instructionDelivery: "speech"'), "Feast Says must declare Mr. Feast speech as its authoritative instruction channel");
  assert(runtimeSource.includes("feast-says-verdict"), "Mr. Feast must verbally judge each Feast Says response instead of relying on result-card text");
  assert(/const CONTESTANT_FEAST_SAYS_MOTION\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing named contestant response-animation tuning");
  assert(/class FeastSaysSystem/.test(runtimeSource), "runtime is missing the FeastSaysSystem state machine");
  assert(/feastSays:\s*feastSaysSystem\?\.getDiagnostics/.test(runtimeSource), "render_game_to_text must expose Feast Says diagnostics");
  for (const hook of ["getFeastSaysState", "advanceFeastSaysForQA", "advanceFeastSaysCastForQA", "callFeastSaysForQA", "respondToFeastSaysForQA", "aimFeastSaysTargetForQA", "completeFeastSaysWithAftermathForQA", "resolveFeastSaysAftermathForQA"]) {
    assert(runtimeSource.includes(hook), `runtime is missing the focused ${hook} QA hook`);
  }
  assert(/skipFeastSaysBriefing/.test(runtimeSource) && /canSkipBriefing/.test(runtimeSource), "Feast Says is missing an explicit briefing-only E/tap skip transition");
  assert(/briefingSkipAfterSeconds:\s*0/.test(runtimeSource), "Feast Says briefing skip must be immediate");
  assert(!/skipLabel:\s*"Skip rules"/.test(runtimeSource), "competition rules must not attach a Skip rules bubble button");

  assert(/function competitionBlocksInvestigation\(\)[\s\S]{0,180}activeCompetitionSystem\(\)/.test(runtimeSource), "clue carriers need one centralized active-competition gate");
  assert(/function noteMajorClueDiscovered\(clueId\)[\s\S]{0,420}feastSaysSystem\?\.noteClueDiscovered\(clueId\)[\s\S]{0,420}stormRunSystem\?\.noteClueDiscovered\(clueId\)/.test(runtimeSource), "earned clues must dispatch through Feast Says and then Storm Run");
  assert(/feastSaysSystem\?\.update\(Math\.min\(rawDt, FEAST_SAYS\.maximumTimerStepSeconds\)\)/.test(runtimeSource), "the live show clock must consume capped wall time instead of physics-clamped frame time");
  const authoredCommandOrder = [
    'text: "Feast says step left."',
    'text: "Step right."',
    'text: "Feast says step back."',
    'text: "Crouch."',
    'text: "Feast says point to the contestant you distrust most."',
    'text: "Feast says step toward the contestant you would sacrifice."',
  ];
  let previousCommandOffset = -1;
  for (const commandSource of authoredCommandOrder) {
    const commandOffset = runtimeSource.indexOf(commandSource);
    assert(commandOffset > previousCommandOffset, `the command deck is missing or misorders ${commandSource}`);
    previousCommandOffset = commandOffset;
  }
  assert((runtimeSource.match(/obey:\s*false/g) || []).length >= 2, "Feast Says needs at least two commands that omit the trigger phrase and should be ignored");
  assert(!/Beat Kip(?:'s score)? to (?:remain|survive)|beat Kip to survive/i.test(runtimeSource), "player-facing Feast Says instructions must describe the generic elimination rule instead of hinting to beat Kip");
  assert(/selectPointTargetFromLook\(/.test(runtimeSource), "the distrust decision must select the looked-at contestant instead of mapping movement keys to names");
  assert(/approachTargetForDisplacement\(/.test(runtimeSource), "the elimination decision must infer the contestant from real player displacement");
  assert(/pointableContestants\(\)\s*\{[\s\S]{0,420}entry\.status\s*===\s*["']ready["'][\s\S]{0,220}entry\.root\.visible[\s\S]{0,220}!mansionContestants\.eliminatedIds\.has/.test(runtimeSource), "point and approach choices must filter out unloaded, hidden, and eliminated contestants");
  assert(/approachTargetForDisplacement\(\)[\s\S]{0,900}for\s*\(const entry of this\.pointableContestants\(\)\)/.test(runtimeSource), "approach scoring must use the visible staged cast instead of empty authored marks");
  assert(/addEventListener\(["']pointermove["'][\s\S]{0,420}!feastSaysSystem\.allowsLook\(\)[\s\S]{0,180}input\.touchLookId\s*=\s*null/.test(runtimeSource), "active touch-look must cancel as soon as Feast Says returns to a look-locked phase");
  assert(!/targetByAction:\s*Object\.freeze/.test(runtimeSource), "Feast Says must not retain the old A/W/D contestant mapping");
  assert(/resultSeconds:\s*[4-9](?:\.\d+)?/.test(runtimeSource), "the challenge needs a longer pause between instructions");
  assert(/aftermath:\s*Object\.freeze\([\s\S]{0,1600}kipLine:[\s\S]{0,400}hostLine:[\s\S]{0,600}firstTalkLines:/.test(runtimeSource), "Feast Says needs a named post-game dialogue and survivor-return contract");
  assert(/beginFeastSaysAftermath\(/.test(runtimeSource), "the contestant system needs a Feast Says aftermath entry point");
  assert(/updateFeastSaysAftermathEntry\(/.test(runtimeSource), "surviving contestants must visibly walk back to their normal routines");
  assert(/resolveAftermath\(/.test(runtimeSource), "Feast Says must defer Kip's disappearance and Mr. Feast's release until the player leaves");
  assert(/consumePostGameContestantLine\(/.test(runtimeSource), "survivors need a one-use post-game conversation before returning to normal dialogue");
  assert(/challengeMotionKind\s*=\s*["']upset["']/.test(runtimeSource), "Kip needs a readable upset aftermath pose");
  assert(/contestantLine:[\s\S]{0,240}hostWarning:/.test(runtimeSource), "the command deck needs contestant banter paired with Mr. Feast's no-talking warnings");
  assert(/applyChallengeResponsePose\(/.test(runtimeSource), "contestant responses need a challenge-only skeletal pose layer");
  assert(/returnSeconds:\s*0\.[5-9]/.test(runtimeSource), "contestant response motion needs a named eased-return duration");
  assert(/returnChallengeResponses\(/.test(runtimeSource), "contestant responses must ease back to their marks during the result phase");
  assert(/FEAST_SAYS\.contestantMarks\[targetId\]/.test(runtimeSource), "point gestures need an authored-mark fallback when a target model is unavailable");
  assert(/targetId\s*===\s*["']player["'][\s\S]{0,260}FEAST_SAYS\.playerMark|FEAST_SAYS\.playerMark[\s\S]{0,260}targetId\s*===\s*["']player["']/.test(runtimeSource), "authored NPC choices that target the player need a player-mark fallback");
  assert(/stabilizeChallengeBackpedalTorso\(/.test(runtimeSource), "backpedal gait needs an upright challenge-only torso stabilizer");

  assert(/feastSays:\s*feastSaysSystem\?\.getSnapshot\(\)/.test(runtimeSource), "mansion saves must serialize Feast Says progress");
  assert(/feastSaysSystem\?\.restoreSnapshot\(data\.feastSays/.test(runtimeSource), "mansion loads must restore Feast Says progress");
  for (const id of ["mansion-feast-says", "mansion-feast-command", "mansion-feast-hint", "mansion-feast-score", "mansion-feast-timer", "mansion-feast-crouch"]) {
    assert(pageSource.includes(`id="${id}"`), `page is missing #${id}`);
  }
  assert(pageSource.includes('id="mansion-feast-says" role="region" aria-label="Feast Says minimal status" data-guidance="speech"'), "Feast Says must ship a speech-led minimal status strip");
  assert(!/#mansion-stage:has\(#mansion-feast-says[^\n]+#mansion-speech\s*\{\s*display:\s*none/.test(pageSource), "active Feast Says must never hide Mr. Feast's speech bubble");
  const mobileCss = pageSource.slice(pageSource.indexOf("@media (max-width: 560px)"));
  assert(/#mansion-feast-says/.test(mobileCss), "the Feast Says HUD needs an explicit phone layout");
  assert(/#mansion-feast-says\[data-phase="dormant"\]/.test(mobileCss), "the idle Feast Says countdown needs its own compact phone layout");
  const shortLandscapeCss = pageSource.slice(pageSource.indexOf("@media (max-height: 420px) and (orientation: landscape)"));
  assert(/#mansion-feast-says:not\(\[data-phase="dormant"\]\)/.test(shortLandscapeCss), "active Feast Says needs a single-column short-landscape layout");
  assert(/#mansion-feast-says\[data-phase="dormant"\]/.test(shortLandscapeCss), "the dormant countdown needs a conflict-free short-landscape position");
  assert(/#mansion-feast-says\[data-phase="dormant"\]\s+\.mansion-feast__header\s*\{\s*display:\s*none/.test(shortLandscapeCss), "the short-landscape dormant strip must drop its eyebrow row to clear Sprint/Crouch");
  assert(/id="touch-interact"/.test(pageSource), "the shipped touch interaction control must remain available for Ballroom staging");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });

    // --- The ten-minute clock begins after, not during, the welcome ----------
    const timerErrors = [];
    const timerPage = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    watchErrors(timerPage, timerErrors);
    await bootPage(timerPage, introUrl, { waitForCast: false });
    let feast = await feastState(timerPage);
    assert(feast.callAfterSeconds === 600 && feast.secondsUntilCall === 600, `fresh show clock should begin at 10:00; got ${JSON.stringify(feast)}`);
    await timerPage.locator("#mansion-enter").click();
    await timerPage.waitForFunction(() => JSON.parse(window.render_game_to_text()).openingWelcome?.active, null, { timeout: 8000 });
    await timerPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(599.9));
    feast = await feastState(timerPage);
    assert(feast.phase === "dormant" && feast.callCount === 0 && feast.secondsUntilCall === 600, `welcome time must not consume the show clock; got ${JSON.stringify(feast)}`);

    await timerPage.waitForFunction(() => window.MrFeastFresh.getMrFeastState?.()?.loadStatus === "ready", null, { timeout: 120000 });
    await timerPage.evaluate(() => window.MrFeastFresh.advanceOpeningWelcomeForQA(120));
    await timerPage.waitForFunction(() => JSON.parse(window.render_game_to_text()).openingWelcome?.completed, null, { timeout: 8000 });
    const dormantDesktopHud = await feastHudLayout(timerPage);
    assert(dormantDesktopHud.panelHidden && dormantDesktopHud.phase === "dormant", `desktop next-game countdown must stay hidden while dormant; got ${JSON.stringify(dormantDesktopHud)}`);
    const pauseProbe = await timerPage.evaluate(() => {
      const before = window.MrFeastFresh.getFeastSaysState().secondsUntilCall;
      window.MrFeastFresh.setMenuOpenForQA(true);
      window.MrFeastFresh.advanceFeastSaysForQA(30);
      const during = window.MrFeastFresh.getFeastSaysState().secondsUntilCall;
      window.MrFeastFresh.setMenuOpenForQA(false);
      return { before, during };
    });
    assert(pauseProbe.before === pauseProbe.during, `the Escape menu must pause the show clock; got ${JSON.stringify(pauseProbe)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(123.4));
    assert(await timerPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving a dormant Feast Says countdown should succeed");
    await timerPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(8));
    assert(await timerPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading a dormant Feast Says countdown should succeed");
    feast = await feastState(timerPage);
    assert(Math.abs(feast.intermissionElapsed - 123.4) <= 0.01, `dormant save/load should preserve countdown progress; got ${JSON.stringify(feast)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(476.5));
    feast = await feastState(timerPage);
    assert(feast.phase === "dormant" && feast.callCount === 0 && feast.secondsUntilCall > 0 && feast.secondsUntilCall <= 0.11, `599.9 exploration seconds must not call the event; got ${JSON.stringify(feast)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(0.2));
    feast = await feastState(timerPage);
    assert(feast.phase === "called" && feast.triggerReason === "timer" && feast.callCount === 1, `600 exploration seconds should call Feast Says exactly once; got ${JSON.stringify(feast)}`);
    assert(feast.clueProgressLocked, "the timer call should lock clue progress until the competition ends");
    assert(feast.reportDeadlineSeconds === 300 && feast.reportRemaining === 300, `the live call must begin a five-minute report deadline: ${JSON.stringify(feast)}`);
    assert(feast.hostWaiting && feast.hostStaged, `Mr. Feast must already be visibly waiting on the Ballroom set when the call begins: ${JSON.stringify(feast)}`);
    assert(feast.filmSet?.visible && feast.filmSet?.cameraCount === 1 && feast.filmSet?.lightCount === 2 && feast.filmSet?.boomMicCount === 1 && !feast.filmSet?.hasSign, `the Ballroom trigger must read as a camera/light/boom set rather than a sign: ${JSON.stringify(feast.filmSet)}`);
    assert(feast.filmSet.cameraScale <= 0.8 && feast.filmSet.cameraDistanceFromHost >= 2.25, `the Ballroom camera must stay smaller and farther from Mr. Feast: ${JSON.stringify(feast.filmSet)}`);
    const calledPauseProbe = await timerPage.evaluate(() => {
      const before = window.MrFeastFresh.getFeastSaysState().reportRemaining;
      window.MrFeastFresh.setMenuOpenForQA(true);
      window.MrFeastFresh.advanceFeastSaysForQA(30);
      const during = window.MrFeastFresh.getFeastSaysState().reportRemaining;
      window.MrFeastFresh.setMenuOpenForQA(false);
      return { before, during };
    });
    assert(calledPauseProbe.before === calledPauseProbe.during, `the Escape menu must pause the five-minute check-in deadline: ${JSON.stringify(calledPauseProbe)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.teleport("feastSaysStaging"));
    await timerPage.waitForTimeout(120);
    let calledDiagnostics = await diagnostics(timerPage);
    assert(/start feast says with mr\. feast/i.test(calledDiagnostics.prompt || ""), `the player must start Feast Says by aiming at and interacting with Mr. Feast: ${JSON.stringify({ prompt: calledDiagnostics.prompt, ray: calledDiagnostics.interactionRay })}`);
    assert(calledDiagnostics.feastSays.ui?.timer === "05:00", `the called-phase HUD must show the five-minute deadline: ${JSON.stringify(calledDiagnostics.feastSays.ui)}`);
    await timerPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "timer-call-desktop.png") });

    await timerPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(47.5));
    assert(await timerPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving during the Feast Says report window should succeed");
    const savedReportRemaining = (await feastState(timerPage)).reportRemaining;
    await timerPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(10));
    assert(await timerPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading a called Feast Says state should succeed");
    feast = await feastState(timerPage);
    assert(Math.abs(feast.reportRemaining - savedReportRemaining) <= 0.01 && feast.hostWaiting, `save/load must preserve the deadline and restage Mr. Feast: ${JSON.stringify({ savedReportRemaining, feast })}`);
    await timerPage.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), feast.reportRemaining - 0.1);
    feast = await feastState(timerPage);
    assert(feast.phase === "called" && feast.reportRemaining > 0 && feast.reportRemaining <= 0.11, `the player must remain alive just before the five-minute deadline: ${JSON.stringify(feast)}`);
    await timerPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(0.2));
    calledDiagnostics = await diagnostics(timerPage);
    assert(calledDiagnostics.feastSays.phase === "failed" && calledDiagnostics.gameOver?.reason === "feast-says-no-show", `failing to interact with Mr. Feast in five minutes must eliminate the player: ${JSON.stringify({ feastSays: calledDiagnostics.feastSays, gameOver: calledDiagnostics.gameOver })}`);
    assert(timerErrors.length === 0, `timer-page console errors: ${timerErrors.join(" | ")}`);
    await timerPage.close();

    const landscapeErrors = [];
    const landscapeCountdownPage = await browser.newPage({
      viewport: { width: 844, height: 390 },
      screen: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    watchErrors(landscapeCountdownPage, landscapeErrors);
    await bootPage(landscapeCountdownPage, gameUrl, { waitForCast: false });
    const dormantLandscapeHud = await feastHudLayout(landscapeCountdownPage);
    assert(dormantLandscapeHud.panelHidden && dormantLandscapeHud.phase === "dormant", `short-landscape next-game countdown must stay hidden while dormant; got ${JSON.stringify(dormantLandscapeHud)}`);
    await landscapeCountdownPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "dormant-countdown-landscape.png") });

    await landscapeCountdownPage.waitForFunction(() => window.MrFeastFresh.getMrFeastState?.()?.loadStatus === "ready", null, { timeout: 120000 });
    await landscapeCountdownPage.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
    const landscapeCall = await landscapeCountdownPage.evaluate(() => window.MrFeastFresh.callFeastSaysForQA("timer"));
    assert(landscapeCall?.started, `short-landscape QA call should start; got ${JSON.stringify(landscapeCall)}`);
    await startBallroomRound(landscapeCountdownPage, true, { skipBriefing: true });
    const activeLandscapeHud = await feastHudLayout(landscapeCountdownPage);
    assert(activeLandscapeHud.phase === "command", `the opening physical command should be active; got ${JSON.stringify(activeLandscapeHud)}`);
    assertInside(activeLandscapeHud.panel, activeLandscapeHud.stage, "short-landscape opening command card");
    assert(activeLandscapeHud.panel.height <= 58 && activeLandscapeHud.commandDisplay === "none" && activeLandscapeHud.hintDisplay === "none", `short-landscape play should use only the minimal status strip: ${JSON.stringify(activeLandscapeHud)}`);
    assert(!activeLandscapeHud.speechHidden && activeLandscapeHud.speechDisplay !== "none" && /Feast says step left/i.test(activeLandscapeHud.speechText), `the opening direction must come from Mr. Feast's visible speech: ${JSON.stringify(activeLandscapeHud)}`);
    assertInside(activeLandscapeHud.speech, activeLandscapeHud.stage, "short-landscape opening speech");
    assert(!rectanglesOverlap(activeLandscapeHud.panel, activeLandscapeHud.speech), `short-landscape speech overlaps the status strip: ${JSON.stringify(activeLandscapeHud)}`);
    assert(activeLandscapeHud.locationDisplay === "none" && activeLandscapeHud.toolsDisplay === "none", `nonessential top HUDs should yield to the short-landscape live challenge; got ${JSON.stringify(activeLandscapeHud)}`);
    assert(!rectanglesOverlap(activeLandscapeHud.panel, activeLandscapeHud.movement), `short-landscape opening card overlaps movement choices; got ${JSON.stringify(activeLandscapeHud)}`);
    assert(!rectanglesOverlap(activeLandscapeHud.panel, activeLandscapeHud.interact), `short-landscape opening card overlaps the E control; got ${JSON.stringify(activeLandscapeHud)}`);
    await landscapeCountdownPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "opening-command-landscape.png") });
    const touchLandscapeCompletion = await playTouchOnlyLandscapeRound(landscapeCountdownPage);
    assert(touchLandscapeCompletion.feastSays.phase === "completed", `the touch-only landscape round should reach completion; got ${JSON.stringify(touchLandscapeCompletion.feastSays)}`);
    await landscapeCountdownPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "six-command-complete-landscape.png") });
    assert(landscapeErrors.length === 0, `short-landscape Feast Says console errors: ${landscapeErrors.join(" | ")}`);
    await landscapeCountdownPage.close();

    const compactLandscapePage = await browser.newPage({
      viewport: { width: 568, height: 320 },
      screen: { width: 568, height: 320 },
      isMobile: true,
      hasTouch: true,
    });
    await bootPage(compactLandscapePage);
    await compactLandscapePage.evaluate(() => window.MrFeastFresh.callFeastSaysForQA("timer"));
    await startBallroomRound(compactLandscapePage, true);
    const compactLandscapeHud = await feastHudLayout(compactLandscapePage);
    assert(compactLandscapeHud.panel.height <= 58 && compactLandscapeHud.commandDisplay === "none" && compactLandscapeHud.speechDisplay !== "none", `compact 568×320 play should keep a speech-led minimal strip; got ${JSON.stringify(compactLandscapeHud)}`);
    assert(!rectanglesOverlap(compactLandscapeHud.panel, compactLandscapeHud.movement) && !rectanglesOverlap(compactLandscapeHud.panel, compactLandscapeHud.interact), `compact 568×320 live card should clear all touch controls; got ${JSON.stringify(compactLandscapeHud)}`);
    await compactLandscapePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "opening-command-compact-landscape.png") });
    await compactLandscapePage.close();

    // Every supported first clue can call the same event without losing its
    // own discovery feedback. These are fresh runtimes, not a scripted book
    // route, so a player cannot bypass the competition by choosing another lead.
    const shovelPage = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await bootPage(shovelPage, gameUrl, { waitForCast: false });
    await teleportForInteraction(shovelPage, "contestant13GardenShovel");
    await pressInteract(shovelPage);
    let alternateClue = await diagnostics(shovelPage);
    assert(alternateClue.contestant13.shovelTaken && alternateClue.feastSays.phase === "called", `a shovel-first route should preserve the shovel and call Feast Says; got ${JSON.stringify(alternateClue.feastSays)}`);
    const shovelToast = await shovelPage.evaluate(() => ({
      title: document.getElementById("mansion-discovery-title")?.textContent || "",
      body: document.getElementById("mansion-discovery-body")?.textContent || "",
    }));
    assert(/concealed garden shovel|faceless fountain/i.test(shovelToast.title) && /production has called/i.test(shovelToast.body), `the shovel clue and live call should share one readable discovery card; got ${JSON.stringify(shovelToast)}`);
    await shovelPage.close();

    const scratchPage = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await bootPage(scratchPage, gameUrl, { waitForCast: false });
    await teleportForInteraction(scratchPage, "codeScratchFiveDoors");
    await pressInteract(scratchPage);
    alternateClue = await diagnostics(scratchPage);
    const scratchCarrier = alternateClue.tamper.entries.find((entry) => entry.artId === "five-doors");
    assert(alternateClue.workroomCode.discoveredCount === 1 && scratchCarrier?.tampered && alternateClue.feastSays.phase === "called", `a scratch-first route should preserve the first mark and call Feast Says; got ${JSON.stringify({ feastSays: alternateClue.feastSays, scratchCarrier })}`);
    const scratchToast = await scratchPage.evaluate(() => ({
      title: document.getElementById("mansion-discovery-title")?.textContent || "",
      body: document.getElementById("mansion-discovery-body")?.textContent || "",
    }));
    assert(/scratched plaster/i.test(scratchToast.title) && /production has called/i.test(scratchToast.body), `the scratch clue and live call should share one readable discovery card; got ${JSON.stringify(scratchToast)}`);
    const pausedHousekeeping = await scratchPage.evaluate(() => window.MrFeastFresh.advanceTamperForQA(10));
    alternateClue = await diagnostics(scratchPage);
    const heldCarrier = alternateClue.tamper.entries.find((entry) => entry.artId === "five-doors");
    assert(pausedHousekeeping.dispatched.length === 0 && heldCarrier?.tampered && !heldCarrier?.dispatched, `scratch-first housekeeping must remain queued while production holds the mansion; got ${JSON.stringify({ pausedHousekeeping, heldCarrier })}`);
    await scratchPage.close();

    // --- A live clue calls the show and blocks every later clue carrier -------
    const winErrors = [];
    const winPage = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    watchErrors(winPage, winErrors);
    await bootPage(winPage);
    await winPage.evaluate(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await teleportForInteraction(winPage, "contestant13LibraryBook", /read “.+”/i);
    await pressInteract(winPage);
    await winPage.waitForFunction(() => JSON.parse(window.render_game_to_text()).contestant13?.bookRead, null, { timeout: 8000 });
    let state = await diagnostics(winPage);
    assert(state.feastSays.phase === "called" && state.feastSays.triggerReason === "clue", `the first live clue should call Feast Says; got ${JSON.stringify(state.feastSays)}`);
    assert(state.feastSays.callCount === 1 && state.feastSays.clueProgressLocked, `the clue call should be singular and lock investigation; got ${JSON.stringify(state.feastSays)}`);
    await winPage.keyboard.press("Escape");
    await winPage.waitForFunction(() => document.getElementById("mansion-book-reader")?.hidden, null, { timeout: 4000 });

    // A called save must return to the call instead of restarting or skipping it.
    assert(await winPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving the called state should succeed");
    await startBallroomRound(winPage);
    assert((await feastState(winPage)).phase === "command", "the first staging interaction should mutate the save before the load probe");
    assert(await winPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading the called Feast Says save should succeed");
    await winPage.waitForTimeout(180);
    state = await diagnostics(winPage);
    assert(state.feastSays.phase === "called" && state.feastSays.triggerReason === "clue" && state.feastSays.callCount === 1, `load should restore the exact called state; got ${JSON.stringify(state.feastSays)}`);
    assert(state.feastSays.clueProgressLocked, "loading a called save must restore its clue lock");

    // A true in-round save normalizes back to a clean Ballroom call. It must
    // not leak partial scores or a half-resolved command into the resumed show.
    await startBallroomRound(winPage);
    let midRound = await feastState(winPage);
    const firstResult = await winPage.evaluate(
      (action) => window.MrFeastFresh.respondToFeastSaysForQA(action),
      "correct",
    );
    assert(firstResult.accepted && firstResult.correct, `the transient save setup should score once; got ${JSON.stringify(firstResult)}`);
    midRound = await feastState(winPage);
    await winPage.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), midRound.phaseRemaining + 0.02);
    midRound = await feastState(winPage);
    assert(midRound.phase === "command" && midRound.player.score === 1, `the transient save needs a nonzero partial score; got ${JSON.stringify(midRound)}`);
    assert(await winPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving during a live command should succeed");
    assert(await winPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading a live-command save should succeed");
    await winPage.waitForTimeout(180);
    state = await diagnostics(winPage);
    assert(state.feastSays.phase === "called" && state.feastSays.player.score === 0 && state.feastSays.player.strikes === 0, `a transient save should resume at a clean call; got ${JSON.stringify(state.feastSays)}`);

    const beforeShovel = state.contestant13.shovelTaken;
    await teleportForInteraction(winPage, "contestant13GardenShovel");
    await pressInteract(winPage);
    state = await diagnostics(winPage);
    assert(state.contestant13.shovelTaken === beforeShovel && !state.inventory.items.includes("garden-shovel"), `the second story clue must be blocked while called; got ${JSON.stringify(state.contestant13)}`);

    const beforeCarrier = state.workroomCode.targets.find((target) => target.artId === "five-doors");
    const beforeTamper = state.tamper.entries.find((entry) => entry.artId === "five-doors");
    await teleportForInteraction(winPage, "codeScratchFiveDoors");
    await pressInteract(winPage);
    state = await diagnostics(winPage);
    const afterCarrier = state.workroomCode.targets.find((target) => target.artId === "five-doors");
    const afterTamper = state.tamper.entries.find((entry) => entry.artId === "five-doors");
    assert(!beforeCarrier.revealed && !beforeCarrier.discovered && !afterCarrier.revealed && !afterCarrier.discovered, `a tamper-portrait carrier must not reveal its scratch while called; before=${JSON.stringify(beforeCarrier)} after=${JSON.stringify(afterCarrier)}`);
    assert(!beforeTamper.tampered && !afterTamper.tampered, `the blocked carrier must not tilt; before=${JSON.stringify(beforeTamper)} after=${JSON.stringify(afterTamper)}`);
    await winPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(120));
    feast = await feastState(winPage);
    assert(feast.phase === "called" && feast.callCount === 1 && feast.triggerReason === "clue" && feast.reportRemaining === 180, `timer and blocked clues must not queue a duplicate call; got ${JSON.stringify(feast)}`);

    // --- A perfect round leaves a witnessed aftermath before Kip disappears
    state = await startBallroomRound(winPage);
    assert(state.feastSays.command.total === 6, `the staged round should expose six commands; got ${JSON.stringify(state.feastSays.command)}`);
    const desktopHud = await feastHudLayout(winPage);
    assert(!desktopHud.panelHidden, `desktop show HUD should be visible during play; got ${JSON.stringify(desktopHud)}`);
    assertInside(desktopHud.panel, desktopHud.stage, "desktop Feast Says panel");
    assert(desktopHud.panel.height <= 58 && desktopHud.commandDisplay === "none" && desktopHud.hintDisplay === "none", `desktop Feast Says must use only a shallow, non-instructional status strip: ${JSON.stringify(desktopHud)}`);
    assert(!desktopHud.speechHidden && desktopHud.speechDisplay !== "none", `desktop Feast Says must keep Mr. Feast's speech visible: ${JSON.stringify(desktopHud)}`);
    await winPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "six-command-round-desktop.png") });
    await winPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "feast-says-long-lens-player-lights-desktop.png") });

    const won = await playSixCommandRound(winPage, "win");
    state = won.state;
    assert(!state.gameOver && state.feastSays.phase === "completed", `a perfect round should complete without eliminating the player; got ${JSON.stringify({ feastSays: state.feastSays, gameOver: state.gameOver })}`);
    assert(state.feastSays.player.qualified && state.feastSays.player.strikes === 0, `the perfect player should qualify without strikes; got ${JSON.stringify(state.feastSays.player)}`);
    assert(state.feastSays.eliminatedContestantId === "kip-solano", `Kip should be the deterministic first-game elimination; got ${state.feastSays.eliminatedContestantId}`);
    const kipStanding = state.feastSays.standings.find((entry) => entry.id === "kip-solano");
    assert(kipStanding?.status === "eliminated", `Kip's standings entry should record elimination; got ${JSON.stringify(kipStanding)}`);
    assert(state.feastSays.clueProgressLocked === false, "finishing Feast Says should unlock investigation");
    assert(state.feastSays.aftermath.active && state.feastSays.aftermath.stage === "kip-speaking", `winning should begin the witnessed Kip aftermath; got ${JSON.stringify(state.feastSays.aftermath)}`);
    assert(state.feastSays.staging.hostStaged && state.contestants.challengeMode === "feast-says-aftermath", `Mr. Feast and the cast should remain staged during the aftermath; got ${JSON.stringify({ feast: state.feastSays.staging, contestants: state.contestants.challengeMode })}`);
    const aftermathKip = state.contestants.entries.find((entry) => entry.id === "kip-solano");
    assert(!aftermathKip?.eliminated && aftermathKip?.modelVisible && !aftermathKip?.interactionRegistered, `Kip should remain visible but unavailable for normal chatter during his scripted loss; got ${JSON.stringify(aftermathKip)}`);
    assert(aftermathKip?.challengeResponse?.motion?.kind === "upset" && aftermathKip.challengeResponse.motion.upperBodyMaximumAngleDegrees >= 8, `Kip needs a visibly slumped upset pose; got ${JSON.stringify(aftermathKip?.challengeResponse)}`);
    assert(state.speech?.speakerId === "kip-solano" && /give back the money|do it again/i.test(state.speech.text || ""), `Kip should plead immediately after losing; got ${JSON.stringify(state.speech)}`);
    const returningSurvivors = state.contestants.entries.filter((entry) => ["mara-voss", "juniper-cross"].includes(entry.id));
    assert(returningSurvivors.every((entry) => entry.aftermathReturn?.active), `both surviving contestants should start walking home; got ${JSON.stringify(returningSurvivors.map((entry) => ({ id: entry.id, aftermathReturn: entry.aftermathReturn })))}`);
    await winPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "kip-elimination-aftermath.png") });

    await winPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(4.9));
    state = await diagnostics(winPage);
    assert(state.feastSays.aftermath.stage === "host-speaking" && state.speech?.speakerId === "mr-feast", `Mr. Feast should answer Kip after the plea; got ${JSON.stringify({ aftermath: state.feastSays.aftermath, speech: state.speech })}`);
    assert(/part of the show/i.test(state.speech.text || ""), `Mr. Feast's response should be ominous without explaining the full horror; got ${JSON.stringify(state.speech?.text)}`);

    const maraDebrief = await winPage.evaluate(() => window.MrFeastFresh.converseWithContestantForQA("mara-voss"));
    assert(/stopped looking at him like a contestant/i.test(maraDebrief?.text || ""), `Mara's first conversation should reflect Feast Says; got ${JSON.stringify(maraDebrief)}`);
    const maraNormal = await winPage.evaluate(() => window.MrFeastFresh.converseWithContestantForQA("mara-voss"));
    assert(maraNormal?.text && maraNormal.text !== maraDebrief.text, `Mara should return to her normal dialogue pool after the one-use debrief; first=${JSON.stringify(maraDebrief)} second=${JSON.stringify(maraNormal)}`);
    state = await diagnostics(winPage);
    const maraDialogue = state.contestants.entries.find((entry) => entry.id === "mara-voss")?.dialogue;
    assert(maraDialogue?.lastKind === "normal" && !state.feastSays.aftermath.postGameDialoguePendingIds.includes("mara-voss"), `Mara's post-game line must be consumed exactly once; got ${JSON.stringify({ maraDialogue, aftermath: state.feastSays.aftermath })}`);

    await winPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(42));
    state = await diagnostics(winPage);
    const returnedMara = state.contestants.entries.find((entry) => entry.id === "mara-voss");
    const returnedJuniper = state.contestants.entries.find((entry) => entry.id === "juniper-cross");
    assert(!returnedMara?.aftermathReturn && !returnedMara?.challengeStaged && returnedMara?.position.x < -6, `Mara should physically return to her Library routine; got ${JSON.stringify(returnedMara)}`);
    assert(!returnedJuniper?.aftermathReturn && !returnedJuniper?.challengeStaged && returnedJuniper?.position.y >= 4.4 && returnedJuniper?.position.x > 5, `Juniper should physically climb back to her Reading Room routine; got ${JSON.stringify(returnedJuniper)}`);

    await winPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(4.6));
    state = await diagnostics(winPage);
    assert(state.feastSays.aftermath.active && state.feastSays.aftermath.stage === "waiting-for-player-exit", `the staged scene should remain while the player stays nearby; got ${JSON.stringify(state.feastSays.aftermath)}`);
    assert(state.feastSays.staging.hostStaged && !state.contestants.entries.find((entry) => entry.id === "kip-solano")?.eliminated, "Mr. Feast and Kip should not vanish in front of a nearby player");

    await teleportForInteraction(winPage, "readingRoom");
    await winPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(0.2));
    state = await diagnostics(winPage);
    const eliminatedKip = state.contestants.entries.find((entry) => entry.id === "kip-solano");
    assert(!state.feastSays.aftermath.active && /player-left:SECOND FLOOR:READING ROOM/.test(state.feastSays.aftermath.cleanupReason || ""), `moving significantly away should resolve the aftermath; got ${JSON.stringify(state.feastSays.aftermath)}`);
    assert(eliminatedKip?.eliminated && !eliminatedKip?.interactionRegistered && !eliminatedKip?.modelVisible, `Kip should disappear only after the player leaves the scene; got ${JSON.stringify(eliminatedKip)}`);
    assert(!state.feastSays.staging.hostStaged && !state.contestants.challengeActive, `Mr. Feast should resume normal pathing after offscreen cleanup; got ${JSON.stringify({ feast: state.feastSays.staging, contestants: state.contestants.challengeActive })}`);
    const eliminatedConversation = await winPage.evaluate(() => window.MrFeastFresh.converseWithContestantForQA("kip-solano"));
    assert(eliminatedConversation === null, `Kip should not speak after disappearing; got ${JSON.stringify(eliminatedConversation)}`);

    // Completed state must persist across a fresh runtime and never retrigger.
    assert(await winPage.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "saving completed Feast Says should succeed");
    await bootPage(winPage);
    assert(await winPage.evaluate(() => window.MrFeastFresh.loadGameForQA()) === true, "loading a completed Feast Says save should succeed");
    await winPage.waitForTimeout(180);
    state = await diagnostics(winPage);
    assert(state.feastSays.phase === "completed" && state.feastSays.eliminatedContestantId === "kip-solano", `completed event state should survive reload; got ${JSON.stringify(state.feastSays)}`);
    const repeatCall = await winPage.evaluate(() => window.MrFeastFresh.callFeastSaysForQA("timer"));
    assert(repeatCall?.started === false, `completed Feast Says must not retrigger; got ${JSON.stringify(repeatCall)}`);
    assert((await feastState(winPage)).callCount === 1, "retrigger attempt must not increase callCount");
    const juniperDebrief = await winPage.evaluate(() => window.MrFeastFresh.converseWithContestantForQA("juniper-cross"));
    assert(/house made room for him/i.test(juniperDebrief?.text || ""), `Juniper's unconsumed post-game line should survive save/load; got ${JSON.stringify(juniperDebrief)}`);
    const juniperNormal = await winPage.evaluate(() => window.MrFeastFresh.converseWithContestantForQA("juniper-cross"));
    assert(juniperNormal?.text && juniperNormal.text !== juniperDebrief.text, `Juniper should return to normal dialogue after the saved one-use debrief; got ${JSON.stringify({ juniperDebrief, juniperNormal })}`);

    await teleportForInteraction(winPage, "contestant13GardenShovel", /take.*shovel|garden shovel/i);
    await pressInteract(winPage);
    state = await diagnostics(winPage);
    assert(state.contestant13.shovelTaken && state.inventory.items.includes("garden-shovel"), `investigation should resume after Feast Says; got ${JSON.stringify(state.contestant13)}`);
    assert(
      state.stormRun?.phase === "called"
        && state.stormRun.triggerReason === "clue"
        && state.stormRun.triggerClueId === "faceless-fountain-shovel"
        && state.stormRun.callCount === 1
        && state.stormRun.clueProgressLocked,
      `the first post-Feast clue should remain earned while calling Storm Run exactly once; got ${JSON.stringify(state.stormRun)}`,
    );
    const stormCallToast = await winPage.evaluate(() => ({
      title: document.getElementById("mansion-discovery-title")?.textContent || "",
      body: document.getElementById("mansion-discovery-body")?.textContent || "",
    }));
    assert(
      /concealed garden shovel|faceless fountain/i.test(stormCallToast.title)
        && /five-checkpoint course|rear terrace/i.test(stormCallToast.body),
      `the earned shovel clue and Storm Run call should share one readable discovery card; got ${JSON.stringify(stormCallToast)}`,
    );
    assert(winErrors.length === 0, `winning-page console errors: ${winErrors.join(" | ")}`);
    await winPage.close();

    // --- Six wrong responses eliminate the player, not another contestant ----
    const lossErrors = [];
    const lossPage = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    watchErrors(lossPage, lossErrors);
    await bootPage(lossPage);
    const forcedCall = await lossPage.evaluate(() => window.MrFeastFresh.callFeastSaysForQA("timer"));
    assert(forcedCall?.started === true, `QA should be able to call a fresh round; got ${JSON.stringify(forcedCall)}`);
    await startBallroomRound(lossPage);
    const lost = await playSixCommandRound(lossPage, "lose");
    state = lost.state;
    assert(state.gameOver?.kind === "feast-says", `losing Feast Says should create its own fail state; got ${JSON.stringify(state.gameOver)}`);
    assert(state.feastSays.eliminatedContestantId === "player", `the losing player should be eliminated; got ${state.feastSays.eliminatedContestantId}`);
    const lossOverlay = await lossPage.evaluate(() => ({
      hidden: document.getElementById("mansion-gameover").hidden,
      title: document.getElementById("mansion-gameover-title")?.textContent || "",
      copy: document.getElementById("mansion-gameover-copy")?.textContent || "",
    }));
    assert(!lossOverlay.hidden && /eliminated/i.test(lossOverlay.title), `player loss should show ELIMINATED instead of CAUGHT; got ${JSON.stringify(lossOverlay)}`);
    assert(/lowest score|last place|competition|eliminated/i.test(lossOverlay.copy), `elimination copy should explain the generic competition rule; got ${JSON.stringify(lossOverlay.copy)}`);
    assert(!/kip|beat\s+\w+/i.test(lossOverlay.copy), `the loss overlay should not leak the deterministic NPC scoring target; got ${JSON.stringify(lossOverlay.copy)}`);
    await lossPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "player-eliminated-desktop.png") });
    assert(lossErrors.length === 0, `losing-page console errors: ${lossErrors.join(" | ")}`);
    await lossPage.close();

    // A missing optional contestant asset cannot permanently lock every clue.
    // The authored score deck remains authoritative while the loaded cast
    // members still stage visibly.
    const fallbackPage = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await fallbackPage.route("**/assets/models/mr-feast/contestants/kip-solano.glb*", (route) => route.abort("failed"));
    await bootPage(fallbackPage, gameUrl, { waitForCast: false });
    await fallbackPage.waitForFunction(() => window.MrFeastFresh.getMrFeastState?.()?.loadStatus === "ready", null, { timeout: 120000 });
    await fallbackPage.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
    const fallbackCast = await fallbackPage.evaluate(() => window.MrFeastFresh.getContestantState());
    assert(fallbackCast.failed === 1 && fallbackCast.challengeReady === false, `the fallback probe should fail only Kip's optional model; got ${JSON.stringify(fallbackCast)}`);
    await fallbackPage.evaluate(() => window.MrFeastFresh.callFeastSaysForQA("timer"));
    await teleportForInteraction(fallbackPage, "feastSaysStaging", /feast says|take your mark|begin|join/i);
    await pressInteract(fallbackPage);
    await fallbackPage.waitForFunction(() => window.MrFeastFresh.getFeastSaysState?.()?.phase === "briefing", null, { timeout: 8000 });
    const fallbackRound = await diagnostics(fallbackPage);
    assert(fallbackRound.feastSays.castReady && fallbackRound.feastSays.staging.contestantsStaged && !fallbackRound.feastSays.staging.contestantsReady, `a settled partial cast must still start Feast Says; got ${JSON.stringify(fallbackRound.feastSays.staging)}`);
    await fallbackPage.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), fallbackRound.feastSays.phaseRemaining + 0.02);
    for (let expectedIndex = 0; expectedIndex < 4; expectedIndex += 1) {
      const physical = await feastState(fallbackPage);
      assert(physical.phase === "command" && physical.command.index === expectedIndex && physical.command.action === FEAST_COMMAND_FLOW[expectedIndex].action, `partial-cast round ${expectedIndex + 1} should retain the authored order; got ${JSON.stringify(physical.command)}`);
      await fallbackPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
      const scored = await fallbackPage.evaluate(() => window.MrFeastFresh.respondToFeastSaysForQA("correct"));
      assert(scored?.correct, `partial-cast physical round ${expectedIndex + 1} should remain scoreable; got ${JSON.stringify(scored)}`);
      const judged = await feastState(fallbackPage);
      await fallbackPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
      await fallbackPage.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), judged.phaseRemaining + 0.02);
    }
    await fallbackPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
    const fallbackPoint = await diagnostics(fallbackPage);
    const visiblePointers = fallbackPoint.contestants.entries.filter((entry) => entry.status === "ready" && entry.challengeResponse?.action === "point");
    assert(fallbackPoint.feastSays.command.action === "point" && visiblePointers.length === 2, `the loaded partial cast should still reach and perform the fifth-round point choice; got ${JSON.stringify(fallbackPoint.contestants.entries.map((entry) => entry.challengeResponse))}`);
    assert(visiblePointers.every((entry) => FEAST_TARGET_IDS.has(entry.challengeResponse.targetId) && entry.challengeResponse.targetId === fallbackPoint.feastSays.command.npcTargets[entry.id] && entry.challengeResponse.motion.upperBodyMaximumAngleDegrees >= 18), `loaded contestants should retain their individual authored targets, including unavailable marks and the player; got ${JSON.stringify(visiblePointers.map((entry) => entry.challengeResponse))}`);
    assert(new Set(visiblePointers.map((entry) => entry.challengeResponse.targetId)).size === visiblePointers.length, `partial-cast point choices should not collapse onto one target; got ${JSON.stringify(visiblePointers.map((entry) => entry.challengeResponse.targetId))}`);
    await aimAtFeastContestant(fallbackPage, "mara-voss", { expectPrompt: true });
    await pressInteract(fallbackPage);
    let fallbackChoice = await feastState(fallbackPage);
    if (fallbackChoice.phase === "command") {
      await fallbackPage.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), fallbackChoice.phaseRemaining + 0.02);
      fallbackChoice = await feastState(fallbackPage);
    }
    assert(fallbackChoice.command.result?.correct && fallbackChoice.command.result.targetId === "mara-voss", `look + E should remain valid when an optional contestant asset is missing; got ${JSON.stringify(fallbackChoice.command)}`);
    await fallbackPage.evaluate(() => window.MrFeastFresh.completeFeastSaysForQA(6));
    assert((await feastState(fallbackPage)).phase === "completed", "the partial-cast fallback should still release the clue gate");
    await fallbackPage.close();

    // --- The live-event HUD and Ballroom start remain usable on a phone -------
    const mobileErrors = [];
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    watchErrors(mobile, mobileErrors);
    await bootPage(mobile);
    const mobileDormantHud = await feastHudLayout(mobile);
    assert(mobileDormantHud.panelHidden && mobileDormantHud.phase === "dormant", `portrait-phone next-game countdown must stay hidden while dormant; got ${JSON.stringify(mobileDormantHud)}`);
    await mobile.evaluate(() => window.MrFeastFresh.callFeastSaysForQA("timer"));
    await startBallroomRound(mobile, true);
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "feast-says-long-lens-player-lights-mobile.png") });

    // Resolve the first three physical calls, including the right-step fake-out,
    // then prove a touch player can also hold through the crouch fake-out.
    for (let expectedIndex = 0; expectedIndex < 3; expectedIndex += 1) {
      const physical = await feastState(mobile);
      assert(physical.phase === "command" && physical.command.index === expectedIndex && physical.command.action === FEAST_COMMAND_FLOW[expectedIndex].action, `phone physical round ${expectedIndex + 1} is out of order; got ${JSON.stringify(physical.command)}`);
      if (expectedIndex > 0) await mobile.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
      const scored = await mobile.evaluate(() => window.MrFeastFresh.respondToFeastSaysForQA("correct"));
      assert(scored?.correct, `phone physical round ${expectedIndex + 1} should score; got ${JSON.stringify(scored)}`);
      const judged = await feastState(mobile);
      await mobile.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
      await mobile.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), judged.phaseRemaining + 0.02);
    }

    let mobileFeast = await feastState(mobile);
    assert(mobileFeast.command.index === 3 && mobileFeast.command.action === "crouch" && !mobileFeast.command.obey, `the fourth phone command should be the crouch fake-out; got ${JSON.stringify(mobileFeast.command)}`);
    await mobile.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
    assert(await mobile.locator("#mansion-feast-crouch").isHidden(), "the crouch fake-out must not expose a misleading challenge action button");
    assert((await feastState(mobile)).player.detectedAction === "still", "the touch player should remain still through the crouch fake-out");
    mobileFeast = await feastState(mobile);
    await mobile.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), mobileFeast.phaseRemaining + 0.02);
    mobileFeast = await feastState(mobile);
    assert(mobileFeast.command.result?.correct && mobileFeast.command.result.expected === "still", `holding still through the mobile crouch fake-out should score; got ${JSON.stringify(mobileFeast.command)}`);
    await mobile.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
    await mobile.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), mobileFeast.phaseRemaining + 0.02);

    mobileFeast = await feastState(mobile);
    assert(mobileFeast.command.index === 4 && mobileFeast.command.action === "point", `the distrust choice should wait until round five; got ${JSON.stringify(mobileFeast.command)}`);
    await mobile.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
    const pointHint = await mobile.locator("#mansion-feast-hint").textContent();
    const pointSpeech = (await diagnostics(mobile)).speech;
    assert(pointHint === "" && /look.*press E/i.test(pointSpeech.text || ""), `the phone point control must be explained by Mr. Feast instead of a HUD hint: ${JSON.stringify({ pointHint, pointSpeech })}`);
    const mobilePointHud = await feastHudLayout(mobile);
    assert(mobilePointHud.phase === "command" && mobilePointHud.hintHidden && mobilePointHud.panel.height <= 58 && mobilePointHud.speechDisplay !== "none", `the point command should use visible speech and the minimal phone strip: ${JSON.stringify(mobilePointHud)}`);
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "point-command-mobile.png") });
    await aimAtFeastContestant(mobile, "juniper-cross", { expectPrompt: true });
    await mobile.locator("#touch-interact").click({ force: true });
    mobileFeast = await feastState(mobile);
    assert(mobileFeast.player.selectedTargetId === "juniper-cross", `touch Interact should select the looked-at contestant; got ${JSON.stringify(mobileFeast.player)}`);
    if (mobileFeast.phase === "command") {
      await mobile.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), mobileFeast.phaseRemaining + 0.02);
      mobileFeast = await feastState(mobile);
    }
    assert(mobileFeast.command.result?.correct && mobileFeast.command.result?.targetId === "juniper-cross", `the phone look + Interact choice should score without judging its target; got ${JSON.stringify(mobileFeast.command)}`);

    const mobileHud = mobilePointHud;
    assert(!mobileHud.panelHidden && mobileHud.crouchHidden && mobileHud.crouch.height === 0 && mobileHud.crouch.width === 0, `the mobile point round should show its HUD without a misleading challenge crouch action; got ${JSON.stringify(mobileHud)}`);
    assert(await mobile.locator("#touch-crouch").isHidden(), "the persistent mobile crouch control should yield throughout Feast Says");
    assert(await mobile.locator("#touch-sprint").isHidden(), "mobile Sprint should yield while Feast Says owns movement input");
    assertInside(mobileHud.panel, mobileHud.stage, "mobile Feast Says panel");
    assert(mobileHud.phase === "command" && mobileHud.panel.height <= 58, `active mobile Feast Says should use a shallow status strip; got ${JSON.stringify(mobileHud)}`);
    assert(mobileHud.commandDisplay === "none" && mobileHud.hintDisplay === "none" && mobileHud.standingsDisplay === "none", `mobile instructions and standings must yield to Mr. Feast's speech: ${JSON.stringify(mobileHud)}`);
    assert(!mobileHud.speechHidden && mobileHud.speechDisplay !== "none", `mobile Feast Says must keep Mr. Feast's speech visible: ${JSON.stringify(mobileHud)}`);
    assert(mobileHud.interactHeight >= 44 && mobileHud.interactWidth >= 44, `mobile E control must remain at least 44px; got ${JSON.stringify(mobileHud.interact)}`);
    assert(!rectanglesOverlap(mobileHud.panel, mobileHud.interact), `mobile event panel overlaps the E control; got ${JSON.stringify(mobileHud)}`);
    assert(!rectanglesOverlap(mobileHud.panel, mobileHud.movement), `mobile event panel overlaps movement controls; got ${JSON.stringify(mobileHud)}`);
    assert(!rectanglesOverlap(mobileHud.panel, mobileHud.tools), `mobile event panel overlaps Bag/Menu; got ${JSON.stringify(mobileHud)}`);
    assert(mobileHud.documentWidth <= mobileHud.viewportWidth + 1, `Feast Says introduced horizontal overflow; got ${JSON.stringify(mobileHud)}`);
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "six-command-round-mobile.png") });

    await mobile.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
    await mobile.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), mobileFeast.phaseRemaining + 0.02);
    mobileFeast = await feastState(mobile);
    assert(mobileFeast.command.index === 5 && mobileFeast.command.action === "approach", `the sacrifice approach should be the sixth phone command; got ${JSON.stringify(mobileFeast.command)}`);
    await mobile.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
    const beforeMobileApproach = await aimAtFeastContestant(mobile, "mara-voss");
    const approachSession = await mobile.context().newCDPSession(mobile);
    await holdTouchDirection(mobile, approachSession, "forward", { expectedAction: "approach", advanceSeconds: 0.38 });
    await approachSession.detach();
    mobileFeast = await feastState(mobile);
    assert(mobileFeast.player.detectedTargetId === "mara-voss" && mobileFeast.player.distanceFromMark > beforeMobileApproach.feastSays.player.distanceFromMark + 0.4, `the phone sacrifice choice should come from actual movement toward Mara; before=${JSON.stringify(beforeMobileApproach.feastSays.player)} after=${JSON.stringify(mobileFeast.player)}`);
    await mobile.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), mobileFeast.phaseRemaining + 0.02);
    mobileFeast = await feastState(mobile);
    assert(mobileFeast.command.result?.correct && mobileFeast.command.result.targetId === "mara-voss", `the phone approach choice should score without judging its target; got ${JSON.stringify(mobileFeast.command)}`);
    await mobile.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
    await mobile.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), mobileFeast.phaseRemaining + 0.02);
    assert((await feastState(mobile)).phase === "completed", "the six-command phone route should complete and release the clue gate");
    assert(mobileErrors.length === 0, `mobile console errors: ${mobileErrors.join(" | ")}`);
    await mobile.close();

    console.log("Mr. Feast Feast Says event checks passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
