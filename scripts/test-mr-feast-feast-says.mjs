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

async function startBallroomRound(page, useTouch = false) {
  await teleportForInteraction(page, "feastSaysStaging", /feast says|take your mark|begin|join/i);
  if (useTouch) await page.locator("#touch-interact").click({ force: true });
  else await pressInteract(page);
  await page.waitForFunction(() => window.MrFeastFresh.getFeastSaysState?.()?.phase === "briefing", null, { timeout: 8000 });
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
  await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(7));
  await page.waitForFunction(() => {
    const current = window.MrFeastFresh.getFeastSaysState?.();
    return current?.phase === "command" && current?.command;
  }, null, { timeout: 8000 });
  const state = await diagnostics(page);
  assert(state.room === "BALLROOM", `Feast Says must begin in the Ballroom; got room=${state.room}`);
  assert(state.feastSays.staging?.contestantsReady === true, `all contestants should be staged before play; got ${JSON.stringify(state.feastSays.staging)}`);
  assert(state.speech?.speakerId === "mr-feast" && state.speech?.text === state.feastSays.command.text, `Mr. Feast should visibly deliver the live command; got ${JSON.stringify(state.speech)}`);
  const responseStart = state.contestants.entries.map((entry) => entry.challengeResponse?.progress).filter(Number.isFinite);
  assert(responseStart.length === 3 && responseStart.every((progress) => progress >= 0 && progress < 0.35), `contestants should begin each eased response near their marks; got ${JSON.stringify(responseStart)}`);
  await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.18));
  const responseMid = (await diagnostics(page)).contestants.entries.map((entry) => entry.challengeResponse?.progress).filter(Number.isFinite);
  assert(responseMid.some((progress) => progress > 0 && progress < 1), `contestant actions should ease instead of snapping; got ${JSON.stringify(responseMid)}`);
  await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.8));
  const settled = await diagnostics(page);
  const responseEnd = settled.contestants.entries.map((entry) => entry.challengeResponse?.progress).filter(Number.isFinite);
  assert(responseEnd.length === 3 && responseEnd.every((progress) => progress === 1), `contestant responses should reach their authored poses; got ${JSON.stringify(responseEnd)}`);
  assert(settled.feastSays.command.text === "Feast says point to the person you trust the least." && settled.feastSays.command.action === "point", `the live round should open with the requested trust prompt; got ${JSON.stringify(settled.feastSays.command)}`);
  assert(JSON.stringify(settled.feastSays.command.acceptedActions) === JSON.stringify(["left", "forward", "right"]), `the trust prompt should expose all three fair directional choices; got ${JSON.stringify(settled.feastSays.command)}`);
  const pointTargets = Object.fromEntries(settled.contestants.entries.map((entry) => [entry.id, entry.challengeResponse?.targetId]));
  assert(pointTargets["mara-voss"] === "kip-solano" && pointTargets["kip-solano"] === "mara-voss" && pointTargets["juniper-cross"] === "kip-solano", `contestants should make authored trust choices; got ${JSON.stringify(pointTargets)}`);
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
      assert(response.targetId && /^(?:mara-voss|kip-solano|juniper-cross)$/.test(response.targetId), `${entry.id} must point at an authored contestant target; got ${JSON.stringify(response)}`);
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
    }
  }
}

function assertContestantLocomotionInFlight(command, state) {
  if (!["left", "right", "back"].includes(command.action)) return;
  const movers = state.contestants.entries.filter((entry) => (
    entry.challengeResponse?.action !== "still"
      && entry.challengeResponse?.progress > 0
      && entry.challengeResponse?.progress < 1
  ));
  assert(movers.length > 0, `round ${command.index + 1} needs an observable in-flight gait; got ${JSON.stringify(state.contestants.entries.map((entry) => entry.challengeResponse))}`);
  for (const entry of movers) {
    const response = entry.challengeResponse;
    assert(entry.animation.name === "walk", `${entry.id} ${response.action} should use the walk clip only while translating; got ${JSON.stringify(entry.animation)}`);
    if (response.action === "back") {
      assert(entry.animation.playbackRate < 0, `${entry.id} backpedal should reverse the walk clip while moving outward; got ${JSON.stringify(entry.animation)}`);
      assert(response.motion.torsoTiltDegrees <= 25, `${entry.id} backpedal should read as an upright backward walk, not a fall; got ${JSON.stringify(response.motion)}`);
    } else {
      assert(entry.animation.playbackRate > 0, `${entry.id} sidestep should advance the walk clip while moving outward; got ${JSON.stringify(entry.animation)}`);
    }
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

async function playSixCommandRound(page, intendedOutcome) {
  const observed = [];
  const answered = new Set();

  for (let guard = 0; guard < 160; guard += 1) {
    const state = await diagnostics(page);
    const feast = state.feastSays;
    if (state.gameOver || feast.phase === "completed") break;
    if (feast.phase === "result") {
      await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(2));
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
    assert(typeof command.obey === "boolean" && typeof command.action === "string", `command diagnostics must expose obey/action; got ${JSON.stringify(command)}`);

    await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.32));
    const movingMotion = await diagnostics(page);
    assertContestantLocomotionInFlight(command, movingMotion);
    if (intendedOutcome === "win" && ["left", "right", "back"].includes(command.action)) {
      const visualProofName = {
        left: "contestant-sidestep-left-desktop.png",
        right: "contestant-sidestep-right-desktop.png",
        back: "contestant-backpedal-desktop.png",
      }[command.action];
      await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, visualProofName) });
    }
    await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.68));
    const stagedMotion = await diagnostics(page);
    assertContestantResponseMotion(command, stagedMotion);
    if (intendedOutcome === "win" && !["left", "right", "back"].includes(command.action)) {
      const visualProofName = {
        point: "contestant-point-desktop.png",
        crouch: "contestant-crouch-desktop.png",
      }[command.action];
      if (visualProofName) {
        await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, visualProofName) });
      }
    }

    const responseAction = intendedOutcome === "win"
      ? (command.obey ? (command.action === "point" ? "forward" : command.action) : "ignore")
      : (command.obey ? wrongActionFor(command.action) : command.action);
    let result;
    const useRealForward = intendedOutcome === "win" && command.index === 0 && command.action === "forward";
    const useRealPoint = intendedOutcome === "win" && command.action === "point";
    const useRealCrouch = intendedOutcome === "win" && command.obey && command.action === "crouch";
    if (useRealForward || useRealPoint || useRealCrouch) {
      if (useRealForward || useRealPoint) {
        await page.keyboard.down("w");
        try {
          await page.waitForFunction(
            () => window.MrFeastFresh.getFeastSaysState?.()?.player?.detectedAction === "forward",
            null,
            { timeout: 2500, polling: 50 },
          );
        } finally {
          await page.keyboard.up("w");
        }
      } else {
        await page.keyboard.press("c");
      }
      const liveInput = await feastState(page);
      assert(liveInput.player.detectedAction === (useRealPoint ? "forward" : command.action), `real ${command.action} input was not detected; got ${JSON.stringify(liveInput.player)}`);
      if (useRealPoint) {
        assert(liveInput.player.detectedTargetId === "kip-solano", `W/up should point to Kip during the trust command; got ${JSON.stringify(liveInput.player)}`);
      }
      await page.evaluate(
        (seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds),
        liveInput.phaseRemaining + 0.02,
      );
      const resolved = await feastState(page);
      result = { accepted: true, ...(resolved.command?.result || {}) };
    } else {
      result = await page.evaluate(
        (action) => window.MrFeastFresh.respondToFeastSaysForQA(action),
        responseAction,
      );
    }
    assert(result?.accepted === true, `focused QA response was rejected; command=${JSON.stringify(command)} result=${JSON.stringify(result)}`);
    assert(result.correct === (intendedOutcome === "win"), `command result drifted from the intended ${intendedOutcome}; got ${JSON.stringify(result)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.24));
    const returning = await diagnostics(page);
    const returningResponses = returning.contestants.entries.filter((entry) => entry.status === "ready").map((entry) => entry.challengeResponse);
    assert(returningResponses.every((response) => response?.returning && response.progress > 0 && response.progress < 1), `contestants should ease back during the result instead of snapping at the next command; got ${JSON.stringify(returningResponses)}`);
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
    await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(0.8));
    assertContestantResponsesReturned(await diagnostics(page));
    answered.add(key);
    observed.push({ ...command, responseAction, result });
    await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(0.25));
  }

  const state = await diagnostics(page);
  assert(observed.length === 6, `the round should resolve exactly six unique commands; got ${JSON.stringify(observed)}`);
  assert(observed.some((entry) => entry.obey) && observed.some((entry) => !entry.obey), `the authored deck needs both real commands and decoys; got ${JSON.stringify(observed)}`);
  assert(observed.filter((entry) => !entry.obey).length === 2, `the psychological deck should retain exactly two fair decoys; got ${JSON.stringify(observed)}`);
  const trustPrompt = observed.find((entry) => entry.text === "Feast says point to the person you trust the least.");
  assert(trustPrompt?.action === "point", `the exact trust prompt should remain a scored pointing command; got ${JSON.stringify(trustPrompt)}`);
  if (intendedOutcome === "win") {
    assert(trustPrompt.result?.targetId === "kip-solano" && trustPrompt.result?.correct, `the exact trust prompt should accept the real W/up choice and record Kip; got ${JSON.stringify(trustPrompt)}`);
  } else {
    assert(!trustPrompt.result?.correct && trustPrompt.result?.targetId === null, `a non-choice response must fail the trust prompt; got ${JSON.stringify(trustPrompt)}`);
  }
  const coerciveCount = observed.filter((entry) => /trust|save you|betray|leave the others|hiding what you know|sacrifice/i.test(entry.text)).length;
  assert(coerciveCount >= 4, `at least four commands should carry the requested psychological pressure; got ${JSON.stringify(observed.map((entry) => entry.text))}`);
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

async function holdTouchDirection(page, session, direction) {
  const button = await page.locator(`#touch-${direction}`).boundingBox();
  assert(button, `the mobile ${direction} action needs its visible touch control`);
  const center = { x: button.x + button.width / 2, y: button.y + button.height / 2 };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, ...center }],
  });
  try {
    try {
      await page.waitForFunction(
        (expected) => window.MrFeastFresh.getFeastSaysState?.()?.player?.detectedAction === expected,
        direction,
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
      throw new Error(`visible touch-${direction} did not reach the live command detector; input=${JSON.stringify(probe)} player=${JSON.stringify((await feastState(page)).player)}`);
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
    assert(layout.panel.height <= 90, `landscape command ${expectedIndex + 1} is taller than 90px; got ${JSON.stringify(layout)}`);
    assert(layout.panel.height <= layout.stage.height * 0.48, `landscape command ${expectedIndex + 1} consumes too much of the stage; got ${JSON.stringify(layout)}`);
    assert(layout.commandFontPx >= 16, `landscape command ${expectedIndex + 1} text is too small at ${layout.commandFontPx}px`);
    assert(layout.leaderboardDisplay === "none", `landscape command ${expectedIndex + 1} must hide the global Scores control so it cannot intercept movement; got ${JSON.stringify(layout)}`);
    assert(Object.values(layout.auxiliaryHudDisplays).every((display) => display === "none"), `landscape command ${expectedIndex + 1} should yield duplicate and irrelevant HUDs; got ${JSON.stringify(layout.auxiliaryHudDisplays)}`);
    assert(layout.crouch.height >= 44 && layout.crouch.width >= 44, `landscape command ${expectedIndex + 1} lost its 44px crouch target; got ${JSON.stringify(layout.crouch)}`);
    assert(!rectanglesOverlap(layout.panel, layout.movement), `landscape command ${expectedIndex + 1} overlaps movement controls; got ${JSON.stringify(layout)}`);
    assert(!rectanglesOverlap(layout.panel, layout.interact), `landscape command ${expectedIndex + 1} overlaps the interaction control; got ${JSON.stringify(layout)}`);
    assert(layout.documentWidth <= layout.viewportWidth + 1, `landscape command ${expectedIndex + 1} introduced horizontal overflow; got ${JSON.stringify(layout)}`);

    if (before.command.obey) {
      const action = before.command.action === "point" ? "right" : before.command.action;
      if (action === "crouch") {
        await page.locator("#mansion-feast-crouch").click({ force: true });
        assert((await feastState(page)).player.detectedAction === "crouch", `command ${expectedIndex + 1} did not accept the visible mobile crouch action`);
      } else {
        await holdTouchDirection(page, touchSession, action);
      }
    } else {
      assert(before.player.detectedAction === "still", `decoy command ${expectedIndex + 1} should begin with the player holding still; got ${JSON.stringify(before.player)}`);
    }

    const active = await feastState(page);
    await page.evaluate(
      (seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds),
      active.phaseRemaining + 0.02,
    );
    const resolved = await feastState(page);
    assert(resolved.phase === "result" && resolved.command.result?.correct, `touch-only command ${expectedIndex + 1} should score correctly; got ${JSON.stringify(resolved.command)}`);
    if (before.command.action === "point") {
      assert(resolved.command.result.targetId === "juniper-cross", `touch-right should point to Juniper; got ${JSON.stringify(resolved.command.result)}`);
    }
    observed.push({ text: before.command.text, obey: before.command.obey, action: before.command.action });
    await page.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(2));
  }
  await touchSession.detach();

  await page.waitForFunction(() => window.MrFeastFresh.getFeastSaysState?.()?.phase === "completed", null, { timeout: 8000 });
  const completed = await diagnostics(page);
  assert(observed.length === 6 && observed.filter((entry) => !entry.obey).length === 2, `touch-only landscape run must complete all six commands and ignore two decoys; got ${JSON.stringify(observed)}`);
  assert(completed.feastSays.player.score === 6 && completed.feastSays.player.qualified, `touch-only landscape player should qualify with a perfect score; got ${JSON.stringify(completed.feastSays)}`);
  const eliminatedKip = completed.contestants.entries.find((entry) => entry.id === "kip-solano");
  assert(completed.feastSays.eliminatedContestantId === "kip-solano" && eliminatedKip?.eliminated, `touch-only landscape completion should eliminate Kip; got ${JSON.stringify({ feast: completed.feastSays.eliminatedContestantId, kip: eliminatedKip })}`);
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
    const auxiliaryHud = ["mansion-energy", "mansion-stealth", "mansion-security", "mansion-speech"]
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
  assert(/const CONTESTANT_FEAST_SAYS_MOTION\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing named contestant response-animation tuning");
  assert(/class FeastSaysSystem/.test(runtimeSource), "runtime is missing the FeastSaysSystem state machine");
  assert(/feastSays:\s*feastSaysSystem\?\.getDiagnostics/.test(runtimeSource), "render_game_to_text must expose Feast Says diagnostics");
  for (const hook of ["getFeastSaysState", "advanceFeastSaysForQA", "advanceFeastSaysCastForQA", "callFeastSaysForQA", "respondToFeastSaysForQA"]) {
    assert(runtimeSource.includes(hook), `runtime is missing the focused ${hook} QA hook`);
  }

  assert(/function competitionBlocksInvestigation\(\)[\s\S]{0,180}activeCompetitionSystem\(\)/.test(runtimeSource), "clue carriers need one centralized active-competition gate");
  assert(/function noteMajorClueDiscovered\(clueId\)[\s\S]{0,420}feastSaysSystem\?\.noteClueDiscovered\(clueId\)[\s\S]{0,420}stormRunSystem\?\.noteClueDiscovered\(clueId\)/.test(runtimeSource), "earned clues must dispatch through Feast Says and then Storm Run");
  assert(/feastSaysSystem\?\.update\(Math\.min\(rawDt, FEAST_SAYS\.maximumTimerStepSeconds\)\)/.test(runtimeSource), "the live show clock must consume capped wall time instead of physics-clamped frame time");
  assert(runtimeSource.includes('text: "Feast says point to the person you trust the least."'), "the command deck is missing the exact requested trust prompt");
  assert(/acceptedActions:\s*Object\.freeze\(\["left",\s*"forward",\s*"right"\]\)/.test(runtimeSource), "the trust prompt must accept the three existing directional choices");
  assert(/targetByAction:\s*Object\.freeze/.test(runtimeSource), "the trust prompt must map each direction to a named contestant");
  assert(/applyChallengeResponsePose\(/.test(runtimeSource), "contestant responses need a challenge-only skeletal pose layer");
  assert(/returnSeconds:\s*0\.[5-9]/.test(runtimeSource), "contestant response motion needs a named eased-return duration");
  assert(/returnChallengeResponses\(/.test(runtimeSource), "contestant responses must ease back to their marks during the result phase");
  assert(/FEAST_SAYS\.contestantMarks\[targetId\]/.test(runtimeSource), "point gestures need an authored-mark fallback when a target model is unavailable");
  assert(/stabilizeChallengeBackpedalTorso\(/.test(runtimeSource), "backpedal gait needs an upright challenge-only torso stabilizer");

  assert(/feastSays:\s*feastSaysSystem\?\.getSnapshot\(\)/.test(runtimeSource), "mansion saves must serialize Feast Says progress");
  assert(/feastSaysSystem\?\.restoreSnapshot\(data\.feastSays/.test(runtimeSource), "mansion loads must restore Feast Says progress");
  for (const id of ["mansion-feast-says", "mansion-feast-command", "mansion-feast-hint", "mansion-feast-score", "mansion-feast-timer", "mansion-feast-crouch"]) {
    assert(pageSource.includes(`id="${id}"`), `page is missing #${id}`);
  }
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
    assert(!dormantDesktopHud.panelHidden && dormantDesktopHud.phase === "dormant", `desktop dormant countdown should be visible after the welcome; got ${JSON.stringify(dormantDesktopHud)}`);
    assertInside(dormantDesktopHud.panel, dormantDesktopHud.stage, "desktop dormant countdown");
    assert(dormantDesktopHud.panel.width <= 360 && dormantDesktopHud.panel.height <= 48, `desktop dormant countdown should be a small strip, not the active command card; got ${JSON.stringify(dormantDesktopHud)}`);
    assert(dormantDesktopHud.roundDisplay === "none" && dormantDesktopHud.footerDisplay === "none", `dormant countdown should hide round/score chrome; got ${JSON.stringify(dormantDesktopHud)}`);
    assert(dormantDesktopHud.timer.width <= 54 && dormantDesktopHud.timer.height <= 20 && dormantDesktopHud.timerFontPx >= 12, `dormant countdown timer should render inline and remain readable; got ${JSON.stringify(dormantDesktopHud)}`);
    assert(dormantDesktopHud.commandOverflow <= 1, `dormant countdown label should not clip; got ${JSON.stringify(dormantDesktopHud)}`);
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
    await timerPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "timer-call-desktop.png") });
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
    assert(!dormantLandscapeHud.panelHidden && dormantLandscapeHud.phase === "dormant", `short-landscape dormant countdown should be visible; got ${JSON.stringify(dormantLandscapeHud)}`);
    assertInside(dormantLandscapeHud.panel, dormantLandscapeHud.stage, "short-landscape dormant countdown");
    assert(dormantLandscapeHud.panel.width <= 320 && dormantLandscapeHud.panel.height <= 48, `short-landscape dormant countdown should stay compact; got ${JSON.stringify(dormantLandscapeHud)}`);
    assert(dormantLandscapeHud.roundDisplay === "none" && dormantLandscapeHud.footerDisplay === "none", `short-landscape dormant countdown should hide active-round chrome; got ${JSON.stringify(dormantLandscapeHud)}`);
    assert(dormantLandscapeHud.commandOverflow <= 1, `short-landscape dormant label should not clip; got ${JSON.stringify(dormantLandscapeHud)}`);
    assert(!rectanglesOverlap(dormantLandscapeHud.panel, dormantLandscapeHud.location), `short-landscape dormant countdown overlaps the room label; got ${JSON.stringify(dormantLandscapeHud)}`);
    assert(!rectanglesOverlap(dormantLandscapeHud.panel, dormantLandscapeHud.tools), `short-landscape dormant countdown overlaps Bag/Menu; got ${JSON.stringify(dormantLandscapeHud)}`);
    assert(!rectanglesOverlap(dormantLandscapeHud.panel, dormantLandscapeHud.sprint), `short-landscape dormant countdown overlaps Sprint; got ${JSON.stringify(dormantLandscapeHud)}`);
    assert(!rectanglesOverlap(dormantLandscapeHud.panel, dormantLandscapeHud.touchCrouch), `short-landscape dormant countdown overlaps Crouch; got ${JSON.stringify(dormantLandscapeHud)}`);
    await landscapeCountdownPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "dormant-countdown-landscape.png") });

    await landscapeCountdownPage.waitForFunction(() => window.MrFeastFresh.getMrFeastState?.()?.loadStatus === "ready", null, { timeout: 120000 });
    await landscapeCountdownPage.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
    const landscapeCall = await landscapeCountdownPage.evaluate(() => window.MrFeastFresh.callFeastSaysForQA("timer"));
    assert(landscapeCall?.started, `short-landscape QA call should start; got ${JSON.stringify(landscapeCall)}`);
    await startBallroomRound(landscapeCountdownPage, true);
    const activeLandscapeHud = await feastHudLayout(landscapeCountdownPage);
    assert(activeLandscapeHud.phase === "command" && !activeLandscapeHud.hintHidden, `short-landscape should retain the trust choice and its hint; got ${JSON.stringify(activeLandscapeHud)}`);
    assertInside(activeLandscapeHud.panel, activeLandscapeHud.stage, "short-landscape active trust card");
    assert(activeLandscapeHud.panel.height <= 90 && activeLandscapeHud.panel.height <= activeLandscapeHud.stage.height * 0.48, `short-landscape live card should use little vertical space; got ${JSON.stringify(activeLandscapeHud)}`);
    assert(activeLandscapeHud.commandFontPx >= 15, `short-landscape trust command is too small at ${activeLandscapeHud.commandFontPx}px`);
    assert(activeLandscapeHud.commandOverflow <= 1, `short-landscape trust command should wrap inside its card; got ${JSON.stringify(activeLandscapeHud)}`);
    assert(activeLandscapeHud.locationDisplay === "none" && activeLandscapeHud.toolsDisplay === "none", `nonessential top HUDs should yield to the short-landscape live challenge; got ${JSON.stringify(activeLandscapeHud)}`);
    assert(!rectanglesOverlap(activeLandscapeHud.panel, activeLandscapeHud.movement), `short-landscape trust card overlaps movement choices; got ${JSON.stringify(activeLandscapeHud)}`);
    assert(!rectanglesOverlap(activeLandscapeHud.panel, activeLandscapeHud.interact), `short-landscape trust card overlaps the E control; got ${JSON.stringify(activeLandscapeHud)}`);
    await landscapeCountdownPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "point-command-landscape.png") });
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
    assert(compactLandscapeHud.panel.height <= 90 && compactLandscapeHud.panel.height <= compactLandscapeHud.stage.height * 0.48, `compact 568×320 live card should stay below the landscape budget; got ${JSON.stringify(compactLandscapeHud)}`);
    assert(!rectanglesOverlap(compactLandscapeHud.panel, compactLandscapeHud.movement) && !rectanglesOverlap(compactLandscapeHud.panel, compactLandscapeHud.interact), `compact 568×320 live card should clear all touch controls; got ${JSON.stringify(compactLandscapeHud)}`);
    await compactLandscapePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "point-command-compact-landscape.png") });
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
    assert(/concealed garden shovel/i.test(shovelToast.title) && /production has called/i.test(shovelToast.body), `the shovel clue and live call should share one readable discovery card; got ${JSON.stringify(shovelToast)}`);
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
      midRound.command.obey ? midRound.command.action : "ignore",
    );
    assert(firstResult.accepted && firstResult.correct, `the transient save setup should score once; got ${JSON.stringify(firstResult)}`);
    await winPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(2));
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
    await winPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(600));
    feast = await feastState(winPage);
    assert(feast.phase === "called" && feast.callCount === 1 && feast.triggerReason === "clue", `timer and blocked clues must not queue a duplicate call; got ${JSON.stringify(feast)}`);

    // --- A perfect six-command round eliminates Kip and unlocks investigation
    state = await startBallroomRound(winPage);
    assert(state.feastSays.command.total === 6, `the staged round should expose six commands; got ${JSON.stringify(state.feastSays.command)}`);
    const desktopHud = await feastHudLayout(winPage);
    assert(!desktopHud.panelHidden, `desktop show HUD should be visible during play; got ${JSON.stringify(desktopHud)}`);
    assertInside(desktopHud.panel, desktopHud.stage, "desktop Feast Says panel");
    assert(desktopHud.commandFontPx >= 14, `desktop command text is too small at ${desktopHud.commandFontPx}px`);
    await winPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "six-command-round-desktop.png") });

    const won = await playSixCommandRound(winPage, "win");
    state = won.state;
    assert(!state.gameOver && state.feastSays.phase === "completed", `a perfect round should complete without eliminating the player; got ${JSON.stringify({ feastSays: state.feastSays, gameOver: state.gameOver })}`);
    assert(state.feastSays.player.qualified && state.feastSays.player.strikes === 0, `the perfect player should qualify without strikes; got ${JSON.stringify(state.feastSays.player)}`);
    assert(state.feastSays.eliminatedContestantId === "kip-solano", `Kip should be the deterministic first-game elimination; got ${state.feastSays.eliminatedContestantId}`);
    const kipStanding = state.feastSays.standings.find((entry) => entry.id === "kip-solano");
    assert(kipStanding?.status === "eliminated", `Kip's standings entry should record elimination; got ${JSON.stringify(kipStanding)}`);
    assert(state.feastSays.clueProgressLocked === false, "finishing Feast Says should unlock investigation");
    const eliminatedKip = state.contestants.entries.find((entry) => entry.id === "kip-solano");
    assert(eliminatedKip?.eliminated && !eliminatedKip?.interactionRegistered && !eliminatedKip?.modelVisible, `an eliminated contestant must leave both the scene and interaction registry; got ${JSON.stringify(eliminatedKip)}`);
    const eliminatedConversation = await winPage.evaluate(() => window.MrFeastFresh.converseWithContestantForQA("kip-solano"));
    assert(eliminatedConversation === null, `Kip should not speak after elimination; got ${JSON.stringify(eliminatedConversation)}`);

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
      /concealed garden shovel/i.test(stormCallToast.title)
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
    assert(/feast says|last place|competition/i.test(lossOverlay.copy), `elimination copy should explain the competition loss; got ${JSON.stringify(lossOverlay.copy)}`);
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
    await fallbackPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(7));
    await fallbackPage.evaluate(() => window.MrFeastFresh.advanceFeastSaysCastForQA(1));
    const fallbackPoint = await diagnostics(fallbackPage);
    const visiblePointers = fallbackPoint.contestants.entries.filter((entry) => entry.status === "ready" && entry.challengeResponse?.action === "point");
    assert(visiblePointers.length === 2, `the loaded partial cast should still perform the opening point command; got ${JSON.stringify(fallbackPoint.contestants.entries.map((entry) => entry.challengeResponse))}`);
    assert(visiblePointers.every((entry) => entry.challengeResponse.targetId === "kip-solano" && entry.challengeResponse.motion.upperBodyMaximumAngleDegrees >= 18), `loaded contestants should point toward Kip's authored mark even when his model is unavailable; got ${JSON.stringify(visiblePointers.map((entry) => entry.challengeResponse))}`);
    const fallbackLeftChoice = await fallbackPage.evaluate(() => window.MrFeastFresh.respondToFeastSaysForQA("left"));
    assert(fallbackLeftChoice?.correct && fallbackLeftChoice.targetId === "mara-voss", `A/left should remain a valid trust choice in a partial cast; got ${JSON.stringify(fallbackLeftChoice)}`);
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
    assert(mobileDormantHud.phase === "dormant" && mobileDormantHud.panel.width <= 242 && mobileDormantHud.panel.height <= 44, `portrait-phone dormant countdown should stay compact; got ${JSON.stringify(mobileDormantHud)}`);
    assert(!rectanglesOverlap(mobileDormantHud.panel, mobileDormantHud.location) && !rectanglesOverlap(mobileDormantHud.panel, mobileDormantHud.tools), `portrait-phone dormant countdown should not cover the room label or Bag/Menu; got ${JSON.stringify(mobileDormantHud)}`);
    assert(!rectanglesOverlap(mobileDormantHud.panel, mobileDormantHud.sprint) && !rectanglesOverlap(mobileDormantHud.panel, mobileDormantHud.touchCrouch), `portrait-phone dormant countdown should not cover Sprint/Crouch; got ${JSON.stringify(mobileDormantHud)}`);
    await mobile.evaluate(() => window.MrFeastFresh.callFeastSaysForQA("timer"));
    await startBallroomRound(mobile, true);
    const pointHint = await mobile.locator("#mansion-feast-hint").textContent();
    assert(/Mara/i.test(pointHint) && /Kip/i.test(pointHint) && /Juniper/i.test(pointHint), `the point round should explain the three keyboard/touch choices; got ${JSON.stringify(pointHint)}`);
    const mobilePointHud = await feastHudLayout(mobile);
    assert(mobilePointHud.phase === "command" && !mobilePointHud.hintHidden && mobilePointHud.panel.height <= 126, `the hinted point command should fit the active phone card; got ${JSON.stringify(mobilePointHud)}`);
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "point-command-mobile.png") });
    const rightButton = await mobile.locator("#touch-right").boundingBox();
    assert(rightButton, "the phone trust-choice test needs the real touch-right control");
    const touchSession = await mobile.context().newCDPSession(mobile);
    await touchSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: rightButton.x + rightButton.width / 2, y: rightButton.y + rightButton.height / 2 }],
    });
    try {
      await mobile.waitForFunction(
        () => window.MrFeastFresh.getFeastSaysState?.()?.player?.detectedAction === "right",
        null,
        { timeout: 3500, polling: 50 },
      );
    } finally {
      await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await touchSession.detach();
    }
    let mobileFeast = await feastState(mobile);
    assert(mobileFeast.player.detectedTargetId === "juniper-cross", `D/right should choose Juniper on the phone layout; got ${JSON.stringify(mobileFeast.player)}`);
    await mobile.evaluate((seconds) => window.MrFeastFresh.advanceFeastSaysForQA(seconds), mobileFeast.phaseRemaining + 0.02);
    mobileFeast = await feastState(mobile);
    assert(mobileFeast.command.result?.correct && mobileFeast.command.result?.targetId === "juniper-cross", `the phone trust choice should score without judging its target; got ${JSON.stringify(mobileFeast.command)}`);
    await mobile.evaluate(() => window.MrFeastFresh.advanceFeastSaysForQA(2));
    await mobile.waitForFunction(() => window.MrFeastFresh.getFeastSaysState?.()?.phase === "command", null, { timeout: 4000 });
    await mobile.locator("#mansion-feast-crouch").click({ force: true });
    assert((await feastState(mobile)).player.detectedAction === "crouch", "the challenge-only mobile crouch button should feed the live command detector");
    await mobile.locator("#mansion-feast-crouch").click({ force: true });
    const mobileHud = await feastHudLayout(mobile);
    assert(!mobileHud.panelHidden && !mobileHud.crouchHidden, `mobile show HUD and challenge crouch should be visible during play; got ${JSON.stringify(mobileHud)}`);
    assert(await mobile.locator("#touch-crouch").isHidden(), "the persistent mobile crouch control should yield to the challenge-specific crouch button");
    assert(await mobile.locator("#touch-sprint").isHidden(), "mobile Sprint should yield while Feast Says owns movement input");
    assertInside(mobileHud.panel, mobileHud.stage, "mobile Feast Says panel");
    assert(mobileHud.phase === "command" && mobileHud.panel.height <= 126, `active mobile Feast Says should use a shallow command card; got ${JSON.stringify(mobileHud)}`);
    assert(mobileHud.commandFontPx >= 16, `mobile command text is too small at ${mobileHud.commandFontPx}px`);
    assert(mobileHud.standingsDisplay === "none", `mobile standings should yield to the command, timer, score, and action; got ${JSON.stringify(mobileHud)}`);
    assert(mobileHud.interactHeight >= 44 && mobileHud.interactWidth >= 44, `mobile E control must remain at least 44px; got ${JSON.stringify(mobileHud.interact)}`);
    assert(mobileHud.crouch.height >= 44 && mobileHud.crouch.width >= 44, `mobile Feast Says crouch control must remain at least 44px; got ${JSON.stringify(mobileHud.crouch)}`);
    assert(!rectanglesOverlap(mobileHud.panel, mobileHud.interact), `mobile event panel overlaps the E control; got ${JSON.stringify(mobileHud)}`);
    assert(!rectanglesOverlap(mobileHud.panel, mobileHud.movement), `mobile event panel overlaps movement controls; got ${JSON.stringify(mobileHud)}`);
    assert(!rectanglesOverlap(mobileHud.panel, mobileHud.tools), `mobile event panel overlaps Bag/Menu; got ${JSON.stringify(mobileHud)}`);
    assert(mobileHud.documentWidth <= mobileHud.viewportWidth + 1, `Feast Says introduced horizontal overflow; got ${JSON.stringify(mobileHud)}`);
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "six-command-round-mobile.png") });
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
