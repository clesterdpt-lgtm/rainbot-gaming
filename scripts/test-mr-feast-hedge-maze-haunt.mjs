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
  assert(/ambientStartDepthCells:\s*7/.test(runtime), "recurring hedge movement should wait until the player is deeper in the maze");
  assert(/visualFadeResponse:\s*1\.8/.test(runtime) && /audioFadeResponse:\s*0\.72/.test(runtime), "maze rain should fade out over a readable transition");
  assert(/hedgeMazeBlocked:\s*Object\.freeze\(\["\.\.\/Sounds\/mr-feast\/hedge-maze-blocked-sting\.wav"\]\)/.test(runtime), "the supplied blocked-entrance sting must be in the mansion audio manifest");
  assert(/mazeFeastFather:\s*Object\.freeze\(\["\.\.\/Sounds\/mr-feast\/saint-voice-low-long-05\.ogg"\]\)/.test(runtime), "maze movement must use the Feast Father recording");
  assert(/blackoutDurationSeconds:\s*1\.[5-9]/.test(runtime) && /baseScale:\s*0[,\n]/.test(runtime), "the entrance lock must use a clearly readable stutter before the maze fixtures go out");
  assert(/flickerBursts:\s*Object\.freeze\(\[/.test(runtime) && /scale:\s*0\.[5-9]/.test(runtime), "the sustained darkness must use visible multi-pulse fixture flickers");
  assert(
    /hedge-maze-lantern-bulbs/.test(runtime)
      && /hedge-maze-rear-exit-lantern-bulbs/.test(runtime)
      && /eventIntensityScale/.test(runtime)
      && /syncBulbMaterialState\(snapshot\.bulb\)/.test(runtime),
    "maze lantern bulbs need event-owned render groups that follow the same blackout scale as their real lights",
  );
  const ambientConfig = sourceSection(runtime, "ambient: Object.freeze({", "release: Object.freeze({");
  assert((ambientConfig.match(/Object\.freeze\(\{ start:/g) || []).length >= 5, "ambient haunt pulses must move at least five nearby hedge faces");
  assert(
    /aheadMinimumMeters:\s*1\.35/.test(ambientConfig)
      && /aheadTargetMeters:\s*2\.4/.test(ambientConfig)
      && /aheadMaximumMeters:\s*4\.8/.test(ambientConfig),
    "ambient hedge movement needs an authored few-feet-ahead placement window",
  );
  assert(
    /shallowVolume:\s*0\.1/.test(ambientConfig) && /deepVolume:\s*0\.24/.test(ambientConfig),
    "Feast Father breathing needs a named shallow-to-deep volume range",
  );
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
  assert(/state\.currentRoom === "HEDGE MAZE"[\s\S]*?!hedgeMazeKeyRecovered\(\)/.test(rainClass) && /this\.lines\.visible/.test(rainClass), "visible rain must stop inside the hedge maze only until the key is recovered");
  const audioClass = sourceSection(runtime, "class MansionAudio", "function updateAudioButton");
  assert(/mazeSilenced[\s\S]*?!hedgeMazeKeyRecovered\(\)/.test(audioClass), "the rain mix must release its hedge-maze silence after key recovery");
  assert(/hedgeMazeFeastFather[\s\S]+depthPressure[\s\S]+breathing\.deepVolume/.test(audioClass), "Feast Father maze fragments must consume the depth-based volume range");
  assert(/prepareHedgeMazeLockInForQA/.test(runtime), "focused maze lock-in QA staging is missing");
  assert(/triggerHedgeMazeAmbientForQA/.test(runtime), "focused recurring-haunt QA trigger is missing");
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
      earlyRain.rain.mazeSilenced && earlyRain.rain.visualSuppressed && earlyRain.rain.targetGain <= 0.0001,
      `both visible and audible rain must stop when the player enters the maze: ${JSON.stringify(earlyRain.rain)}`,
    );
    assert(
      earlyRain.rain.visualFading && earlyRain.rain.visualOpacity > 0.02 && earlyRain.rain.gain > 0.002,
      `the rain should ease away instead of cutting out at the maze boundary: ${JSON.stringify(earlyRain.rain)}`,
    );
    await page.waitForFunction(
      () => window.MrFeastFresh?.getAudioStateForQA?.()?.rain?.visualOpacity <= 0.02,
      null,
      { timeout: 12000 },
    );
    const settledRain = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(
      settledRain.rain.visualOpacity <= 0.02 && settledRain.rain.gain <= 0.03,
      `the slower rain transition should eventually settle into silence: ${JSON.stringify(settledRain.rain)}`,
    );

    const staged = await page.evaluate(() => window.MrFeastFresh.prepareHedgeMazeLockInForQA({ questReady: true, flashlightOn: true }));
    assert(staged.flashlightOn, `QA should stage the real carried flashlight switched on: ${JSON.stringify(staged)}`);
    assert(!staged.mazeDarknessActive, `maze fixtures must remain normal until the entrance actually seals: ${JSON.stringify(staged)}`);
    const locked = await page.evaluate(() => window.MrFeastFresh.placePlayerInsideHedgeMazeForQA("north", 4));
    assert(locked.lockInTriggered && locked.entrancesSealed, `quest-ready inward travel should seal the maze: ${JSON.stringify(locked)}`);
    assert(locked.sealedEntranceCount === 2 && locked.enabledSealColliders === 2, `both portals must be visibly and physically sealed: ${JSON.stringify(locked)}`);
    assert(locked.colliderCountDelta === 0 && locked.fixedBoxCountDelta === 0, `sealing must toggle boot-time colliders without changing topology: ${JSON.stringify(locked)}`);
    assert(locked.mazeDarknessActive && locked.blackoutFlickerActive, `the entrance lock must begin the fixture blackout immediately: ${JSON.stringify(locked)}`);
    assert(locked.mazeBulbGroupCount === 2 && locked.mazeDarkenedBulbCount >= 17, `every authored maze bulb must join the blackout without darkening unrelated estate lamps: ${JSON.stringify(locked)}`);
    assert(locked.flashlightOn, `the carried flashlight must remain usable while the maze is sealed: ${JSON.stringify(locked)}`);
    let mazeAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(!mazeAudio.cueCounts.hedgeMazeEntranceBlocked, `the realization sting must wait for the visible blocked-entrance reveal: ${JSON.stringify(mazeAudio.cueCounts)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(0.18));
    mazeAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(!mazeAudio.cueCounts.hedgeMazeEntranceBlocked, `the sting should not play while the entrance is still rising: ${JSON.stringify(mazeAudio.cueCounts)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(1.8));
    mazeAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(mazeAudio.cueCounts.hedgeMazeEntranceBlocked === 1, `the supplied sting must play after the player can see the entrance blocked: ${JSON.stringify(mazeAudio.cueCounts)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(1.8));
    const blackedOut = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(
      !blackedOut.blackoutFlickerActive
        && blackedOut.mazeLightAverageScale <= 0.001
        && blackedOut.mazeBulbAverageScale <= 0.001
        && blackedOut.mazeLitBulbCount === 0
        && blackedOut.mazeBulbGroups.every((group) => group.outputFactor === 0 && group.emissiveIntensity === 0 && group.color === "74787c"),
      `the lock flicker must settle with both the real lights and visible amber bulbs fully out: ${JSON.stringify(blackedOut)}`,
    );
    await page.waitForTimeout(140);
    const offLighting = JSON.parse(await page.evaluate(() => window.render_game_to_text())).lighting;
    await captureStage(page, "maze-fixtures-fully-off-desktop.png");
    const visibleFlicker = await page.evaluate(() => {
      for (let index = 0; index < 240; index += 1) {
        const state = window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(0.01);
        if (state.mazeLightMaximumScale >= 0.55 && state.mazeBulbMaximumScale >= 0.55) return state;
      }
      return window.MrFeastFresh.getHedgeMazeKeyScareState();
    });
    assert(
      visibleFlicker.mazeLightMaximumScale >= 0.55
        && visibleFlicker.mazeBulbMaximumScale >= 0.55
        && visibleFlicker.mazeLitBulbCount === visibleFlicker.mazeDarkenedBulbCount,
      `QA must reach a visible sustained flicker frame for both fixture energy and bulb surfaces: ${JSON.stringify(visibleFlicker)}`,
    );
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
        samples.push({
          scale: state.mazeLightMaximumScale,
          lit: state.mazeLitLightCount,
          bulbScale: state.mazeBulbMaximumScale,
          litBulbs: state.mazeLitBulbCount,
        });
      }
      return {
        maximumScale: Math.max(...samples.map((sample) => sample.scale)),
        minimumScale: Math.min(...samples.map((sample) => sample.scale)),
        maximumBulbScale: Math.max(...samples.map((sample) => sample.bulbScale)),
        minimumBulbScale: Math.min(...samples.map((sample) => sample.bulbScale)),
        litSamples: samples.filter((sample) => sample.lit > 0).length,
        darkSamples: samples.filter((sample) => sample.lit === 0).length,
        maximumLitLights: Math.max(...samples.map((sample) => sample.lit)),
        litBulbSamples: samples.filter((sample) => sample.litBulbs > 0).length,
        darkBulbSamples: samples.filter((sample) => sample.litBulbs === 0).length,
        maximumLitBulbs: Math.max(...samples.map((sample) => sample.litBulbs)),
      };
    });
    assert(
      flickerProbe.maximumScale >= 0.55 && flickerProbe.minimumScale === 0
        && flickerProbe.maximumBulbScale >= 0.55 && flickerProbe.minimumBulbScale === 0
        && flickerProbe.litSamples >= 10 && flickerProbe.darkSamples >= 40
        && flickerProbe.maximumLitLights === blackedOut.mazeDarkenedLightCount
        && flickerProbe.litBulbSamples >= 10 && flickerProbe.darkBulbSamples >= 40
        && flickerProbe.maximumLitBulbs === blackedOut.mazeDarkenedBulbCount,
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
    const shallowPlacement = await page.evaluate(() => window.MrFeastFresh.placePlayerInsideHedgeMazeForQA("north", 7));
    const shallowPulse = await page.evaluate(() => window.MrFeastFresh.triggerHedgeMazeAmbientForQA());
    assert(shallowPulse.triggered && shallowPulse.ambientSpotCount >= 5, `QA should start a full shallow recurring pulse: ${JSON.stringify(shallowPulse)}`);
    assert(
      shallowPulse.ambientAheadMinimumMeters >= 1.35
        && shallowPulse.ambientAheadMaximumMeters <= 4.8
        && shallowPulse.ambientFacingMinimumDot > 0,
      `recurring hedge movement should stage a few feet ahead instead of beside the player: ${JSON.stringify(shallowPulse)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(3));
    const shallowAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(
      shallowAudio.hedgeMaze.lastFeastFatherDepthCells === shallowPlacement.playerMazeDepthCells
        && shallowAudio.hedgeMaze.lastFeastFatherDepthPressure <= 0.02,
      `the first breathing fragments should use the shallow maze mix: ${JSON.stringify({ shallowPlacement, audio: shallowAudio.hedgeMaze })}`,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(2.2));

    const deepPlacement = await page.evaluate(() => window.MrFeastFresh.placePlayerInsideHedgeMazeForQA("north", 38));
    const deepPulse = await page.evaluate(() => window.MrFeastFresh.triggerHedgeMazeAmbientForQA());
    assert(deepPulse.triggered && deepPlacement.playerMazeDepthCells > shallowPlacement.playerMazeDepthCells, `QA should stage a genuinely deeper pulse: ${JSON.stringify({ shallowPlacement, deepPlacement, deepPulse })}`);
    assert(
      deepPulse.ambientAheadMinimumMeters >= 1.35
        && deepPulse.ambientAheadMaximumMeters <= 4.8
        && deepPulse.ambientFacingMinimumDot > 0,
      `deep recurring movement should remain ahead of the player: ${JSON.stringify(deepPulse)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(3));
    const deepAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(
      deepAudio.hedgeMaze.lastFeastFatherDepthCells === deepPlacement.playerMazeDepthCells
        && deepAudio.hedgeMaze.lastFeastFatherDepthPressure > shallowAudio.hedgeMaze.lastFeastFatherDepthPressure
        && deepAudio.hedgeMaze.lastFeastFatherVolume >= shallowAudio.hedgeMaze.lastFeastFatherVolume + 0.04,
      `Feast Father breathing must grow louder with maze depth: ${JSON.stringify({ shallow: shallowAudio.hedgeMaze, deep: deepAudio.hedgeMaze })}`,
    );
    await captureStage(page, "maze-forward-hedge-movement-desktop.png");
    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(2.2));

    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(28));
    const haunted = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(haunted.ambientPulseCount >= 3, `the player should get several scares before finding the key: ${JSON.stringify(haunted)}`);
    assert(haunted.flickerCount >= 5 && haunted.mazeLightAverageScale <= 0.12, `the blacked-out fixtures should continue sparse flickering: ${JSON.stringify(haunted)}`);
    assert(haunted.ambientSpotCount >= 5, `each ambient pulse should pressure at least five nearby hedge faces: ${JSON.stringify(haunted)}`);
    assert(haunted.flashlightOn && haunted.entrancesSealed, `the flashlight and seals must survive recurring scares: ${JSON.stringify(haunted)}`);
    mazeAudio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert((mazeAudio.cueCounts.hedgeMazeFeastFather || 0) >= 6, `each recurring hedge movement should carry two Feast Father voice fragments: ${JSON.stringify(mazeAudio.cueCounts)}`);
    assert(
      mazeAudio.hedgeMaze.feastFatherPlayCount >= 8
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
    const keyChamber = await page.evaluate(() => window.MrFeastFresh.placePlayerInsideHedgeMazeForQA("north", 38));
    assert(keyChamber.playerMazeDepthCells >= 7, `post-competition key QA must return to the real maze route: ${JSON.stringify(keyChamber)}`);
    await page.evaluate(() => window.MrFeastFresh.setHedgeMazeFlashlightForQA(true));
    const keyCall = await page.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("key"));
    assert(keyCall?.phase === "called", `the real B-13 clue transition should call Storm Run: ${JSON.stringify(keyCall)}`);
    const released = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(released.active && released.sequence === "release" && released.keyOwned, `the real key-owned release scare should begin: ${JSON.stringify(released)}`);
    assert(!released.entrancesSealed && released.enabledSealColliders === 0, `finding the key must immediately reopen both entrances: ${JSON.stringify(released)}`);
    assert(
      !released.mazeDarknessActive
        && released.flashlightOn
        && released.mazeBulbAverageScale === 1
        && released.mazeLitBulbCount >= 17
        && released.mazeBulbGroups.every((group) => group.outputFactor === 1 && group.emissiveIntensity === 1),
      `key recovery should restore both fixture energy and visible bulbs without touching the flashlight: ${JSON.stringify(released)}`,
    );
    assert(released.environmentRestoredAfterKey, `key recovery must release the special maze lighting and rain context immediately: ${JSON.stringify(released)}`);
    await page.waitForFunction(
      () => {
        const rain = window.MrFeastFresh?.getAudioStateForQA?.()?.rain;
        return rain && !rain.visualSuppressed && rain.visualOpacity >= 0.22;
      },
      null,
      { timeout: 12000 },
    );
    const restoredEnvironment = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
    assert(
      !restoredEnvironment.lighting.mazeLightingContext
        && restoredEnvironment.lighting.hemisphereTarget === 0.34
        && restoredEnvironment.lighting.moonTarget === 0.52,
      `post-key maze lighting must return to the normal grounds targets: ${JSON.stringify(restoredEnvironment.lighting)}`,
    );
    assert(
      !restoredEnvironment.audio.rain.mazeSilenced
        && !restoredEnvironment.audio.rain.visualSuppressed
        && restoredEnvironment.audio.rain.visualOpacity >= 0.22
        && restoredEnvironment.audio.rain.targetGain >= 0.4,
      `post-key visual and audible rain must return to normal while still inside the maze: ${JSON.stringify(restoredEnvironment.audio.rain)}`,
    );
    await captureStage(page, "maze-key-environment-restored-desktop.png");
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
    console.log("Mr. Feast hedge-maze haunt acceptance passed: eased maze rain silence, visible blocked-entrance realization sting timing, unmistakable multi-pulse fixture flicker, depth-ramped Feast Father breathing, five-face movement a few feet ahead, persistent entrance seals, post-key Storm Run flashlight continuity, save/load restoration, and longer key release verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
