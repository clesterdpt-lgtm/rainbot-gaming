import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_CODE_CLUE_TEST_PORT || (50100 + (process.pid % 14000)));
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-workroom-code-clue");

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

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
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
  return state;
}

async function completeSecondClueCompetition(page, expectedClueId) {
  let state = await diagnostics(page);
  assert(
    state.stormRun?.phase === "called"
      && state.stormRun.triggerReason === "clue"
      && state.stormRun.triggerClueId === expectedClueId
      && state.stormRun.callCount === 1
      && state.stormRun.clueProgressLocked,
    `the first post-Feast clue should call Storm Run once and pause later clues; got ${JSON.stringify(state.stormRun)}`,
  );
  const result = await page.evaluate(() => window.MrFeastFresh.completeStormRunForQA("player"));
  assert(
    result?.survived === true && result.eliminatedContestantId === "mara-voss",
    `the QA completion should survive Storm Run and eliminate Mara; got ${JSON.stringify(result)}`,
  );
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

function watchErrors(page, errors) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
  });
}

async function pressKey(page, code, key) {
  await page.evaluate(({ code, key }) => {
    const canvas = document.getElementById("mansion-canvas");
    canvas.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
  }, { code, key });
}

function clueEntry(state) {
  return (state.journal?.details || []).find((entry) => /painting room notes/i.test(entry.title || "")) || null;
}

async function run() {
  const runtimeSource = await readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8");
  assert(/const WORKROOM_CODE_SCRATCHES\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the WORKROOM_CODE_SCRATCHES table");
  const digits = [...runtimeSource.matchAll(/numeral:\s*"(?:I|II|III|IV)",\s*digit:\s*"(\d)"/g)].map((match) => match[1]);
  assert(digits.length === 4, `the scratch table should carry exactly four digits; got ${JSON.stringify(digits)}`);
  const configuredCode = runtimeSource.match(/code:\s*"(\d{4})"/)?.[1];
  assert(digits.join("") === configuredCode, `scratch digits in numeral order must assemble the keypad code; got ${digits.join("")} vs ${configuredCode}`);
  const portraitTiltRadians = Number(runtimeSource.match(/portraitTiltRadians:\s*([\d.]+)/)?.[1]);
  const carrierTiltRadians = Number(runtimeSource.match(/carrierTiltRadians:\s*([\d.]+)/)?.[1]);
  assert(carrierTiltRadians >= 0.28, `code-carrier portraits should tilt far enough to uncover a corner clue; got ${carrierTiltRadians}`);
  assert(portraitTiltRadians < carrierTiltRadians, `ordinary portraits should retain their subtler tilt; got ordinary=${portraitTiltRadians}, carrier=${carrierTiltRadians}`);
  const scratchTextureStart = runtimeSource.indexOf("function createWorkroomScratchTexture");
  const scratchTextureEnd = runtimeSource.indexOf("function addWorkroomCodeScratch", scratchTextureStart);
  const scratchTextureSource = runtimeSource.slice(scratchTextureStart, scratchTextureEnd);
  assert(/WORKROOM_SCRATCH_GLYPHS/.test(runtimeSource), "wall marks should use hand-traced glyph paths instead of a print font");
  assert(!/ctx\.font\s*=/.test(scratchTextureSource), "the keypad clue should not select a print font");
  assert(!/\b(?:strokeText|fillText)\s*\(/.test(scratchTextureSource), "the keypad clue should not use canvas text rendering");
  const glyphTableSource = runtimeSource.slice(runtimeSource.indexOf("const WORKROOM_SCRATCH_GLYPHS"), scratchTextureStart);
  for (const glyph of ["I", "V", "0", "1", "3", "5"]) {
    assert(new RegExp(`(?:^|\\s|\\")${glyph}\\"?\\s*:`).test(glyphTableSource), `manual scratch paths should cover glyph ${glyph}`);
  }
  assert(/setLineDash\s*\(\s*\[/.test(scratchTextureSource), "the hand-traced wall clue should retain broken gouge strokes");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });

    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    watchErrors(page, errors);
    await page.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loadStatus === "ready", null, { timeout: 120000 });
    await page.waitForTimeout(300);

    // --- Baseline: four hidden scratches, no discoveries ----------------------
    let state = await diagnostics(page);
    const code = state.workroomCode;
    assert(code && code.targets?.length === 4, `diagnostics should expose four scratch targets; got ${JSON.stringify(code)}`);
    assert(code.discoveredCount === 0 && code.complete === false, `a fresh run should start with no discoveries; got ${JSON.stringify(code)}`);
    assert(code.targets.every((target) => target.revealed === false && target.discovered === false), `all scratches should start hidden; got ${JSON.stringify(code.targets)}`);
    for (const scratchTarget of code.targets) {
      const placement = scratchTarget.placement;
      assert(placement, `scratch diagnostics should expose corner placement for ${scratchTarget.artId}; got ${JSON.stringify(scratchTarget)}`);
      const expectedCorner = placement.tiltSign > 0 ? "bottom-right" : "bottom-left";
      assert(placement.revealCorner === expectedCorner, `${scratchTarget.artId} should sit in its raised ${expectedCorner} corner; got ${JSON.stringify(placement)}`);
      assert(placement.localX * placement.tiltSign > 0, `${scratchTarget.artId} should follow the portrait's raised-corner sign; got ${JSON.stringify(placement)}`);
      const tilt = Math.abs(placement.tiltRadians);
      const frameOuterHeight = placement.portraitHeight + placement.frameRail * 2;
      const innerEdgeX = Math.max(0, Math.abs(placement.localX) - placement.planeWidth / 2);
      const rotatedFrameBottom = innerEdgeX * Math.tan(tilt) - frameOuterHeight / (2 * Math.cos(tilt));
      const scratchBottom = placement.localY - placement.planeHeight / 2;
      const exposedFraction = Math.max(0, Math.min(1, (rotatedFrameBottom - scratchBottom) / placement.planeHeight));
      assert(exposedFraction >= 0.94, `${scratchTarget.artId} should be at least 94% geometrically exposed after tilting; got ${exposedFraction.toFixed(3)} from ${JSON.stringify(placement)}`);
      assert(placement.surfaceTreatment === "etched-decal" && placement.raisedDepth === 0, `${scratchTarget.artId} should be a flat etched wall decal; got ${JSON.stringify(placement)}`);
      assert(placement.textureTechnique === "hand-traced-broken-gouges", `${scratchTarget.artId} should use rough hand-traced gouges; got ${JSON.stringify(placement)}`);
    }
    assert(state.tamper.entries.some((entry) => entry.artId === "five-doors"), "tamper entries should expose portrait artIds");
    assert(clueEntry(state) === null, "the evidence pad should not mention the scratches before any discovery");

    // --- Real E reveal on the east-wall painting ------------------------------
    await page.evaluate(() => window.MrFeastFresh.teleport("codeScratchFiveDoors"));
    await page.waitForFunction(() => /tilt/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(page, "KeyE", "e");
    await page.waitForTimeout(150);
    state = await diagnostics(page);
    let target = state.workroomCode.targets.find((candidate) => candidate.artId === "five-doors");
    assert(target.revealed === true && target.discovered === true, `tilting the carrier painting should reveal and discover its scratch; got ${JSON.stringify(target)}`);
    assert(state.workroomCode.discoveredCount === 1, `one discovery should be recorded; got ${JSON.stringify(state.workroomCode)}`);
    let entry = clueEntry(state);
    assert(entry, "the first discovery should create a neutral evidence-pad note");
    assert(new RegExp(`${target.numeral}\\s+${target.digit}`).test(entry.body), `the entry should record the numeral and digit; got ${JSON.stringify(entry.body)}`);
    assert(!/keypad|workroom|access pin|code/i.test(`${entry.title} ${entry.body}`), `the player-facing note must not identify what the marks unlock; got ${JSON.stringify(entry)}`);
    await page.screenshot({ path: path.join(artifactDir, "scratch-revealed-desktop.png") });

    assert(
      state.feastSays?.phase === "called"
        && state.feastSays.triggerClueId === "painting-scratch:five-doors"
        && state.feastSays.clueProgressLocked,
      `the first discovered scratch should call Feast Says and lock later clue carriers; got ${JSON.stringify(state.feastSays)}`,
    );

    // Straightening hides the scratch again but keeps the discovery.
    await page.waitForFunction(() => /straighten/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(page, "KeyE", "e");
    await page.waitForTimeout(150);
    state = await diagnostics(page);
    target = state.workroomCode.targets.find((candidate) => candidate.artId === "five-doors");
    assert(target.revealed === false && target.discovered === true, `straightening should hide the scratch but keep the discovery; got ${JSON.stringify(target)}`);

    // A second carrier stays untouched while production has paused clues.
    const blockedSecondArtId = await page.evaluate(() => {
      const second = window.MrFeastFresh.getTamperState().entries.find((candidate) => candidate.artId === "polite-eclipse");
      window.MrFeastFresh.tamperForQA(second.id, true);
      return second.artId;
    });
    state = await diagnostics(page);
    const blockedSecond = state.workroomCode.targets.find((candidate) => candidate.artId === blockedSecondArtId);
    const blockedTamper = state.tamper.entries.find((candidate) => candidate.artId === blockedSecondArtId);
    assert(
      blockedSecond.revealed === false && blockedSecond.discovered === false && blockedTamper.tampered === false,
      `the Feast Says clue gate should leave a later carrier untouched; scratch=${JSON.stringify(blockedSecond)} tamper=${JSON.stringify(blockedTamper)}`,
    );
    await completeFirstClueCompetition(page, "painting-scratch:five-doors");

    // --- Mr. Feast's fix also re-hides a revealed scratch ---------------------
    const secondArtId = await page.evaluate(() => {
      const second = window.MrFeastFresh.getTamperState().entries.find((candidate) => candidate.artId === "polite-eclipse");
      window.MrFeastFresh.tamperForQA(second.id, true);
      return second.artId;
    });
    state = await diagnostics(page);
    assert(state.workroomCode.targets.find((candidate) => candidate.artId === secondArtId).revealed === true, "a QA tilt should reveal the second scratch");
    await completeSecondClueCompetition(page, `painting-scratch:${secondArtId}`);
    await page.evaluate(() => window.MrFeastFresh.advanceTamperForQA(30));
    await page.evaluate(() => window.MrFeastFresh.runMrFeastHousekeepingForQA(420));
    state = await diagnostics(page);
    target = state.workroomCode.targets.find((candidate) => candidate.artId === secondArtId);
    assert(target.revealed === false && target.discovered === true, `Mr. Feast's fix should re-hide the scratch while the discovery persists; got ${JSON.stringify(target)}`);
    assert(state.workroomCode.discoveredCount === 2, `two discoveries should be recorded; got ${JSON.stringify(state.workroomCode)}`);

    // --- Save now, then finish the hunt; loading returns to two ---------------
    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    await page.waitForTimeout(120);
    assert(await page.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "the mid-hunt save should succeed");

    await page.evaluate(() => {
      for (const artId of ["garden-knees", "choir-floorboards"]) {
        const entryForArt = window.MrFeastFresh.getTamperState().entries.find((candidate) => candidate.artId === artId);
        window.MrFeastFresh.tamperForQA(entryForArt.id, true);
      }
    });
    state = await diagnostics(page);
    assert(state.workroomCode.discoveredCount === 4 && state.workroomCode.complete === true, `all four discoveries should complete the hunt; got ${JSON.stringify(state.workroomCode)}`);
    entry = clueEntry(state);
    assert(new RegExp(`I\\s+0[\\s\\S]*II\\s+5[\\s\\S]*III\\s+1[\\s\\S]*IV\\s+3`).test(entry.body), `the completed note should preserve all four raw marks; got ${JSON.stringify(entry.body)}`);
    assert(!entry.body.includes(configuredCode), `the completed note must not assemble the digits into an answer; got ${JSON.stringify(entry.body)}`);
    assert(!/keypad|workroom|access pin|code/i.test(`${entry.title} ${entry.body}`), `the completed note must not identify what the marks unlock; got ${JSON.stringify(entry)}`);
    assert(state.workroomCode.code === configuredCode, `QA diagnostics should expose the assembled code; got ${JSON.stringify(state.workroomCode.code)}`);

    const loaded = await page.evaluate(() => window.MrFeastFresh.loadGameForQA());
    assert(loaded === true, "loading the mid-hunt save should succeed");
    await page.waitForTimeout(200);
    state = await diagnostics(page);
    assert(state.workroomCode.discoveredCount === 2 && state.workroomCode.complete === false, `loading should restore the two-discovery state; got ${JSON.stringify(state.workroomCode)}`);
    assert(state.workroomCode.targets.every((candidate) => candidate.revealed === false), "loading should resync all scratches to the untampered paintings");
    entry = clueEntry(state);
    assert(entry && !entry.body.includes(configuredCode) && !/keypad|workroom|access pin|code/i.test(`${entry.title} ${entry.body}`), `the reloaded note should remain neutral and partial; got ${JSON.stringify(entry)}`);

    // --- Dev mode grants everything and restores on disable -------------------
    await page.evaluate(() => window.MrFeastFresh.setDevModeForQA(true));
    state = await diagnostics(page);
    entry = clueEntry(state);
    assert(state.workroomCode.discoveredCount === 4 && entry && !entry.body.includes(configuredCode) && !/keypad|workroom|access pin|code/i.test(`${entry.title} ${entry.body}`), `dev mode should preserve a neutral complete note; got ${JSON.stringify(state.workroomCode)}`);
    await page.evaluate(() => window.MrFeastFresh.setDevModeForQA(false));
    state = await diagnostics(page);
    assert(state.workroomCode.discoveredCount === 2, `disabling dev mode should restore the pre-dev hunt; got ${JSON.stringify(state.workroomCode)}`);

    // --- Keypad regression: an unlocked pad still echoes digits ---------------
    await page.evaluate(() => window.MrFeastFresh.resetWorkroomForQA());
    await page.evaluate((pin) => window.MrFeastFresh.submitWorkroomCodeForQA(pin), configuredCode);
    state = await diagnostics(page);
    assert(state.workroom.entrance.locked === false && state.workroom.keypad.status === "accepted", `submitting the assembled code should unlock the Workroom; got ${JSON.stringify(state.workroom.keypad)}`);
    await page.evaluate(() => window.MrFeastFresh.openWorkroomKeypadForQA());
    await page.waitForTimeout(150);
    await pressKey(page, "Digit7", "7");
    await pressKey(page, "Digit7", "7");
    await page.waitForTimeout(150);
    const padProbe = await page.evaluate(() => ({
      inputLength: window.MrFeastFresh.getWorkroomState().keypad.inputLength,
      display: document.getElementById("mansion-workroom-keypad-display")?.textContent || "",
      status: document.getElementById("mansion-workroom-keypad-status")?.textContent || "",
    }));
    assert(padProbe.inputLength === 2 && padProbe.display.startsWith("●●"), `an unlocked pad must still echo digit presses; got ${JSON.stringify(padProbe)}`);
    assert(/granted/i.test(padProbe.status), `an unlocked pad should keep reporting granted access; got ${JSON.stringify(padProbe)}`);
    await page.screenshot({ path: path.join(artifactDir, "unlocked-keypad-echo-desktop.png") });

    assert(errors.length === 0, `console errors: ${errors.join(" | ")}`);
    await page.close();

    // --- Visual gate: every alternating tilt exposes its own raised corner ---
    const visualPage = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const visualErrors = [];
    watchErrors(visualPage, visualErrors);
    await visualPage.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`, { waitUntil: "domcontentloaded" });
    await visualPage.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await visualPage.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loadStatus === "ready", null, { timeout: 120000 });
    const carrierViews = [
      { artId: "five-doors", view: "codeScratchFiveDoorsLow" },
      { artId: "polite-eclipse", view: "paintingRoomWestArt" },
      { artId: "garden-knees", view: "paintingRoomNorthArt" },
      { artId: "choir-floorboards", view: "paintingRoomSouthArt" },
    ];
    for (const carrier of carrierViews) {
      await visualPage.evaluate(({ artId, view }) => {
        window.MrFeastFresh.teleport(view);
        const entryForArt = window.MrFeastFresh.getTamperState().entries.find((candidate) => candidate.artId === artId);
        window.MrFeastFresh.tamperForQA(entryForArt.id, true);
      }, carrier);
      await visualPage.waitForFunction((artId) => {
        const current = JSON.parse(window.render_game_to_text());
        return current.workroomCode.targets.find((candidate) => candidate.artId === artId)?.revealed === true;
      }, carrier.artId, { timeout: 8000 });
      await visualPage.waitForTimeout(180);
      await visualPage.locator("#mansion-discovery").evaluate((element) => { element.hidden = true; });
      await visualPage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, `scratch-${carrier.artId}-corner-desktop.png`) });
      if (carrier.artId === "five-doors") {
        await completeFirstClueCompetition(visualPage, "painting-scratch:five-doors");
      } else if (carrier.artId === "polite-eclipse") {
        await completeSecondClueCompetition(visualPage, "painting-scratch:polite-eclipse");
      }
      await visualPage.evaluate((artId) => {
        const entryForArt = window.MrFeastFresh.getTamperState().entries.find((candidate) => candidate.artId === artId);
        window.MrFeastFresh.tamperForQA(entryForArt.id, false);
      }, carrier.artId);
    }
    const visualState = await diagnostics(visualPage);
    assert(visualState.renderer.calls > 0 && visualState.renderer.triangles > 0, `renderer diagnostics should remain active after the clue pass; got ${JSON.stringify(visualState.renderer)}`);
    assert(visualErrors.length === 0, `desktop visual console errors: ${visualErrors.join(" | ")}`);
    await visualPage.close();

    // The close clue view must remain readable in the shipped phone profile.
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobileErrors = [];
    watchErrors(mobile, mobileErrors);
    await mobile.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`, { waitUntil: "domcontentloaded" });
    await mobile.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await mobile.evaluate(() => {
      window.MrFeastFresh.teleport("codeScratchFiveDoorsLow");
      const entryForArt = window.MrFeastFresh.getTamperState().entries.find((candidate) => candidate.artId === "five-doors");
      window.MrFeastFresh.tamperForQA(entryForArt.id, true);
    });
    await mobile.waitForFunction(() => JSON.parse(window.render_game_to_text()).workroomCode.targets.find((candidate) => candidate.artId === "five-doors")?.revealed === true, null, { timeout: 8000 });
    await mobile.waitForTimeout(180);
    await mobile.locator("#mansion-discovery").evaluate((element) => { element.hidden = true; });
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "scratch-five-doors-corner-mobile.png") });
    const mobileState = await diagnostics(mobile);
    assert(mobileState.lighting.mobileRenderProfile === true, `the phone proof should use the mobile render profile; got ${JSON.stringify(mobileState.lighting)}`);
    assert(mobileErrors.length === 0, `mobile visual console errors: ${mobileErrors.join(" | ")}`);
    await mobile.close();

    console.log(`Scratch renderer evidence: desktop=${JSON.stringify(visualState.renderer)} mobile=${JSON.stringify(mobileState.renderer)}`);
    console.log("Mr. Feast workroom keycode scratch clue checks passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
