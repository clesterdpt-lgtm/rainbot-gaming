import { spawn } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_CATCH_SCARE_TEST_PORT || (61800 + (process.pid % 3000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-catch-scare");

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
  for (let attempt = 0; attempt < 120; attempt += 1) {
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

async function bootPage(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  watchErrors(page, errors);
  await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 180000 });
  await page.waitForFunction(
    () => window.MrFeastFresh.getMrFeastState()?.loadStatus === "ready",
    null,
    { timeout: 180000 },
  );
  await page.waitForFunction(() => window.MrFeastFresh?.state?.started, null, { timeout: 15000 });
  await page.evaluate(() => window.MrFeastFresh.awaitCatchScareAssetsForQA());
  await page.waitForFunction(
    () => window.MrFeastFresh.getCatchScareState()?.assetStatus === "ready",
    null,
    { timeout: 180000 },
  );
  if (!await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA()?.enabled)) {
    await page.keyboard.press("KeyM");
    await page.waitForFunction(
      () => window.MrFeastFresh.getAudioStateForQA()?.contextState === "running"
        && window.MrFeastFresh.getAudioStateForQA()?.enabled,
      null,
      { timeout: 15000 },
    );
  }
  return page;
}

async function assertSourceContract() {
  const [runtime, html] = await Promise.all([
    readFile(path.join(root, "assets", "js", "mr-feast-mansion.js"), "utf8"),
    readFile(path.join(root, "games", "mr-feast-mansion.html"), "utf8"),
  ]);
  assert(/const CATCH_SCARE\s*=\s*Object\.freeze\(\{[\s\S]{0,120}?durationSeconds:\s*2/.test(runtime), "catch scare must last exactly two seconds");
  assert(/class CatchScareSystem/.test(runtime), "missing focused CatchScareSystem");
  assert(/catcherForReason\(reason\)/.test(runtime), "catcher identity must derive from the confirmed catch reason");
  assert(/reasons:[\s\S]{0,180}?witnessed[\s\S]{0,180}?recorded[\s\S]{0,180}?feast-hunt-eliminated/.test(runtime), "Mr. Feast physical catch reasons are not explicit");
  assert(/"feast-father"[\s\S]{0,220}?reasons:[\s\S]{0,80}?victory-feast-saint/.test(runtime), "Feast Father physical catch reason is not explicit");
  assert(/cloneCatcher\(source\)[\s\S]{0,260}?SkeletonUtils/.test(runtime), "the close-up must clone the live 3D catcher model");
  assert(/mr-feast-master\.glb/.test(runtime) && /feast-father-closeup\.glb/.test(runtime), "the scares must use the retained 2K close-up sources");
  assert(/maximumTextureSize/.test(runtime) && /LinearMipmapLinearFilter/.test(runtime), "the close-up texture-quality pass is missing");
  assert(/catchScare\(catcherId/.test(runtime), "the catch flow needs a dedicated character-specific SFX entrypoint");
  assert(/confirmedCatchOnly:\s*true/.test(runtime) && /unskippable:\s*true/.test(runtime), "confirmed-only and unskippable contracts must be diagnostic");
  assert(/flashing:\s*false/.test(runtime) && /reducedMotionScale:\s*0\.18/.test(runtime), "no-flash and reduced-motion contracts must be explicit");
  assert(/data-catch-scare="inactive"/.test(html) && /mansion-catch-scare/.test(html), "the page needs a dedicated noninteractive scare presentation layer");
  assert(!/mansion-catch-scare-grain/.test(html), "the artificial grain animation must not dirty the character close-ups");
  assert(/prefers-reduced-motion:\s*reduce/.test(html), "the page must retain reduced-motion CSS handling");
}

async function assertScreenshot(pathname, label) {
  const info = await stat(pathname);
  assert(info.size >= 55000, `${label} screenshot is unexpectedly small (${info.size} bytes)`);
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
    const page = await bootPage(browser, errors);

    const initial = await page.evaluate(() => window.MrFeastFresh.getCatchScareState());
    assert(initial.phase === "inactive" && !initial.overlayVisible, `scare must be dormant before a catch: ${JSON.stringify(initial)}`);

    const cameraSpot = await page.evaluate(() => {
      window.MrFeastFresh.resetCameraSecurityForQA("show");
      const cameraId = window.MrFeastFresh.getCameraSecurityState().cameras.details[0].id;
      const alarm = window.MrFeastFresh.triggerCameraAlarmForQA(cameraId, "qa-camera-spot-only");
      return {
        alarmTriggered: Boolean(alarm?.alarm?.last),
        gameOver: window.MrFeastFresh.state.gameOver,
        scare: window.MrFeastFresh.getCatchScareState(),
      };
    });
    assert(cameraSpot.alarmTriggered, `camera setup must create a real alarm: ${JSON.stringify(cameraSpot)}`);
    assert(cameraSpot.gameOver === null && cameraSpot.scare.phase === "inactive", `camera spotting alone must not trigger the scare: ${JSON.stringify(cameraSpot)}`);
    await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.resetCameraSecurityForQA(null);
    });

    await page.evaluate(() => {
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
      window.dispatchEvent(new Event("resize"));
    });
    await page.waitForFunction(
      () => window.MrFeastFresh.getCatchScareState().cleanPresentation.pixelRatio === 1.25,
    );
    const mrCatch = await page.evaluate(() => window.MrFeastFresh.triggerCatchScareForQA("mr-feast"));
    assert(mrCatch?.reason === "witnessed", `Mr. Feast QA catch must use a confirmed physical reason: ${JSON.stringify(mrCatch)}`);
    let scare = await page.evaluate(() => window.MrFeastFresh.getCatchScareState());
    assert(
      scare.phase === "active"
        && scare.catcher === "mr-feast"
        && scare.modelSource === "mr-feast-closeup-2k"
        && scare.highDetailSource
        && scare.assetStatus === "ready"
        && scare.modelCloned
        && scare.modelVisible
        && scare.framing === "live-3d-close-up"
        && scare.camera.focusOnScreen
        && scare.durationSeconds === 2
        && scare.confirmedCatchOnly
        && scare.unskippable
        && !scare.flashing
        && !scare.cleanPresentation.animatedGrain
        && scare.cleanPresentation.maximumTextureSize === 2048
        && scare.cleanPresentation.texturesEnhanced > 0
        && scare.cleanPresentation.normalsRecomputed > 0
        && scare.cleanPresentation.pixelRatio === 1.75,
      `Mr. Feast scare contract failed: ${JSON.stringify(scare)}`,
    );
    await page.keyboard.press("Escape");
    const unskippable = await page.evaluate(() => ({
      scare: window.MrFeastFresh.getCatchScareState(),
      overlayHidden: document.getElementById("mansion-gameover").hidden,
    }));
    assert(unskippable.scare.phase === "active" && unskippable.overlayHidden, `Escape must not skip the two-second scare: ${JSON.stringify(unskippable)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceCatchScareForQA(0.72));
    const mrScreenshot = path.join(artifactDir, "mr-feast-catch-scare.png");
    await page.locator("#mansion-stage").screenshot({ path: mrScreenshot });
    await assertScreenshot(mrScreenshot, "Mr. Feast scare");
    const mrAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA().catchScare);
    assert(
      mrAudio.playCount === 1
        && mrAudio.mrFeastPlayCount === 1
        && mrAudio.lastCatcher === "mr-feast"
        && mrAudio.lastImpactHz === 52
        && mrAudio.lastShriekStartHz === 860,
      `Mr. Feast stinger diagnostics failed: ${JSON.stringify(mrAudio)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceCatchScareForQA(1.27));
    scare = await page.evaluate(() => window.MrFeastFresh.getCatchScareState());
    assert(scare.phase === "active" && scare.elapsed >= 1.98 && scare.elapsed < 2, `scare must still own the screen before exactly two seconds: ${JSON.stringify(scare)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceCatchScareForQA(0.02));
    await page.waitForFunction(
      () => window.MrFeastFresh.getCatchScareState().phase === "inactive"
        && window.MrFeastFresh.getBanquetLossState().visible,
      null,
      { timeout: 180000 },
    );
    await page.evaluate(() => window.MrFeastFresh.clearBanquetLossForQA());

    await page.evaluate(() => window.MrFeastFresh.awaitVictoryFeastAssetsForQA());
    await page.waitForFunction(
      () => window.MrFeastFresh.getDemonPrototypeState()?.entries?.some(
        (entry) => entry.id === "banquet-saint" && entry.status === "ready",
      ),
      null,
      { timeout: 180000 },
    );
    const fatherCatch = await page.evaluate(() => window.MrFeastFresh.triggerCatchScareForQA("feast-father"));
    assert(fatherCatch?.reason === "victory-feast-saint", `Feast Father QA catch must use its physical reason: ${JSON.stringify(fatherCatch)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceCatchScareForQA(0.82));
    scare = await page.evaluate(() => window.MrFeastFresh.getCatchScareState());
    assert(
      scare.phase === "active"
        && scare.catcher === "feast-father"
        && scare.modelSource === "feast-father-closeup-2k"
        && scare.highDetailSource
        && scare.modelCloned
        && scare.modelVisible
        && scare.camera.focusOnScreen
        && !scare.cleanPresentation.animatedGrain
        && scare.cleanPresentation.maximumTextureSize === 2048
        && scare.cleanPresentation.pixelRatio === 1.75,
      `Feast Father scare contract failed: ${JSON.stringify(scare)}`,
    );
    const fatherScreenshot = path.join(artifactDir, "feast-father-catch-scare.png");
    await page.locator("#mansion-stage").screenshot({ path: fatherScreenshot });
    await assertScreenshot(fatherScreenshot, "Feast Father scare");
    const fatherAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA().catchScare);
    assert(
      fatherAudio.playCount === 2
        && fatherAudio.feastFatherPlayCount === 1
        && fatherAudio.lastCatcher === "feast-father"
        && fatherAudio.lastImpactHz === 34
        && fatherAudio.lastShriekStartHz === 510
        && fatherAudio.lastShriekEndHz === 58,
      `Feast Father stinger must remain distinct from Mr. Feast: ${JSON.stringify(fatherAudio)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.clearBanquetLossForQA());

    await page.evaluate(() => { window.MrFeastFresh.state.reducedFlash = true; });
    await page.evaluate(() => window.MrFeastFresh.triggerCatchScareForQA("mr-feast"));
    const reduced = await page.evaluate(() => window.MrFeastFresh.getCatchScareState());
    assert(
      reduced.reducedMotion
        && reduced.reducedMotionScale === 0.18
        && reduced.camera.shakePositionHeightRatio > 0
        && reduced.camera.shakeRotationRadians > 0,
      `reduced motion must keep only a smaller jolt: ${JSON.stringify(reduced)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.clearBanquetLossForQA());

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      window.MrFeastFresh.state.reducedFlash = false;
      window.MrFeastFresh.triggerCatchScareForQA("feast-father");
      window.MrFeastFresh.advanceCatchScareForQA(0.74);
    });
    const phoneLayout = await page.evaluate(() => {
      const stage = document.getElementById("mansion-stage").getBoundingClientRect();
      const overlay = document.getElementById("mansion-catch-scare").getBoundingClientRect();
      return {
        scare: window.MrFeastFresh.getCatchScareState(),
        stage: { width: stage.width, height: stage.height },
        overlay: { width: overlay.width, height: overlay.height },
        gameOverHidden: document.getElementById("mansion-gameover").hidden,
      };
    });
    assert(
      phoneLayout.scare.phase === "active"
        && phoneLayout.scare.camera.focusOnScreen
        && phoneLayout.stage.width === phoneLayout.overlay.width
        && phoneLayout.stage.height === phoneLayout.overlay.height
        && phoneLayout.scare.cleanPresentation.pixelRatio === 1.35
        && phoneLayout.gameOverHidden,
      `phone scare must fill the game surface without exposing recovery controls: ${JSON.stringify(phoneLayout)}`,
    );
    const phoneScreenshot = path.join(artifactDir, "feast-father-catch-scare-phone.png");
    await page.locator("#mansion-stage").screenshot({ path: phoneScreenshot });
    await assertScreenshot(phoneScreenshot, "phone Feast Father scare");
    await page.evaluate(() => window.MrFeastFresh.clearBanquetLossForQA());
    await page.close();

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast confirmed-catch scare regression passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
