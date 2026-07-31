import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_HEDGE_MAZE_HAUNT_TEST_PORT || (55000 + (process.pid % 9000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-hedge-maze-haunt");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0 && endIndex > startIndex, `missing source section ${start} -> ${end}`);
  return source.slice(startIndex, endIndex);
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

async function captureStage(page, fileName) {
  const box = await page.locator("#mansion-stage").boundingBox();
  assert(box, "mansion stage should have a captureable box");
  await page.screenshot({ path: path.join(artifactDir, fileName), clip: box });
}

async function run() {
  const [runtime, html] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  assert(/const HEDGE_MAZE_HAUNT = Object\.freeze\(\{/.test(runtime), "missing named HEDGE_MAZE_HAUNT tuning table");
  assert(/mazeLockInTriggered/.test(runtime), "the maze lock-in needs a persisted story flag");
  assert(/lockDepthCells:\s*3/.test(runtime), "the entrances should seal after three cells of inward travel");
  assert(/hedgeMazeBlocked:\s*Object\.freeze\(\["\.\.\/Sounds\/mr-feast\/hedge-maze-blocked-sting\.wav"\]\)/.test(runtime), "the supplied blocked-entrance sting must be in the mansion audio manifest");
  assert(/mazeFeastFather:\s*Object\.freeze\(\["\.\.\/Sounds\/mr-feast\/saint-voice-low-long-05\.ogg"\]\)/.test(runtime), "maze movement must use the Feast Father recording");
  assert(/blackoutDurationSeconds:\s*1\.[5-9]/.test(runtime) && /baseScale:\s*0[,\n]/.test(runtime), "the entrance lock must use a clearly readable stutter before the maze fixtures go out");
  assert(/flickerBursts:\s*Object\.freeze\(\[/.test(runtime) && /scale:\s*0\.[5-9]/.test(runtime), "the sustained darkness must use visible multi-pulse fixture flickers");
  const ambientConfig = sourceSection(runtime, "ambient: Object.freeze({", "release: Object.freeze({");
  assert((ambientConfig.match(/Object\.freeze\(\{ start:/g) || []).length >= 5, "ambient haunt pulses must move at least five nearby hedge faces");
  assert(/class HedgeMazeKeyScareSystem/.test(runtime), "missing focused hedge-maze haunt authority");
  const hauntClass = sourceSection(runtime, "class HedgeMazeKeyScareSystem", "class ContestantThirteenQuest");
  assert(/addKinematicBox/.test(hauntClass), "the two entrance seals need fixed-topology kinematic colliders");
  assert(!/addFixedBox|PointLight|SpotLight|DirectionalLight|HemisphereLight/.test(hauntClass), "the haunt must not alter static maze topology or add shader lights");
  assert(!/flashlightSystem\?\.setOn\(false/.test(hauntClass), "the maze haunt must never switch off the player's flashlight");
  const stormRunClass = sourceSection(runtime, "class StormRunSystem", "class FeastHuntSystem");
  assert(/allowsPlayerTools\(\)/.test(stormRunClass), "Storm Run must explicitly preserve player tools");
  const flashlightClass = sourceSection(runtime, "class FlashlightSystem", "class BulkStorageSecretSystem");
  assert(/stormRunSystem\?\.allowsPlayerTools\(\)/.test(flashlightClass), "the flashlight gate must honor Storm Run's player-tool policy");
  const rainClass = sourceSection(runtime, "class RainSystem", "class StormSystem");
  assert(/state\.currentRoom === "HEDGE MAZE"/.test(rainClass) && /this\.lines\.visible/.test(rainClass), "visible rain must stop inside the hedge maze");
  const audioClass = sourceSection(runtime, "class MansionAudio", "function updateAudioButton");
  assert(/mazeSilenced/.test(audioClass), "the rain mix must have an explicit hedge-maze silence state");
  assert(/hedgeMazeFeastFather[\s\S]+volume:\s*0\.1[0-9]/.test(audioClass), "Feast Father maze fragments must be mixed at a clearly audible level");
  assert(/prepareHedgeMazeLockInForQA/.test(runtime), "focused maze lock-in QA staging is missing");
  assert(/collectHedgeMazeKeyForQA/.test(runtime), "focused maze-key release QA control is missing");
  assert(/hedge-maze-haunt/.test(html), "the runtime cache key should identify the hedge-maze haunt release");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const sourceUrl = message.location().url || "";
      if (message.type() === "error" && !/favicon\.ico/i.test(`${message.text()} ${sourceUrl}`)) errors.push(message.text());
    });
    await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.waitForFunction(() => !document.getElementById("mansion-enter")?.disabled, null, { timeout: 120000 });
    await page.locator("#mansion-enter").click({ force: true });
    await page.waitForFunction(() => window.MrFeastFresh?.getAudioStateForQA?.()?.contextState === "running", null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const audio = window.MrFeastFresh?.getAudioStateForQA?.();
      return audio?.loadedAssets?.includes("../Sounds/mr-feast/hedge-maze-blocked-sting.wav")
        && audio?.loadedAssets?.includes("../Sounds/mr-feast/saint-voice-low-long-05.ogg");
    }, null, { timeout: 30000 });
    await page.evaluate(() => window.MrFeastFresh.advanceOpeningWelcomeForQA(120));
    await page.waitForTimeout(180);

    await page.evaluate(() => window.MrFeastFresh.prepareHedgeMazeLockInForQA({ questReady: false }));
    const early = await page.evaluate(() => window.MrFeastFresh.placePlayerInsideHedgeMazeForQA("north", 4));
    assert(!early.lockInTriggered && !early.entrancesSealed, `early exploration must not strand the player: ${JSON.stringify(early)}`);
    await page.waitForTimeout(420);
    const earlyRain = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(
      earlyRain.rain.mazeSilenced && earlyRain.rain.visualSuppressed && earlyRain.rain.targetGain <= 0.0001 && earlyRain.rain.gain <= 0.002,
      `both visible and audible rain must stop when the player enters the maze: ${JSON.stringify(earlyRain.rain)}`,
    );

    const staged = await page.evaluate(() => window.MrFeastFresh.prepareHedgeMazeLockInForQA({ questReady: true, flashlightOn: true }));
    assert(staged.flashlightOn, `QA should stage the real carried flashlight switched on: ${JSON.stringify(staged)}`);
    assert(!staged.mazeDarknessActive, `maze fixtures must remain normal until the entrance actually seals: ${JSON.stringify(staged)}`);
    const locked = await page.evaluate(() => window.MrFeastFresh.placePlayerInsideHedgeMazeForQA("north", 4));
    assert(locked.lockInTriggered && locked.entrancesSealed, `quest-ready inward travel should seal the maze: ${JSON.stringify(locked)}`);
    assert(locked.sealedEntranceCount === 2 && locked.enabledSealColliders === 2, `both portals must be visibly and physically sealed: ${JSON.stringify(locked)}`);
    assert(locked.colliderCountDelta === 0 && locked.fixedBoxCountDelta === 0, `sealing must toggle boot-time colliders without changing topology: ${JSON.stringify(locked)}`);
    assert(locked.mazeDarknessActive && locked.blackoutFlickerActive, `the entrance lock must begin the fixture blackout immediately: ${JSON.stringify(locked)}`);
    assert(locked.flashlightOn, `the carried flashlight must remain usable while the maze is sealed: ${JSON.stringify(locked)}`);
    let mazeAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(mazeAudio.cueCounts.hedgeMazeEntranceBlocked === 1, `the supplied sting must play once when the portals seal: ${JSON.stringify(mazeAudio.cueCounts)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(1.8));
    const blackedOut = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(!blackedOut.blackoutFlickerActive && blackedOut.mazeLightAverageScale <= 0.001, `the lock flicker must settle with maze fixtures fully out: ${JSON.stringify(blackedOut)}`);
    await page.waitForTimeout(140);
    const offLighting = JSON.parse(await page.evaluate(() => window.render_game_to_text())).lighting;
    await captureStage(page, "maze-fixtures-fully-off-desktop.png");
    const visibleFlicker = await page.evaluate(() => {
      for (let index = 0; index < 240; index += 1) {
        const state = window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(0.01);
        if (state.mazeLightMaximumScale >= 0.55) return state;
      }
      return window.MrFeastFresh.getHedgeMazeKeyScareState();
    });
    assert(visibleFlicker.mazeLightMaximumScale >= 0.55, `QA must reach a visible sustained flicker frame: ${JSON.stringify(visibleFlicker)}`);
    await page.waitForTimeout(140);
    const onLighting = JSON.parse(await page.evaluate(() => window.render_game_to_text())).lighting;
    assert(
      onLighting.hemisphereIntensity >= offLighting.hemisphereIntensity + 0.25
        && onLighting.moonIntensity >= offLighting.moonIntensity + 0.25,
      `the visible maze fill must snap brighter with the fixture pulse: ${JSON.stringify({ offLighting, onLighting })}`,
    );
    await captureStage(page, "maze-fixtures-flicker-on-desktop.png");
    const flickerProbe = await page.evaluate(() => {
      const samples = [];
      for (let index = 0; index < 120; index += 1) {
        const state = window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(0.02);
        samples.push({ scale: state.mazeLightMaximumScale, lit: state.mazeLitLightCount });
      }
      return {
        maximumScale: Math.max(...samples.map((sample) => sample.scale)),
        minimumScale: Math.min(...samples.map((sample) => sample.scale)),
        litSamples: samples.filter((sample) => sample.lit > 0).length,
        darkSamples: samples.filter((sample) => sample.lit === 0).length,
        maximumLitLights: Math.max(...samples.map((sample) => sample.lit)),
      };
    });
    assert(
      flickerProbe.maximumScale >= 0.55 && flickerProbe.minimumScale === 0
        && flickerProbe.litSamples >= 10 && flickerProbe.darkSamples >= 40
        && flickerProbe.maximumLitLights === blackedOut.mazeDarkenedLightCount,
      `the mostly-off maze needs an unmistakable all-fixture multi-pulse flicker: ${JSON.stringify(flickerProbe)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(0.8));
    const sealedView = await page.evaluate(() => window.MrFeastFresh.placePlayerAtHedgeMazeSealForQA("north"));
    assert(
      sealedView.entranceSeals.every((seal) => seal.visible && seal.openness <= 0.01),
      `both living-hedge seals should finish rising into view: ${JSON.stringify(sealedView)}`,
    );
    await captureStage(page, "maze-north-entrance-sealed-desktop.png");
    const collisionProbe = await page.evaluate(() => window.MrFeastFresh.probeHedgeMazeSealCollisionForQA("north"));
    assert(collisionProbe.blocked, `the raised north seal must physically stop an exit attempt: ${JSON.stringify(collisionProbe)}`);
    await page.evaluate(() => window.MrFeastFresh.placePlayerInsideHedgeMazeForQA("north", 4));

    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(28));
    const haunted = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(haunted.ambientPulseCount >= 3, `the player should get several scares before finding the key: ${JSON.stringify(haunted)}`);
    assert(haunted.flickerCount >= 5 && haunted.mazeLightAverageScale <= 0.12, `the blacked-out fixtures should continue sparse flickering: ${JSON.stringify(haunted)}`);
    assert(haunted.ambientSpotCount >= 5, `each ambient pulse should pressure at least five nearby hedge faces: ${JSON.stringify(haunted)}`);
    assert(haunted.flashlightOn && haunted.entrancesSealed, `the flashlight and seals must survive recurring scares: ${JSON.stringify(haunted)}`);
    mazeAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert((mazeAudio.cueCounts.hedgeMazeFeastFather || 0) >= 6, `each recurring hedge movement should carry two Feast Father voice fragments: ${JSON.stringify(mazeAudio.cueCounts)}`);
    assert(
      mazeAudio.hedgeMaze.feastFatherPlayCount >= 6
        && mazeAudio.hedgeMaze.lastFeastFatherVolume >= 0.1
        && mazeAudio.hedgeMaze.lastFeastFatherLowpassHz >= 1600,
      `the decoded Feast Father fragments must be played with an audible maze mix: ${JSON.stringify(mazeAudio.hedgeMaze)}`,
    );
    await captureStage(page, "maze-locked-recurring-haunt-desktop.png");

    const saveRoundTrip = await page.evaluate(() => {
      const saved = window.MrFeastFresh.saveGameForQA();
      window.MrFeastFresh.resetHedgeMazeKeyScareForQA(true);
      const cleared = window.MrFeastFresh.getHedgeMazeKeyScareState();
      const loaded = window.MrFeastFresh.loadGameForQA();
      window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(0.2);
      return { saved, loaded, cleared, restored: window.MrFeastFresh.getHedgeMazeKeyScareState() };
    });
    assert(saveRoundTrip.saved && saveRoundTrip.loaded && !saveRoundTrip.cleared.lockInTriggered, `the lock-in save round trip should execute: ${JSON.stringify(saveRoundTrip)}`);
    assert(saveRoundTrip.restored.lockInTriggered && saveRoundTrip.restored.entrancesSealed, `save/load inside the maze must restore both seals: ${JSON.stringify(saveRoundTrip.restored)}`);
    mazeAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(mazeAudio.cueCounts.hedgeMazeEntranceBlocked === 1, `restoring a locked-maze save must not replay the realization sting: ${JSON.stringify(mazeAudio.cueCounts)}`);

    const feast = await page.evaluate(() => window.MrFeastFresh.completeFeastSaysForQA(6));
    assert(feast?.survived === true, `flashlight regression setup should complete Feast Says: ${JSON.stringify(feast)}`);
    await page.evaluate(() => window.MrFeastFresh.setHedgeMazeFlashlightForQA(true));
    const keyCall = await page.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("key"));
    assert(keyCall?.phase === "called", `the real B-13 clue transition should call Storm Run: ${JSON.stringify(keyCall)}`);
    const released = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(released.active && released.sequence === "release" && released.keyOwned, `the real key-owned release scare should begin: ${JSON.stringify(released)}`);
    assert(!released.entrancesSealed && released.enabledSealColliders === 0, `finding the key must immediately reopen both entrances: ${JSON.stringify(released)}`);
    assert(!released.mazeDarknessActive && released.flashlightOn, `key recovery should restore fixtures without touching the flashlight: ${JSON.stringify(released)}`);
    assert(released.flashlightCanToggle, `Storm Run's post-key call must leave flashlight input available: ${JSON.stringify(released)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(0.1));
    const postKeyFlashlight = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(postKeyFlashlight.flashlightOn && postKeyFlashlight.flashlightCanToggle, `the beam must remain on after the B-13/Storm Run state update: ${JSON.stringify(postKeyFlashlight)}`);
    assert(released.durationSeconds >= 11, `the release scare should last longer than the old quick beat: ${JSON.stringify(released)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(3.2));
    const releaseBeat = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(releaseBeat.active && releaseBeat.visibleBulges >= 2 && releaseBeat.visibleLeaves > 0, `the longer key release should surround the player: ${JSON.stringify(releaseBeat)}`);
    await captureStage(page, "maze-key-release-desktop.png");
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(10));
    const complete = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(!complete.active && complete.phase === "complete", `the release sequence should cleanly finish: ${JSON.stringify(complete)}`);
    assert(!complete.entrancesSealed && complete.dimmedLightCount === 0, `completion must leave exits and lighting restored: ${JSON.stringify(complete)}`);

    await context.close();
    assert(errors.length === 0, `unexpected browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast hedge-maze haunt acceptance passed: maze rain silence, unmistakable multi-pulse fixture flicker, audible two-beat Feast Father movement voice, supplied lock sting, five-face recurring movement, persistent entrance seals, post-key Storm Run flashlight continuity, save/load restoration, and longer key release verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
