import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const milestonePath = path.join(root, "docs", "milestones", "66-victory-feast-escape-prototype.md");
const saintVoicePath = path.join(root, "assets", "Sounds", "mr-feast", "saint-voice-low-long-05.ogg");
const port = Number(process.env.MR_FEAST_VICTORY_FEAST_TEST_PORT || (61000 + (process.pid % 4000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-victory-feast");

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

function watchErrors(page, errors, label = "page") {
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text())) {
      errors.push(`${label}: ${message.text()}`);
    }
  });
}

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function victoryState(page) {
  return page.evaluate(() => window.MrFeastFresh.getVictoryFeastState());
}

async function bootPage(browser, viewport, errors, contextOptions = {}) {
  const page = await browser.newPage({ viewport, ...contextOptions });
  watchErrors(page, errors, `${viewport.width}x${viewport.height}`);
  await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 180000 });
  await page.waitForFunction(
    () => ["ready", "error"].includes(window.MrFeastFresh.getMrFeastState?.()?.loadStatus),
    null,
    { timeout: 180000 },
  );
  await page.waitForFunction(() => Boolean(window.MrFeastFresh.getVictoryFeastState), null, { timeout: 10000 });
  return page;
}

async function assertSourceContract() {
  const [runtime, html, milestone, saintVoice] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
    readFile(milestonePath, "utf8"),
    readFile(saintVoicePath).catch(() => null),
  ]);

  // Red-first: these checks intentionally stop before the browser until the
  // complete authoritative finale surface has been added.
  assert(
    /const VICTORY_FEAST_PHASE\s*=\s*Object\.freeze/.test(runtime),
    "missing named VICTORY_FEAST_PHASE state table",
  );
  assert(
    /const VICTORY_FEAST\s*=\s*Object\.freeze/.test(runtime),
    "missing named VICTORY_FEAST tuning table",
  );
  assert(/class VictoryFeastSystem/.test(runtime), "missing focused VictoryFeastSystem");
  assert(/victoryFeast:\s*\{/.test(runtime), "authoritative mansion state must own Victory Feast");
  assert(
    /reportDeadlineSeconds:\s*5\s*\*\s*60/.test(runtime),
    "Victory Feast must begin with a named five-minute report countdown",
  );
  assert(
    /There was never a Contestant Thirteen/i.test(runtime)
      && /part of the game/i.test(runtime)
      && /final (?:challenge|game)/i.test(runtime),
    "Mr. Feast's fake-Contestant-13 and final-challenge dialogue is incomplete",
  );
  assert(
    /victoryFeast:\s*victoryFeastSystem\?\.getDiagnostics/.test(runtime),
    "render_game_to_text must expose Victory Feast diagnostics",
  );
  assert(
    /saintVoice:\s*Object\.freeze\(\["\.\.\/Sounds\/mr-feast\/saint-voice-low-long-05\.ogg"\]\)/.test(runtime),
    "the Banquet Saint must register the approved voicelowlong05 recording",
  );
  assert(
    /presenceAudio:\s*Object\.freeze\(\{[\s\S]*maximumDistanceMeters:[\s\S]*maximumGain:[\s\S]*distanceExponent:/m.test(runtime),
    "the Saint needs a named distance-gain tuning contract",
  );
  assert(
    /navigation:\s*Object\.freeze\(\{[\s\S]*pathClearanceMeters:[\s\S]*repathSeconds:[\s\S]*stallSeconds:/m.test(runtime),
    "the Saint needs named full-width navigation and stall-recovery tuning",
  );
  assert(
    /finaleDirectLane\(/.test(runtime)
      && /planFinaleRoute\(/.test(runtime)
      && /updateFinaleNavigation\(/.test(runtime),
    "the Saint must route around blocked whole-path lanes instead of relying on local sidesteps",
  );
  assert(/syncSaintVoice\(/.test(runtime), "the Saint needs lifecycle-owned positional voice playback");
  assert(
    /saintVoice:\s*this\.saintVoiceDiagnostics\(\)/.test(runtime),
    "mansion audio diagnostics must expose the Saint voice lifecycle",
  );
  assert(
    saintVoice && saintVoice.length > 10000,
    "missing prepared saint-voice-low-long-05.ogg runtime asset",
  );

  const requiredQaHooks = [
    "getVictoryFeastState",
    "attemptVictoryFeastCallForQA",
    "callVictoryFeastForQA",
    "startVictoryFeastForQA",
    "advanceVictoryFeastForQA",
    "skipVictoryFeastDialogueForQA",
    "revealVictoryFeastSaintForQA",
    "startVictoryFeastEscapeForQA",
    "stunVictoryFeastSaintForQA",
    "triggerVictoryFlashlightDefectForQA",
    "hideFromVictoryFeastForQA",
    "catchVictoryFeastPlayerForQA",
    "prepareSaintAudioForQA",
    "updateSaintAudioForQA",
    "stageSaintPathingForQA",
    "clearSaintPathingProbeForQA",
  ];
  for (const hook of requiredQaHooks) {
    assert(runtime.includes(hook), `missing focused Victory Feast QA hook: ${hook}`);
  }

  assert(/id="mansion-victory-feast"/.test(html), "missing Victory Feast HUD region");
  assert(/id="mansion-victory-feast-timer"/.test(html), "missing Victory Feast timer");
  assert(/aria-label="Victory Feast status"/.test(html), "Victory Feast HUD needs an accessible label");
  assert(/Workroom sabotage[\s\S]*front-gate/i.test(milestone), "Milestone 66 must defer sabotage and the front-gate escape");
  assert(/User playtest/i.test(milestone), "Milestone 66 must retain subjective feast/reveal playtest");
}

async function beginCalledVictoryFeast(page) {
  const called = await page.evaluate(() => (
    window.MrFeastFresh.callVictoryFeastForQA("feast-hunt-player-win")
  ));
  assert(called?.started, `Victory Feast QA call should start after the Game 3 win: ${JSON.stringify(called)}`);
  const feast = await victoryState(page);
  assert(
    feast.phase === "called"
      && feast.callCount === 1
      && feast.reportRemaining === 300
      && /three games|all three/i.test(feast.callLine || "")
      && /five minutes/i.test(feast.callLine || "")
      && /dining/i.test(feast.callLine || ""),
    `Victory Feast call state is incomplete: ${JSON.stringify(feast)}`,
  );
  return feast;
}

async function runBrowserFlow() {
  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn(
      "python3",
      ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root],
      { stdio: "ignore" },
    );
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const errors = [];

    const page = await bootPage(browser, { width: 1280, height: 820 }, errors);
    let feast = await victoryState(page);
    let game = await diagnostics(page);
    assert(feast.phase === "dormant", `Victory Feast must start dormant: ${JSON.stringify(feast)}`);
    assert(
      game.devMode?.enabled === false
        && game.demonPrototypes?.fetchCount === 0
        && game.demonPrototypes?.visible === 0,
      `ordinary play must not preload or expose the Saint: ${JSON.stringify({
        devMode: game.devMode,
        demonPrototypes: game.demonPrototypes,
      })}`,
    );

    // Game 3 handoff and five-minute call.
    const prematureCall = await page.evaluate(() => (
      window.MrFeastFresh.attemptVictoryFeastCallForQA("before-game-3")
    ));
    assert(
      !prematureCall.called
        && prematureCall.reason === "feast-hunt-incomplete"
        && (await victoryState(page)).phase === "dormant",
      `incomplete Game 3 must not call the Victory Feast: ${JSON.stringify(prematureCall)}`,
    );
    await beginCalledVictoryFeast(page);
    const beforePausedAdvance = (await victoryState(page)).reportRemaining;
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.MrFeastFresh.advanceVictoryFeastForQA(10));
    const afterPausedAdvance = (await victoryState(page)).reportRemaining;
    await page.keyboard.press("Escape");
    assert(
      afterPausedAdvance === beforePausedAdvance,
      `blocking UI must pause the Victory Feast countdown: ${JSON.stringify({
        before: beforePausedAdvance,
        after: afterPausedAdvance,
      })}`,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceVictoryFeastForQA(12.25));
    const calledBeforeSave = await victoryState(page);
    assert(await page.evaluate(() => window.MrFeastFresh.saveGameForQA()), "called Victory Feast should save");
    assert(await page.evaluate(() => window.MrFeastFresh.loadGameForQA()), "called Victory Feast should load");
    const calledAfterLoad = await victoryState(page);
    assert(
      calledAfterLoad.phase === "called"
        && Math.abs(calledAfterLoad.reportRemaining - calledBeforeSave.reportRemaining) <= 0.001,
      `called save/load must preserve the exact report timer: ${JSON.stringify({
        before: calledBeforeSave.reportRemaining,
        after: calledAfterLoad.reportRemaining,
      })}`,
    );
    const duplicate = await page.evaluate(() => (
      window.MrFeastFresh.callVictoryFeastForQA("feast-hunt-player-win")
    ));
    assert(!duplicate.started && duplicate.reason === "already-called", `Victory Feast must call once: ${JSON.stringify(duplicate)}`);
    await page.evaluate(() => window.MrFeastFresh.awaitVictoryFeastAssetsForQA());

    // Physical Dining Room report and the fake Contestant 13 dialogue.
    const staged = await page.evaluate(() => window.MrFeastFresh.startVictoryFeastForQA());
    assert(staged?.started, `Victory Feast should stage the Dining Room: ${JSON.stringify(staged)}`);
    feast = await victoryState(page);
    assert(
      feast.phase === "dialogue"
        && feast.staged
        && feast.player.movementLocked
        && feast.host.visible
        && feast.host.facingPlayer
        && feast.production.cameraCount >= 2
        && feast.production.camerasFacingWinner
        && feast.spread.foodPropCount >= 12
        && feast.spread.servingDishCount >= 4
        && feast.spread.gameplayCollidersAdded === 0
        && feast.host.unobstructedSightline,
      `Dining Room production feast is incomplete: ${JSON.stringify(feast)}`,
    );
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "victory-feast-spread-desktop.png"),
    });

    const transcript = feast.dialogue.authoredLines.join(" ");
    assert(/There was never a Contestant Thirteen/i.test(transcript), `dialogue must expose the fake identity: ${transcript}`);
    assert(/book/i.test(transcript) && /tape/i.test(transcript) && /plant|production/i.test(transcript), `dialogue must explain the planted trail: ${transcript}`);
    assert(/part of the game/i.test(transcript) && /survive/i.test(transcript), `dialogue must name the final survival challenge: ${transcript}`);
    await page.evaluate(() => window.MrFeastFresh.advanceVictoryFeastForQA(5.5));
    feast = await victoryState(page);
    assert(
      feast.dialogue.index === 1
        && /There was never a Contestant Thirteen/i.test(feast.dialogue.history[1] || ""),
      `the authored fake-player reveal must be visibly presented before the blackout: ${JSON.stringify(feast.dialogue)}`,
    );
    const beforeRevealEntries = game.journal.entries.slice();
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "victory-feast-contestant-13-reveal-desktop.png"),
    });
    const skipped = await page.evaluate(() => window.MrFeastFresh.skipVictoryFeastDialogueForQA());
    assert(skipped?.skipped && skipped.dialogueComplete, `focused QA should finish the full dialogue: ${JSON.stringify(skipped)}`);
    game = await diagnostics(page);
    assert(
      JSON.stringify(game.journal.entries) === JSON.stringify(beforeRevealEntries),
      `the reveal must reinterpret rather than delete earned clues: ${JSON.stringify({
        before: beforeRevealEntries,
        after: game.journal.entries,
      })}`,
    );

    // Whole-house blackout and one finale-owned Saint lightning reveal.
    const revealed = await page.evaluate(async () => (
      window.MrFeastFresh.revealVictoryFeastSaintForQA()
    ));
    assert(revealed?.triggered, `Saint lightning reveal should trigger once: ${JSON.stringify(revealed)}`);
    await page.waitForFunction(() => {
      const state = window.MrFeastFresh.getVictoryFeastState();
      return state?.saint?.loadStatus === "ready" && state?.reveal?.lightning > 0;
    }, null, { timeout: 180000 });
    feast = await victoryState(page);
    game = await diagnostics(page);
    assert(
      feast.phase === "reveal"
        && feast.blackout.active
        && feast.blackout.allInteriorOff
        && feast.blackout.offCircuitCount === feast.blackout.interiorCircuitCount
        && feast.blackout.switchesLocked
        && feast.cameras.operational
        && feast.cameras.hostile,
      `the reveal must own a full blackout without disabling cameras: ${JSON.stringify(feast)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.toggleCircuit("dining room lights"));
    const resistedRelight = await victoryState(page);
    assert(
      resistedRelight.blackout.allInteriorOff,
      `ordinary switches must not relight a finale-owned circuit: ${JSON.stringify(resistedRelight.blackout)}`,
    );
    assert(
      !game.devMode.enabled
        && feast.saint.id === "banquet-saint"
        && feast.saint.visible
        && feast.saint.grounded
        && feast.saint.cornerPlacement
        && feast.saint.onScreen
        && feast.saint.lineOfSight
        && feast.reveal.count === 1,
      `lightning must reveal one grounded in-view Saint without Developer Mode: ${JSON.stringify({
        devMode: game.devMode,
        saint: feast.saint,
        reveal: feast.reveal,
      })}`,
    );
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "victory-feast-saint-lightning-desktop.png"),
    });
    const repeatedReveal = await page.evaluate(() => window.MrFeastFresh.revealVictoryFeastSaintForQA());
    assert(!repeatedReveal.triggered && repeatedReveal.reason === "already-revealed", `the reveal must be one-shot: ${JSON.stringify(repeatedReveal)}`);

    // First-slice escape, flashlight stun/defects, authoritative hiding, and catch.
    const escaped = await page.evaluate(() => window.MrFeastFresh.startVictoryFeastEscapeForQA());
    assert(escaped?.started, `the flash must release the first escape phase: ${JSON.stringify(escaped)}`);
    feast = await victoryState(page);
    assert(
      feast.phase === "escape"
        && !feast.player.movementLocked
        && feast.sabotage.pending
        && feast.escape.pending
        && !feast.escape.completed,
      `escape phase must unlock evasion without inventing the ending: ${JSON.stringify(feast)}`,
    );

    await page.evaluate(() => {
      window.MrFeastFresh.collectFlashlightForQA();
      window.MrFeastFresh.setFlashlightForQA(true, { silent: true });
    });
    const stunned = await page.evaluate(() => window.MrFeastFresh.stunVictoryFeastSaintForQA());
    assert(
      stunned?.stunned && stunned.beam?.hit && !stunned.beam?.occluded,
      `a centered, unobstructed, actually emitting flashlight should stun the Saint: ${JSON.stringify(stunned)}`,
    );
    const beforeStunStep = await victoryState(page);
    await page.evaluate(() => window.MrFeastFresh.advanceVictoryFeastForQA(1));
    const duringStun = await victoryState(page);
    assert(
      duringStun.saint.stunned
        && duringStun.saint.distanceTravelled === beforeStunStep.saint.distanceTravelled,
      `stunned Saint must stop without disappearing: ${JSON.stringify({
        before: beforeStunStep.saint,
        during: duringStun.saint,
      })}`,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceVictoryFeastForQA(0.8));
    assert(
      !(await victoryState(page)).saint.stunned,
      "the Saint must resume after the named stun duration expires",
    );

    let defect = await page.evaluate(() => (
      window.MrFeastFresh.triggerVictoryFlashlightDefectForQA("stutter")
    ));
    assert(
      defect?.mode === "stutter" && defect.requestedOn && !defect.beamOutput,
      `stutter must interrupt actual output without losing requested power: ${JSON.stringify(defect)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceVictoryFeastForQA(2));
    defect = (await victoryState(page)).flashlightDefect;
    assert(defect.mode === "none" && defect.requestedOn && defect.beamOutput, `stutter must recover automatically: ${JSON.stringify(defect)}`);

    defect = await page.evaluate(() => (
      window.MrFeastFresh.triggerVictoryFlashlightDefectForQA("give-out")
    ));
    assert(
      defect?.mode === "give-out" && !defect.requestedOn && !defect.beamOutput,
      `give-out must fully extinguish the light: ${JSON.stringify(defect)}`,
    );

    const hidden = await page.evaluate(() => window.MrFeastFresh.hideFromVictoryFeastForQA("coat"));
    assert(hidden?.hidden, `focused escape QA should use an authoritative hiding spot: ${JSON.stringify(hidden)}`);
    const hiddenCatch = await page.evaluate(() => window.MrFeastFresh.catchVictoryFeastPlayerForQA("saint"));
    assert(!hiddenCatch.caught && hiddenCatch.reason === "hidden", `the Saint cannot catch a hidden player: ${JSON.stringify(hiddenCatch)}`);
    feast = await victoryState(page);
    assert(feast.player.hidden && !feast.flashlightDefect.requestedOn, `hiding must extinguish the flashlight: ${JSON.stringify(feast)}`);
    // Gameplay breath stealth is retired; a hidden player stays silent and
    // the Saint must not invent a breath-led investigation.
    const breathStage = await page.evaluate(() => window.MrFeastFresh.stageBreathThreatForQA({
      target: "saint",
      distance: 2,
      preserveInvestigation: true,
    }));
    const saintHeard = await page.evaluate(() => window.MrFeastFresh.emitPlayerBreathForQA("heavy"));
    feast = await victoryState(page);
    assert(
      breathStage?.hidden
        && (!saintHeard?.emitted || saintHeard?.reason === "disabled")
        && feast.saint.targetSource !== "breathing",
      `gameplay breath must stay disabled during escape: ${JSON.stringify({
        breathStage,
        saintHeard,
        saint: feast.saint,
      })}`,
    );
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "victory-feast-hidden-desktop.png"),
    });
    const leftHide = await page.evaluate(() => window.MrFeastFresh.hideFromVictoryFeastForQA(null));
    assert(leftHide?.hidden === false, `focused hiding control should leave cleanly: ${JSON.stringify(leftHide)}`);

    const preparedSaintVoice = await page.evaluate(() => (
      window.MrFeastFresh.prepareSaintAudioForQA()
    ));
    assert(
      preparedSaintVoice?.recordedReady
        && /saint-voice-low-long-05\.ogg$/.test(preparedSaintVoice.assetPath || ""),
      `voicelowlong05 must decode through the trusted mansion audio graph: ${JSON.stringify(preparedSaintVoice)}`,
    );
    await page.evaluate(() => {
      window.MrFeastFresh.stageBreathThreatForQA({
        target: "saint",
        distance: 12,
        preserveInvestigation: true,
      });
      return window.MrFeastFresh.updateSaintAudioForQA();
    });
    await page.waitForTimeout(450);
    const farSaintVoice = (await page.evaluate(() => (
      window.MrFeastFresh.getAudioStateForQA()
    ))).saintVoice;
    await page.evaluate(() => {
      window.MrFeastFresh.stageBreathThreatForQA({
        target: "saint",
        distance: 2,
        preserveInvestigation: true,
      });
      return window.MrFeastFresh.updateSaintAudioForQA();
    });
    await page.waitForTimeout(450);
    const nearSaintVoice = (await page.evaluate(() => (
      window.MrFeastFresh.getAudioStateForQA()
    ))).saintVoice;
    assert(
      farSaintVoice.active
        && nearSaintVoice.active
        && Math.abs(farSaintVoice.distanceMeters - 12) <= 0.2
        && Math.abs(nearSaintVoice.distanceMeters - 2) <= 0.2
        && nearSaintVoice.targetGain > farSaintVoice.targetGain * 3
        && nearSaintVoice.currentGain > farSaintVoice.currentGain * 3
        && nearSaintVoice.targetGain <= nearSaintVoice.maximumGain,
      `the Saint voice must grow smoothly louder at close range: ${JSON.stringify({
        far: farSaintVoice,
        near: nearSaintVoice,
      })}`,
    );

    // A wall-blocked target must produce a real graph detour. The old local
    // sidestep could only press along the Library/Foyer divider; it had no
    // route-level knowledge of the actual doorway.
    const stagedSaintPathing = await page.evaluate(() => (
      window.MrFeastFresh.stageSaintPathingForQA("library-foyer-wall")
    ));
    assert(
      stagedSaintPathing?.staged
        && stagedSaintPathing.navigation?.directPathClear === false
        && stagedSaintPathing.navigation?.detourReason === "obstacle"
        && stagedSaintPathing.navigation?.routeRemaining >= 3,
      `the Library/Foyer wall must create a multi-node Saint detour: ${JSON.stringify(stagedSaintPathing)}`,
    );
    const saintPathStartDistance = stagedSaintPathing.navigation.targetDistance;
    await page.evaluate(() => window.MrFeastFresh.advanceVictoryFeastForQA(30));
    const routedSaint = (await victoryState(page)).saint;
    assert(
      routedSaint.navigation?.routeBuilds >= 1
        && routedSaint.navigation?.completedRouteSteps >= 2
        && routedSaint.navigation?.detourFrames > 0
        && routedSaint.navigation?.targetDistance < 0.45
        && routedSaint.navigation?.targetDistance < saintPathStartDistance - 8,
      `the Saint must clear the wall route and reach the target instead of sticking: ${JSON.stringify({
        startDistance: saintPathStartDistance,
        saint: routedSaint,
      })}`,
    );
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "victory-feast-saint-wall-detour-desktop.png"),
    });
    const stagedFurniturePathing = await page.evaluate(() => (
      window.MrFeastFresh.stageSaintPathingForQA("dining-table")
    ));
    assert(
      stagedFurniturePathing?.staged
        && stagedFurniturePathing.navigation?.directPathClear === false
        && stagedFurniturePathing.navigation?.detourReason === "obstacle"
        && stagedFurniturePathing.navigation?.routeRemaining >= 1,
      `the Dining Room table must create a routed Saint furniture detour: ${JSON.stringify(stagedFurniturePathing)}`,
    );
    const furnitureStartDistance = stagedFurniturePathing.navigation.targetDistance;
    await page.evaluate(() => window.MrFeastFresh.advanceVictoryFeastForQA(30));
    const furnitureRoutedSaint = (await victoryState(page)).saint;
    assert(
      furnitureRoutedSaint.navigation?.routeBuilds >= 1
        && furnitureRoutedSaint.navigation?.detourFrames > 0
        && furnitureRoutedSaint.navigation?.targetDistance < 0.45
        && furnitureRoutedSaint.navigation?.targetDistance < furnitureStartDistance - 6,
      `the Saint must route around broad furniture instead of sticking to it: ${JSON.stringify({
        startDistance: furnitureStartDistance,
        saint: furnitureRoutedSaint,
      })}`,
    );
    const clearedSaintPathing = await page.evaluate(() => (
      window.MrFeastFresh.clearSaintPathingProbeForQA()
    ));
    assert(
      clearedSaintPathing?.navigation?.qaProbe === false,
      `focused Saint pathing QA must clean up its catch suppression: ${JSON.stringify(clearedSaintPathing)}`,
    );

    // A live finale save returns to a safe physical Dining report checkpoint,
    // not the player's fragile escape position or transient threat timers.
    await page.evaluate(() => window.MrFeastFresh.teleport("basement"));
    assert(await page.evaluate(() => window.MrFeastFresh.saveGameForQA()), "live Victory Feast should save");
    assert(await page.evaluate(() => window.MrFeastFresh.loadGameForQA()), "live Victory Feast should load");
    feast = await victoryState(page);
    game = await diagnostics(page);
    const restoredFlashlight = await page.evaluate(() => window.MrFeastFresh.getFlashlightState());
    assert(
      feast.phase === "called"
        && feast.reportRemaining === 300
        && !feast.blackout.active
        && !feast.saint.visible
        && feast.saint.stunCount === 0
        && feast.saint.distanceTravelled === 0
        && !game.audio.saintVoice.active
        && game.audio.saintVoice.targetGain === 0
        && feast.flashlightDefect.eventCount === 0
        && restoredFlashlight.collected
        && !restoredFlashlight.on
        && game.room === "DINING ROOM"
        && Math.hypot(game.player.x + 6.12, game.player.z + 8.4) <= 0.08,
      `escape save must normalize to a clean Dining report checkpoint: ${JSON.stringify({
        feast,
        flashlight: restoredFlashlight,
        room: game.room,
        player: game.player,
      })}`,
    );

    const replayed = await page.evaluate(() => window.MrFeastFresh.startVictoryFeastForQA());
    assert(replayed?.started, `normalized finale checkpoint should replay the feast: ${JSON.stringify(replayed)}`);
    await page.evaluate(() => window.MrFeastFresh.skipVictoryFeastDialogueForQA());
    const replayReveal = await page.evaluate(() => window.MrFeastFresh.revealVictoryFeastSaintForQA());
    assert(replayReveal?.triggered, `normalized finale checkpoint should replay the Saint reveal: ${JSON.stringify(replayReveal)}`);
    const replayEscape = await page.evaluate(() => window.MrFeastFresh.startVictoryFeastEscapeForQA());
    assert(replayEscape?.started, `normalized finale checkpoint should replay the escape: ${JSON.stringify(replayEscape)}`);
    const caught = await page.evaluate(() => window.MrFeastFresh.catchVictoryFeastPlayerForQA("saint"));
    assert(caught?.caught, `an exposed Saint contact must have a real consequence: ${JSON.stringify(caught)}`);
    await page.close();

    // Real 390x844 touch path: report, hear the lie exposed, witness the
    // lightning reveal, use the flashlight, and hide.
    const mobile = await bootPage(
      browser,
      { width: 390, height: 844 },
      errors,
      { isMobile: true, hasTouch: true },
    );
    await beginCalledVictoryFeast(mobile);
    await mobile.evaluate(() => window.MrFeastFresh.awaitVictoryFeastAssetsForQA());
    assert(
      await mobile.locator("#mansion-victory-feast").isVisible()
        && await mobile.locator("#mansion-victory-feast-timer").textContent() === "05:00",
      "390x844 must show the called Victory Feast HUD and five-minute timer",
    );

    const report = await mobile.evaluate(() => (
      window.MrFeastFresh.placePlayerAtVictoryFeastForQA()
    ));
    assert(
      /Join Mr\. Feast|Victory Feast/i.test(report?.prompt || ""),
      `mobile player must physically reach the dining report interaction: ${JSON.stringify(report)}`,
    );
    await mobile.locator("#touch-interact").tap();
    await mobile.waitForFunction(() => (
      window.MrFeastFresh.getVictoryFeastState()?.phase === "dialogue"
    ));
    let mobileFeast = await victoryState(mobile);
    assert(
      mobileFeast.player.movementLocked
        && mobileFeast.dialogue.history.length >= 1
        && /There was never a Contestant Thirteen/i.test(mobileFeast.dialogue.authoredLines.join(" "))
        && /part of the game/i.test(mobileFeast.dialogue.authoredLines.join(" ")),
      `touch reporting must enter the fake-Player-13 dialogue: ${JSON.stringify(mobileFeast.dialogue)}`,
    );

    await mobile.evaluate(() => window.MrFeastFresh.skipVictoryFeastDialogueForQA());
    const mobileReveal = await mobile.evaluate(() => (
      window.MrFeastFresh.revealVictoryFeastSaintForQA()
    ));
    assert(mobileReveal?.triggered, `mobile lightning reveal should start: ${JSON.stringify(mobileReveal)}`);
    mobileFeast = await victoryState(mobile);
    assert(
      mobileFeast.phase === "reveal"
        && mobileFeast.reveal.lightning > 0
        && mobileFeast.saint.visible
        && mobileFeast.saint.onScreen,
      `390x844 lightning must visibly reveal the Saint: ${JSON.stringify({
        reveal: mobileFeast.reveal,
        saint: mobileFeast.saint,
      })}`,
    );
    await mobile.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "victory-feast-saint-lightning-mobile.png"),
    });

    const mobileEscape = await mobile.evaluate(() => (
      window.MrFeastFresh.startVictoryFeastEscapeForQA()
    ));
    assert(mobileEscape?.started, `mobile reveal must release the escape: ${JSON.stringify(mobileEscape)}`);
    await mobile.evaluate(() => window.MrFeastFresh.collectFlashlightForQA());
    await mobile.locator("#mansion-flashlight-button").tap();
    const mobileFlashlight = await mobile.evaluate(() => (
      window.MrFeastFresh.getFlashlightState()
    ));
    mobileFeast = await victoryState(mobile);
    assert(
      mobileFeast.phase === "escape"
        && mobileFlashlight.collected
        && mobileFlashlight.on
        && mobileFeast.flashlightDefect.beamOutput,
      `mobile Light control must provide an emitting escape flashlight: ${JSON.stringify({
        phase: mobileFeast.phase,
        flashlight: mobileFlashlight,
      })}`,
    );

    const mobileLayout = await mobile.evaluate(() => {
      const rectFor = (id) => {
        const element = document.getElementById(id);
        const rect = element?.getBoundingClientRect();
        const style = element ? getComputedStyle(element) : null;
        return {
          id,
          visible: Boolean(
            element && !element.hidden && style.display !== "none"
            && style.visibility !== "hidden" && Number(style.opacity) > 0
          ),
          left: rect?.left ?? -1,
          top: rect?.top ?? -1,
          right: rect?.right ?? -1,
          bottom: rect?.bottom ?? -1,
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
        };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        stage: rectFor("mansion-stage"),
        hud: rectFor("mansion-victory-feast"),
        controls: [
          "mansion-flashlight-button",
          "touch-menu",
          "touch-sprint",
          "touch-crouch",
          "touch-interact",
        ].map(rectFor),
      };
    });
    const withinStageAndViewport = (item) => (
      item.visible
      && item.left >= mobileLayout.stage.left - 0.5
      && item.top >= mobileLayout.stage.top - 0.5
      && item.right <= Math.min(mobileLayout.stage.right, mobileLayout.viewport.width) + 0.5
      && item.bottom <= Math.min(mobileLayout.stage.bottom, mobileLayout.viewport.height) + 0.5
    );
    assert(
      withinStageAndViewport(mobileLayout.hud),
      `Victory Feast HUD must fit the 390x844 play area: ${JSON.stringify(mobileLayout)}`,
    );
    for (const control of mobileLayout.controls) {
      assert(
        withinStageAndViewport(control) && control.width >= 44 && control.height >= 44,
        `mobile touch control must be on-screen and at least 44px: ${JSON.stringify(control)}`,
      );
    }

    const mobileHidden = await mobile.evaluate(() => (
      window.MrFeastFresh.hideFromVictoryFeastForQA("coat")
    ));
    mobileFeast = await victoryState(mobile);
    assert(
      mobileHidden?.hidden
        && mobileFeast.player.hidden
        && !mobileFeast.flashlightDefect.requestedOn
        && !mobileFeast.flashlightDefect.beamOutput
        && await mobile.locator("#mansion-hidden").isVisible(),
      `mobile hiding must be authoritative and extinguish the flashlight: ${JSON.stringify({
        hidden: mobileHidden,
        player: mobileFeast.player,
        flashlight: mobileFeast.flashlightDefect,
      })}`,
    );
    await mobile.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "victory-feast-hidden-mobile.png"),
    });
    await mobile.close();

    assert(errors.length === 0, `Victory Feast browser emitted errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast Victory Feast browser regression passed.");
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
  }
}

async function run() {
  await assertSourceContract();
  await runBrowserFlow();
}

run().catch((error) => {
  console.error(`Mr. Feast Victory Feast regression failed: ${error.message}`);
  process.exitCode = 1;
});
