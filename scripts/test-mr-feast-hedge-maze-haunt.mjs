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
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
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
  assert(/class HedgeMazeKeyScareSystem/.test(runtime), "missing focused hedge-maze haunt authority");
  const hauntClass = sourceSection(runtime, "class HedgeMazeKeyScareSystem", "class ContestantThirteenQuest");
  assert(/addKinematicBox/.test(hauntClass), "the two entrance seals need fixed-topology kinematic colliders");
  assert(!/addFixedBox|PointLight|SpotLight|DirectionalLight|HemisphereLight/.test(hauntClass), "the haunt must not alter static maze topology or add shader lights");
  assert(!/flashlightSystem\?\.setOn\(false/.test(hauntClass), "the maze haunt must never switch off the player's flashlight");
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
    await page.waitForTimeout(400);

    await page.evaluate(() => window.MrFeastFresh.prepareHedgeMazeLockInForQA({ questReady: false }));
    const early = await page.evaluate(() => window.MrFeastFresh.placePlayerInsideHedgeMazeForQA("north", 4));
    assert(!early.lockInTriggered && !early.entrancesSealed, `early exploration must not strand the player: ${JSON.stringify(early)}`);

    const staged = await page.evaluate(() => window.MrFeastFresh.prepareHedgeMazeLockInForQA({ questReady: true, flashlightOn: true }));
    assert(staged.flashlightOn, `QA should stage the real carried flashlight switched on: ${JSON.stringify(staged)}`);
    const colliderCount = JSON.parse(await page.evaluate(() => window.render_game_to_text())).physics.colliders;
    const locked = await page.evaluate(() => window.MrFeastFresh.placePlayerInsideHedgeMazeForQA("north", 4));
    assert(locked.lockInTriggered && locked.entrancesSealed, `quest-ready inward travel should seal the maze: ${JSON.stringify(locked)}`);
    assert(locked.sealedEntranceCount === 2 && locked.enabledSealColliders === 2, `both portals must be visibly and physically sealed: ${JSON.stringify(locked)}`);
    assert(locked.colliderCountNow === colliderCount, `sealing must toggle boot-time colliders without changing topology: ${JSON.stringify(locked)}`);
    assert(locked.mazeDarknessActive && locked.mazeLightAverageScale <= 0.12, `maze fixtures should stay mostly off: ${JSON.stringify(locked)}`);
    assert(locked.flashlightOn, `the carried flashlight must remain usable while the maze is sealed: ${JSON.stringify(locked)}`);
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
    assert(haunted.flickerCount >= 5 && haunted.mazeLightAverageScale <= 0.12, `the mostly-dark fixtures should continue flickering: ${JSON.stringify(haunted)}`);
    assert(haunted.flashlightOn && haunted.entrancesSealed, `the flashlight and seals must survive recurring scares: ${JSON.stringify(haunted)}`);
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

    await page.evaluate(() => window.MrFeastFresh.setHedgeMazeFlashlightForQA(true));
    const released = await page.evaluate(() => window.MrFeastFresh.collectHedgeMazeKeyForQA());
    assert(released.triggered && released.keyOwned, `the real key-owned release scare should begin: ${JSON.stringify(released)}`);
    assert(!released.entrancesSealed && released.enabledSealColliders === 0, `finding the key must immediately reopen both entrances: ${JSON.stringify(released)}`);
    assert(!released.mazeDarknessActive && released.flashlightOn, `key recovery should restore fixtures without touching the flashlight: ${JSON.stringify(released)}`);
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
    console.log("Mr. Feast hedge-maze haunt acceptance passed: safe quest-gated lock-in, two persistent entrance seals, recurring pre-key scares, mostly-dark flickering fixtures, flashlight continuity, save/load restoration, and longer key release verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
