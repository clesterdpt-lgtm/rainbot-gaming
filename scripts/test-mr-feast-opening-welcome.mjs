import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_OPENING_TEST_PORT || (52000 + (process.pid % 10000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-opening-welcome");

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

function watchErrors(page, errors) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text())) errors.push(message.text());
  });
}

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function startWelcome(page) {
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById("mansion-enter")?.disabled, null, { timeout: 120000 });
  await page.evaluate(() => window.MrFeastFresh.startOptionalCharacterLoadsForQA());
  await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState?.()?.loaded, null, { timeout: 120000 });
  await page.evaluate(() => document.getElementById("mansion-enter").click());
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).openingWelcome?.active, null, { timeout: 8000 });
  await page.evaluate(() => window.MrFeastFresh.advanceOpeningWelcomeForQA(2));
  await page.waitForFunction(() => {
    const opening = JSON.parse(window.render_game_to_text()).openingWelcome;
    return opening?.phase === "speaking" && opening.lineIndex === 0;
  }, null, { timeout: 8000 });
}

async function advanceToLine(page, targetIndex) {
  return page.evaluate((index) => {
    for (let guard = 0; guard < 800; guard += 1) {
      const current = window.MrFeastFresh.getOpeningWelcomeState();
      if (!current?.active || (current.phase === "speaking" && current.lineIndex >= index)) return current;
      window.MrFeastFresh.advanceOpeningWelcomeForQA(0.1);
    }
    throw new Error(`Opening welcome did not reach line ${index + 1}`);
  }, targetIndex);
}

async function bubbleLayout(page) {
  return page.evaluate(() => {
    const stage = document.getElementById("mansion-stage").getBoundingClientRect();
    const bubble = document.getElementById("mansion-speech").getBoundingClientRect();
    const prompt = document.getElementById("mansion-prompt").getBoundingClientRect();
    return {
      stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom },
      bubble: { left: bubble.left, top: bubble.top, right: bubble.right, bottom: bubble.bottom },
      prompt: { left: prompt.left, top: prompt.top, right: prompt.right, bottom: prompt.bottom },
      bubbleHidden: document.getElementById("mansion-speech").hidden,
      promptHidden: document.getElementById("mansion-prompt").hidden,
      fontPx: Number.parseFloat(getComputedStyle(document.getElementById("mansion-speech-text")).fontSize),
      speaker: document.getElementById("mansion-speech-speaker").textContent,
      promptText: document.getElementById("mansion-prompt-text").textContent,
    };
  });
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

async function run() {
  const [runtimeSource, pageSource] = await Promise.all([
    readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8"),
    readFile(path.join(root, "games/mr-feast-mansion.html"), "utf8"),
  ]);

  // Red-first source contract: these assertions must fail until the opening
  // welcome is implemented, before Chromium is ever launched.
  assert(/const MR_FEAST_OPENING_WELCOME\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the named MR_FEAST_OPENING_WELCOME contract");
  assert(/class MrFeastOpeningWelcome/.test(runtimeSource), "runtime is missing the opening welcome state machine");
  assert(/openingWelcome:\s*openingWelcomeSystem\?\.getDiagnostics/.test(runtimeSource), "render_game_to_text must expose opening welcome progress");
  assert(/advanceOpeningWelcomeForQA/.test(runtimeSource), "runtime is missing deterministic opening welcome timing controls");
  assert(pageSource.includes('id="mansion-speech-skip"'), "the shared speech bubble is missing its Skip rules control for competitions");
  assert(/manualAdvanceAfterSeconds:\s*0/.test(runtimeSource), "opening welcome must expose E/tap skip immediately with no reading hold");
  assert(!/skipLabel:\s*"Skip intro"/.test(runtimeSource), "opening welcome must not attach a full-intro Skip button to the speech bubble");
  assert(!/A previous contestant left a trail somewhere inside the estate\./.test(pageSource), "the entry card still spoils the hidden Contestant 13 trail");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });

    // --- Immediate per-line E/tap skip -------------------------------------
    const skipPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const skipErrors = [];
    watchErrors(skipPage, skipErrors);
    await startWelcome(skipPage);
    await skipPage.waitForFunction(() => JSON.parse(window.render_game_to_text()).openingWelcome?.phase === "speaking", null, { timeout: 4500 });
    const skipButton = skipPage.locator("#mansion-speech-skip");
    assert(!(await skipButton.isVisible()), "opening welcome must not show a full-intro Skip button on the speech bubble");
    const beforeSkip = await diagnostics(skipPage);
    assert(!beforeSkip.speech.skippable && beforeSkip.speech.skipLabel == null, `opening speech must not be bubble-skippable; got ${JSON.stringify(beforeSkip.speech)}`);
    assert(beforeSkip.openingWelcome.canAdvance && beforeSkip.openingWelcome.manualAdvanceAfterSeconds === 0, `E/tap skip must be available instantly on the first line; got ${JSON.stringify(beforeSkip.openingWelcome)}`);
    const promptVisible = await skipPage.evaluate(() => {
      const prompt = document.getElementById("mansion-prompt");
      const text = document.getElementById("mansion-prompt-text")?.textContent || "";
      return { hidden: prompt?.hidden, text };
    });
    assert(!promptVisible.hidden && /skip/i.test(promptVisible.text), `mobile E prompt must advertise Skip instantly; got ${JSON.stringify(promptVisible)}`);
    await skipPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "opening-skip-mobile.png") });
    const rushed = await skipPage.evaluate(() => {
      for (let guard = 0; guard < 80; guard += 1) {
        const opening = window.MrFeastFresh.getOpeningWelcomeState();
        if (!opening?.active) break;
        if (opening.phase === "speaking" && opening.canAdvance) {
          window.MrFeastFresh.continueOpeningWelcomeForQA();
        } else if (opening.phase === "gap") {
          window.MrFeastFresh.advanceOpeningWelcomeForQA(Math.max(0.05, Number(opening.phaseRemaining) || 0.1));
        } else {
          window.MrFeastFresh.advanceOpeningWelcomeForQA(0.1);
        }
      }
      return JSON.parse(window.render_game_to_text());
    });
    assert(!rushed.openingWelcome.active && rushed.openingWelcome.completed, `mashing E/tap must finish the welcome quickly; got ${JSON.stringify(rushed.openingWelcome)}`);
    assert(rushed.openingWelcome.acceptedAdvances >= 7, `every line should accept an immediate E advance; got ${JSON.stringify(rushed.openingWelcome)}`);
    assert(!rushed.speech.visible && rushed.mrFeast.wanderingEnabled, `rushing dialogue must dismiss speech and resume Mr. Feast patrol; got ${JSON.stringify({ speech: rushed.speech, mrFeast: rushed.mrFeast })}`);
    assert(!rushed.contestant13.bookRead && rushed.inventory.items.length === 0 && rushed.security.alarm.count === 0, `rushing dialogue must not mutate story, inventory, or security state; got ${JSON.stringify(rushed)}`);
    assert(skipErrors.length === 0, `opening skip page console errors: ${skipErrors.join(" | ")}`);
    await skipPage.close();

    const desktop = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const desktopErrors = [];
    watchErrors(desktop, desktopErrors);
    await startWelcome(desktop);

    // --- Front-door staging and input gate ---------------------------------
    let state = await diagnostics(desktop);
    assert(state.openingWelcome.active && !state.openingWelcome.completed, `fresh entry should start the welcome; got ${JSON.stringify(state.openingWelcome)}`);
    assert(state.openingWelcome.movementLocked && state.openingWelcome.interactionsLocked, "welcome must lock movement and ordinary interactions");
    assert(state.openingWelcome.hostStaged && state.mrFeast.modelVisible && !state.mrFeast.moving, `Mr. Feast should be visibly staged and idle; got ${JSON.stringify(state.mrFeast)}`);
    assert(state.openingWelcome.hostDistanceFromFrontDoor <= 4.25, `Mr. Feast is not staged at the front door; got ${state.openingWelcome.hostDistanceFromFrontDoor}m`);
    assert(state.openingWelcome.hostDistanceFromPlayer >= 1.2 && state.openingWelcome.hostDistanceFromPlayer <= 4.5, `host/player welcome spacing is wrong; got ${state.openingWelcome.hostDistanceFromPlayer}m`);
    assert(state.openingWelcome.hostFacingPlayerDot >= 0.97, `Mr. Feast should face the arriving player; got ${state.openingWelcome.hostFacingPlayerDot}`);
    const beforeMove = state.player;
    await desktop.keyboard.down("w");
    await desktop.waitForTimeout(280);
    await desktop.keyboard.up("w");
    state = await diagnostics(desktop);
    assert(Math.hypot(state.player.x - beforeMove.x, state.player.z - beforeMove.z) <= 0.02, `player moved during the welcome; got ${JSON.stringify({ beforeMove, after: state.player })}`);
    assert(state.prompt == null, `ordinary interactions should stay hidden during the welcome; got ${state.prompt}`);

    // --- Authored briefing and deterministic pacing ------------------------
    await desktop.waitForFunction(() => {
      const opening = JSON.parse(window.render_game_to_text()).openingWelcome;
      return opening?.phase === "speaking" && opening.lineIndex === 0;
    }, null, { timeout: 4500 });
    state = await diagnostics(desktop);
    assert(state.speech.visible && state.speech.speakerName === "Mr. Feast", `the host bubble should identify Mr. Feast; got ${JSON.stringify(state.speech)}`);

    const openingContract = state.openingWelcome;
    assert(openingContract.lineCount === 7, `opening should contain seven lines; got ${openingContract.lineCount}`);
    assert(openingContract.minimumLineSeconds >= 6 && openingContract.maximumLineSeconds <= 10.5, `opening reading window drifted; got ${JSON.stringify(openingContract)}`);
    assert(openingContract.manualAdvanceAfterSeconds === 0, `manual advance must be instant; got ${openingContract.manualAdvanceAfterSeconds}s`);
    assert(openingContract.totalPlannedSeconds >= 45, `the complete welcome is too fast; got ${openingContract.totalPlannedSeconds}s`);
    const transcript = openingContract.authoredLines.join(" ");
    assert(/reality show/i.test(transcript) && /compet/i.test(transcript), `briefing does not establish a reality-show competition: ${transcript}`);
    assert(/one million dollars/i.test(transcript), `briefing does not state the one-million-dollar prize: ${transcript}`);
    assert(/library/i.test(transcript) && /ballroom/i.test(transcript) && /upstairs|upper rooms/i.test(transcript), `briefing does not introduce the house: ${transcript}`);
    assert(/camera/i.test(transcript), `briefing does not establish the cameras: ${transcript}`);
    assert(/do not enter the basement/i.test(transcript), `briefing does not prohibit the basement: ${transcript}`);
    assert(/last contestant|beneath|floorboards|nobody down there|most-watched/i.test(openingContract.authoredLines.at(-1)), `final line is not suspicious enough: ${openingContract.authoredLines.at(-1)}`);

    await desktop.waitForFunction(() => {
      const opening = JSON.parse(window.render_game_to_text()).openingWelcome;
      return opening?.lineIndex >= 1;
    }, null, { timeout: 14000 });
    state = await diagnostics(desktop);
    assert(state.openingWelcome.spokenLines.length >= 2, `ordinary wall-clock play did not auto-advance a complete line; got ${JSON.stringify(state.openingWelcome)}`);

    const earlyProbe = await desktop.evaluate(() => {
      const startingIndex = window.MrFeastFresh.getOpeningWelcomeState().lineIndex;
      for (let guard = 0; guard < 300; guard += 1) {
        const opening = window.MrFeastFresh.getOpeningWelcomeState();
        if (opening.phase === "speaking" && opening.lineIndex > startingIndex) break;
        window.MrFeastFresh.advanceOpeningWelcomeForQA(0.1);
      }
      const before = window.MrFeastFresh.getOpeningWelcomeState();
      const advance = window.MrFeastFresh.continueOpeningWelcomeForQA();
      const after = window.MrFeastFresh.getOpeningWelcomeState();
      return { before, advance, after };
    });
    assert(earlyProbe.before.phase === "speaking" && earlyProbe.before.canAdvance, `QA pacing probe did not begin a fresh advanceable line; got ${JSON.stringify(earlyProbe.before)}`);
    assert(earlyProbe.advance.accepted === true, `a fresh line should accept E/tap skip instantly; got ${JSON.stringify(earlyProbe.advance)}`);
    assert(
      earlyProbe.after.phase === "gap"
        || (earlyProbe.after.phase === "speaking" && earlyProbe.after.lineIndex > earlyProbe.before.lineIndex)
        || !earlyProbe.after.active,
      `instant E/tap skip should leave the current line; got ${JSON.stringify(earlyProbe.after)}`,
    );

    await advanceToLine(desktop, 5);
    state = await diagnostics(desktop);
    assert(/do not enter the basement/i.test(state.speech.text), `line six should carry the basement restriction; got ${state.speech.text}`);
    const desktopLayout = await bubbleLayout(desktop);
    assert(!desktopLayout.bubbleHidden && desktopLayout.speaker === "Mr. Feast", `desktop host bubble is missing; got ${JSON.stringify(desktopLayout)}`);
    assert(desktopLayout.fontPx >= 14, `desktop welcome text is too small at ${desktopLayout.fontPx}px`);
    assertInside(desktopLayout.bubble, desktopLayout.stage, "desktop welcome bubble");
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "front-door-welcome-desktop.png") });

    // --- Clean release to exploration --------------------------------------
    state = await desktop.evaluate(() => {
      window.MrFeastFresh.advanceOpeningWelcomeForQA(120);
      return JSON.parse(window.render_game_to_text());
    });
    assert(!state.openingWelcome.active && state.openingWelcome.completed, `welcome did not finish cleanly; got ${JSON.stringify(state.openingWelcome)}`);
    assert(state.openingWelcome.spokenLines.length === 7 && new Set(state.openingWelcome.spokenLines.map((entry) => entry.text)).size === 7, `welcome did not speak every line exactly once; got ${JSON.stringify(state.openingWelcome.spokenLines)}`);
    assert(state.openingWelcome.spokenLines.every((entry) => entry.duration >= 6 && entry.duration <= 10.5), `one or more lines violated the reading window; got ${JSON.stringify(state.openingWelcome.spokenLines)}`);
    assert(!state.speech.visible && state.mrFeast.wanderingEnabled, `speech should clear and patrol should resume; got ${JSON.stringify({ speech: state.speech, mrFeast: state.mrFeast })}`);
    assert(
      state.contestant13.bookRead === false
        && state.inventory.items.length === 0
        && state.security.alarm.count === 0,
      `opening welcome must not alter story, inventory, or security state; got ${JSON.stringify({ contestant13: state.contestant13, inventory: state.inventory, alarm: state.security.alarm })}`,
    );
    const repeat = await desktop.evaluate(() => window.MrFeastFresh.startOpeningWelcomeForQA());
    assert(repeat.started === false && repeat.reason === "already-completed", `opening must not repeat in the same run; got ${JSON.stringify(repeat)}`);

    const releasedAt = state.player;
    await desktop.keyboard.down("w");
    await desktop.waitForTimeout(320);
    await desktop.keyboard.up("w");
    state = await diagnostics(desktop);
    assert(Math.hypot(state.player.x - releasedAt.x, state.player.z - releasedAt.z) >= 0.1, `movement did not unlock after the welcome; got ${JSON.stringify({ releasedAt, after: state.player })}`);
    assert(desktopErrors.length === 0, `desktop console errors: ${desktopErrors.join(" | ")}`);
    await desktop.close();

    // --- Mobile presentation ------------------------------------------------
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobileErrors = [];
    watchErrors(mobile, mobileErrors);
    await startWelcome(mobile);
    await advanceToLine(mobile, 6);
    await mobile.evaluate(() => window.MrFeastFresh.advanceOpeningWelcomeForQA(2.5));
    state = await diagnostics(mobile);
    assert(state.openingWelcome.active && state.openingWelcome.lineIndex === 6, `mobile welcome did not reach its final line; got ${JSON.stringify(state.openingWelcome)}`);
    const mobileLayout = await bubbleLayout(mobile);
    assert(!mobileLayout.bubbleHidden && !mobileLayout.promptHidden, `mobile welcome bubble/prompt is missing; got ${JSON.stringify(mobileLayout)}`);
    assert(mobileLayout.fontPx >= 12, `mobile welcome text is too small at ${mobileLayout.fontPx}px`);
    assert(/skip/i.test(mobileLayout.promptText), `mobile E control should advertise Skip; got ${mobileLayout.promptText}`);
    assertInside(mobileLayout.bubble, mobileLayout.stage, "mobile welcome bubble");
    assertInside(mobileLayout.prompt, mobileLayout.stage, "mobile Skip prompt");
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "front-door-welcome-mobile.png") });
    assert(mobileErrors.length === 0, `mobile console errors: ${mobileErrors.join(" | ")}`);
    await mobile.close();

    console.log("Mr. Feast front-door opening welcome checks passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
