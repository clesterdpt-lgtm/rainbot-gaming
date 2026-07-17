import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_PURSUIT_TEST_PORT || (49000 + (process.pid % 14000)));
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-caught-pursuit");

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

async function bootPage(browser, viewport, errors) {
  const page = await browser.newPage({ viewport });
  watchErrors(page, errors);
  await page.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
  await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loadStatus === "ready", null, { timeout: 120000 });
  await page.waitForTimeout(300);
  return page;
}

async function run() {
  const runtimeSource = await readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8");
  const pageSource = await readFile(path.join(root, "games/mr-feast-mansion.html"), "utf8");
  assert(/const MR_FEAST_PURSUIT\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the MR_FEAST_PURSUIT tuning table");
  assert(/id="mansion-gameover"[^>]+role="dialog"[^>]+aria-modal="true"/.test(pageSource), "page is missing the accessible game-over dialog");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });

    const desktopErrors = [];
    const page = await bootPage(browser, { width: 1280, height: 820 }, desktopErrors);

    // --- Baseline: pursuit idle, hard speed cap under player walk speed ------
    let state = await diagnostics(page);
    assert(state.mrFeast.pursuit && state.mrFeast.pursuit.active === null, `pursuit diagnostics should start idle; got ${JSON.stringify(state.mrFeast.pursuit)}`);
    assert(state.gameOver === null, "the game should not start in a fail state");
    assert(state.mrFeast.pursuit.speed < state.player.movement.walkSpeed, `pursuit speed must stay below player walk speed; got ${JSON.stringify({ pursuit: state.mrFeast.pursuit.speed, walk: state.player.movement.walkSpeed })}`);

    // --- Witnessed in person: he sees the tilt and starts running ------------
    await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 10.6, y: 0, z: 7.8, yaw: Math.PI / 2 });
      window.MrFeastFresh.teleport("tamperMusicPortrait");
    });
    await page.waitForFunction(() => /tilt/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(page, "KeyE", "e");
    await page.waitForTimeout(150);
    state = await diagnostics(page);
    assert(state.mrFeast.pursuit.active?.reason === "witnessed", `a tamper performed in his sight should start a witnessed pursuit; got ${JSON.stringify(state.mrFeast.pursuit.active)}`);
    assert(state.speech.visible && state.speech.category === "pursuit-witnessed", `a witnessed start should speak a pursuit line; got ${JSON.stringify(state.speech)}`);

    // Straightening the evidence does not undo being seen: the pursuit stays.
    state = await page.evaluate(() => {
      const tilted = window.MrFeastFresh.getTamperState().entries.find((entry) => entry.tampered);
      if (tilted) window.MrFeastFresh.tamperForQA(tilted.id, false);
      return JSON.parse(window.render_game_to_text());
    });
    assert(state.mrFeast.pursuit.active?.reason === "witnessed", "self-fixing the object must not cancel an active pursuit");

    // --- Warning catch on the main level -------------------------------------
    const warningRun = await page.evaluate(() => window.MrFeastFresh.runMrFeastPursuitForQA(120));
    assert(warningRun.outcome === "warning", `catching on the main level should end in a warning; got ${JSON.stringify(warningRun)}`);
    assert(warningRun.teleports === 0, "pursuit must not teleport Mr. Feast");
    assert(warningRun.maxFrameSpeed <= warningRun.pursuitSpeed + 0.05, `pursuit translation should respect the tuned speed; got ${JSON.stringify(warningRun)}`);
    assert(warningRun.pursuitSpeed < warningRun.playerWalkSpeed, `the effective pursuit speed must remain below player walk speed; got ${JSON.stringify(warningRun)}`);
    assert(warningRun.actionsSeen.includes("run"), `pursuit should use the run animation; got ${JSON.stringify(warningRun.actionsSeen)}`);
    state = await diagnostics(page);
    assert(state.mrFeast.pursuit.warnings === 1 && state.mrFeast.pursuit.catches === 1, `the warning should be counted; got ${JSON.stringify(state.mrFeast.pursuit)}`);
    assert(state.gameOver === null, "a main-level catch must not end the game");
    assert(state.speech.lastCategory === "warning", `the catch should deliver a warning line; got ${JSON.stringify(state.speech)}`);
    assert(state.mrFeast.security.state === "patrol", `he should resume patrol after the warning; got ${state.mrFeast.security.state}`);

    // --- No pursuit without a witness, and straightening is never an infraction
    await page.evaluate(() => {
      const tilted = window.MrFeastFresh.getTamperState().entries.find((entry) => entry.tampered);
      if (tilted) window.MrFeastFresh.tamperForQA(tilted.id, false);
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.teleport("tamperMusicPortrait");
    });
    await page.waitForFunction(() => /tilt/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(page, "KeyE", "e");
    await page.waitForTimeout(150);
    state = await diagnostics(page);
    assert(state.mrFeast.pursuit.active === null, `a tamper he cannot see or record should not start a pursuit; got ${JSON.stringify(state.mrFeast.pursuit.active)}`);
    await page.waitForFunction(() => /straighten/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(page, "KeyE", "e");
    await page.waitForTimeout(150);
    state = await diagnostics(page);
    assert(state.mrFeast.pursuit.active === null, "straightening an object must never trigger a pursuit");

    // --- Hidden players cannot be caught; bounded give-up --------------------
    await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 10.6, y: 0, z: 7.8, yaw: Math.PI / 2 });
      window.MrFeastFresh.teleport("tamperMusicPortrait");
    });
    await page.waitForFunction(() => /tilt/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(page, "KeyE", "e");
    await page.waitForTimeout(120);
    const hid = await page.evaluate(() => {
      const tilted = window.MrFeastFresh.getTamperState().entries.find((entry) => entry.tampered);
      if (tilted) window.MrFeastFresh.tamperForQA(tilted.id, false);
      window.MrFeastFresh.setPursuitGiveUpForQA(3);
      return window.MrFeastFresh.enterHideSpotForQA();
    });
    assert(hid && hid.hidden === true, `the QA hide hook should tuck the player into a hiding spot; got ${JSON.stringify(hid)}`);
    const hiddenRun = await page.evaluate(() => window.MrFeastFresh.runMrFeastPursuitForQA(120));
    assert(hiddenRun.outcome === "lost", `a hidden player should force the pursuit to give up; got ${JSON.stringify(hiddenRun)}`);
    state = await diagnostics(page);
    assert(state.mrFeast.pursuit.catches === 0, `a hidden player must not be caught; got ${JSON.stringify(state.mrFeast.pursuit)}`);
    assert(state.speech.lastCategory === "pursuit-lost", `an abandoned pursuit should speak a frustrated line; got ${JSON.stringify(state.speech)}`);
    await page.evaluate(() => window.MrFeastFresh.leaveHideSpotForQA());

    // --- Recorded trigger: tampering while the camera pill reads Being recorded
    await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.resetCameraSecurityForQA("show");
      const cameraId = window.MrFeastFresh.getCameraSecurityState().cameras.details[0].id;
      window.MrFeastFresh.setCameraSoloForQA(cameraId);
      window.MrFeastFresh.placePlayerInCameraLaneForQA(cameraId, { distance: 4 });
      window.MrFeastFresh.setCameraPolicyForQA("lockdown");
    });
    await page.waitForFunction(() => {
      window.MrFeastFresh.advanceCameraSecurityForQA(0.4);
      return window.MrFeastFresh.getCameraSecurityState().recordingPlayer === true;
    }, null, { timeout: 20000 });
    const recordedStart = await page.evaluate(() => {
      const chair = window.MrFeastFresh.getTamperState().entries.find((entry) => entry.kind === "chair");
      window.MrFeastFresh.tamperForQA(chair.id, true);
      return JSON.parse(window.render_game_to_text());
    });
    assert(recordedStart.mrFeast.pursuit.active?.reason === "recorded", `tampering while recorded should start a recorded pursuit; got ${JSON.stringify(recordedStart.mrFeast.pursuit.active)}`);
    assert(recordedStart.speech.category === "pursuit-recorded", `a recorded start should use the recorded pool; got ${JSON.stringify(recordedStart.speech)}`);
    await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.resetCameraSecurityForQA(null);
      const pulled = window.MrFeastFresh.getTamperState().entries.find((entry) => entry.tampered);
      if (pulled) window.MrFeastFresh.tamperForQA(pulled.id, false);
    });

    // --- Basement catch is game over, and loading a save recovers ------------
    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    await page.waitForTimeout(120);
    const saved = await page.evaluate(() => window.MrFeastFresh.saveGameForQA());
    assert(saved === true, "the pre-capture save should succeed");
    await page.evaluate(() => {
      window.MrFeastFresh.teleport("archive");
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 3.0, y: -3.8, z: 4.6, yaw: 0 });
      window.MrFeastFresh.reportInfractionForQA("portrait");
    });
    state = await diagnostics(page);
    assert(state.mrFeast.pursuit.active?.reason === "witnessed", `the basement infraction should be witnessed at close range; got ${JSON.stringify(state.mrFeast.pursuit.active)}`);
    const basementRun = await page.evaluate(() => window.MrFeastFresh.runMrFeastPursuitForQA(120));
    assert(basementRun.outcome === "game-over", `a basement catch should end the game; got ${JSON.stringify(basementRun)}`);
    state = await diagnostics(page);
    assert(state.gameOver && state.gameOver.floor === "BASEMENT", `game over should record the basement catch; got ${JSON.stringify(state.gameOver)}`);
    assert(state.speech.lastCategory === "caught-basement", `the capture should speak a basement line; got ${JSON.stringify(state.speech)}`);
    let overlay = await page.evaluate(() => {
      const element = document.getElementById("mansion-gameover");
      return { hidden: element.hidden, title: element.querySelector("#mansion-gameover-title")?.textContent || "", loadDisabled: document.getElementById("mansion-gameover-load")?.disabled };
    });
    assert(!overlay.hidden && /caught/i.test(overlay.title), `the CAUGHT overlay should be visible; got ${JSON.stringify(overlay)}`);
    assert(overlay.loadDisabled === false, "the load button should be enabled when a save exists");
    await page.screenshot({ path: path.join(artifactDir, "game-over-desktop.png") });

    // Simulation must freeze underneath the overlay.
    const frozenBefore = await page.evaluate(() => JSON.parse(window.render_game_to_text()).mrFeast.position);
    await page.evaluate(() => window.advanceTime(600));
    const frozenAfter = await page.evaluate(() => JSON.parse(window.render_game_to_text()).mrFeast.position);
    assert(frozenBefore.x === frozenAfter.x && frozenBefore.z === frozenAfter.z, `the simulation should freeze during game over; got ${JSON.stringify({ frozenBefore, frozenAfter })}`);

    await page.click("#mansion-gameover-load");
    await page.waitForTimeout(250);
    state = await diagnostics(page);
    assert(state.gameOver === null, "loading the save should clear the fail state");
    assert(Math.abs(state.player.x) < 2.5 && Math.abs(state.player.z - 9.8) < 2.5, `loading should restore the pre-capture foyer position; got ${JSON.stringify({ x: state.player.x, z: state.player.z })}`);
    assert(state.mrFeast.security.state === "patrol" && state.mrFeast.pursuit.active === null, `Mr. Feast should recover to patrol after loading; got ${JSON.stringify({ security: state.mrFeast.security.state, pursuit: state.mrFeast.pursuit.active })}`);
    overlay = await page.evaluate(() => document.getElementById("mansion-gameover").hidden);
    assert(overlay === true, "the overlay should close after loading");

    assert(desktopErrors.length === 0, `desktop console errors: ${desktopErrors.join(" | ")}`);
    await page.close();

    // --- Mobile game-over layout ---------------------------------------------
    const mobileErrors = [];
    const mobile = await bootPage(browser, { width: 390, height: 844 }, mobileErrors);
    await mobile.evaluate(() => {
      window.MrFeastFresh.teleport("archive");
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 3.0, y: -3.8, z: 4.6, yaw: 0 });
      window.MrFeastFresh.reportInfractionForQA("portrait");
      return window.MrFeastFresh.runMrFeastPursuitForQA(120);
    });
    const mobileOverlay = await mobile.evaluate(() => {
      const element = document.getElementById("mansion-gameover");
      const rect = element.querySelector(".mansion-menu__panel").getBoundingClientRect();
      const restart = document.getElementById("mansion-gameover-restart").getBoundingClientRect();
      return { hidden: element.hidden, panelRight: rect.right, restartHeight: restart.height };
    });
    assert(!mobileOverlay.hidden, "the mobile game-over overlay should render");
    assert(mobileOverlay.panelRight <= 390, `the mobile panel should fit the phone viewport; got ${JSON.stringify(mobileOverlay)}`);
    assert(mobileOverlay.restartHeight >= 40, `mobile buttons should stay comfortably tappable; got ${JSON.stringify(mobileOverlay)}`);
    await mobile.screenshot({ path: path.join(artifactDir, "game-over-mobile.png") });
    assert(mobileErrors.length === 0, `mobile console errors: ${mobileErrors.join(" | ")}`);
    await mobile.close();

    console.log("Mr. Feast caught-in-the-act pursuit checks passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
