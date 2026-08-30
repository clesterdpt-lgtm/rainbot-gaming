import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_HEDGE_KEY_SCARE_TEST_PORT || (54000 + (process.pid % 10000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-hedge-maze-key-scare");

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

  // The key remains authoritative and is granted before the longer release
  // presentation can begin. Entrance seals are boot-time kinematic bodies;
  // the animated scare foliage itself remains non-colliding.
  assert(/const HEDGE_MAZE_HAUNT = Object\.freeze\(\{/.test(runtime), "missing named HEDGE_MAZE_HAUNT tuning table");
  assert(/const HEDGE_MAZE_KEY_SCARE = HEDGE_MAZE_HAUNT\.release/.test(runtime), "missing key-release tuning alias");
  assert(/class HedgeMazeKeyScareSystem/.test(runtime), "missing focused HedgeMazeKeyScareSystem");
  const scareClass = sourceSection(runtime, "class HedgeMazeKeyScareSystem", "class ContestantThirteenQuest");
  assert(!/addFixedBox|createCollider/.test(scareClass), "the hedge scare must not alter static maze collision geometry");
  assert(/addKinematicBox/.test(scareClass), "the maze haunt should own two fixed-topology entrance seals");
  assert(!/PointLight|SpotLight|DirectionalLight|HemisphereLight/.test(scareClass), "the hedge scare must not add a shader light");
  assert(/stormRunSystem\?\.isPlaying\(\)/.test(scareClass), "the scare must be guarded from the active Storm Run briefing/race");
  assert(/mazeKeyScareSeen/.test(runtime), "the one-shot scare needs a persisted story flag");
  assert(
    runtime.indexOf("this.story.basementKeyFound = true") < runtime.indexOf("hedgeMazeKeyScareSystem?.trigger()"),
    "the basement key must be owned before the scare is triggered",
  );
  assert(/getHedgeMazeKeyScareState/.test(runtime) && /advanceHedgeMazeKeyScareForQA/.test(runtime), "focused scare QA controls are missing");
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

    const staged = await page.evaluate(() => window.MrFeastFresh.prepareHedgeMazeKeyScareForQA());
    assert(staged?.position && staged.keyOwned, `QA should stage the real key chamber with the key owned: ${JSON.stringify(staged)}`);
    const colliderCount = JSON.parse(await page.evaluate(() => window.render_game_to_text())).physics.colliders;
    const started = await page.evaluate(() => window.MrFeastFresh.triggerHedgeMazeKeyScareForQA());
    assert(started?.triggered && started.keyOwnedAtTrigger, `the key-owned scare should start: ${JSON.stringify(started)}`);
    assert(started.colliderCountAtTrigger === colliderCount, `trigger should preserve the collider count: ${JSON.stringify(started)}`);

    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(2.8));
    let scare = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(scare.active && scare.phase === "surround", `the chamber should enter the surround phase: ${JSON.stringify(scare)}`);
    assert(scare.visibleBulges >= 2 && scare.visibleLeaves > 0, `hedges and loose leaves should move around the player: ${JSON.stringify(scare)}`);
    assert(scare.dimmedLightCount >= 1 && scare.rainDucked, `the storm bed and nearby maze lights should hush: ${JSON.stringify(scare)}`);
    assert(scare.fixedBoxCountDelta === 0, `the corridor must remain physically unchanged: ${JSON.stringify(scare)}`);
    assert(!scare.movementLocked, "the scare must not lock player movement");
    await captureStage(page, "hedge-key-surround-desktop.png");

    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(3.2));
    scare = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(scare.phase === "inhale", `the close-breath beat should be active: ${JSON.stringify(scare)}`);
    assert(scare.audioEvents.includes("inhale"), `the inhale must be an authored directional cue: ${JSON.stringify(scare.audioEvents)}`);
    await captureStage(page, "hedge-key-inhale-desktop.png");

    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(2));
    scare = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(scare.phase === "retreat" && scare.audioEvents.some((event) => event.startsWith("retreat")), `the disturbance should race toward the exit: ${JSON.stringify(scare)}`);

    await page.evaluate(() => window.MrFeastFresh.advanceHedgeMazeKeyScareForQA(4));
    scare = await page.evaluate(() => window.MrFeastFresh.getHedgeMazeKeyScareState());
    assert(!scare.active && scare.phase === "complete", `the presentation should cleanly finish: ${JSON.stringify(scare)}`);
    assert(!scare.rootVisible && scare.visibleBulges === 0 && scare.visibleLeaves === 0, `all temporary visuals must be removed: ${JSON.stringify(scare)}`);
    assert(scare.dimmedLightCount === 0 && !scare.rainDucked, `lighting and rain must restore after the scare: ${JSON.stringify(scare)}`);
    assert(scare.fixedBoxCountDelta === 0, "completion must preserve maze collision geometry");

    const saveRoundTrip = await page.evaluate(() => {
      const saved = window.MrFeastFresh.saveGameForQA();
      window.MrFeastFresh.resetHedgeMazeKeyScareForQA(true);
      const cleared = window.MrFeastFresh.getHedgeMazeKeyScareState();
      const loaded = window.MrFeastFresh.loadGameForQA();
      return {
        saved,
        loaded,
        clearedSeen: cleared.seen,
        restored: window.MrFeastFresh.getHedgeMazeKeyScareState(),
      };
    });
    assert(saveRoundTrip.saved && saveRoundTrip.loaded && !saveRoundTrip.clearedSeen, `the QA save round trip should execute: ${JSON.stringify(saveRoundTrip)}`);
    assert(saveRoundTrip.restored.seen && !saveRoundTrip.restored.active && !saveRoundTrip.restored.rootVisible, `save/load should retain one-shot completion without restoring transient effects: ${JSON.stringify(saveRoundTrip.restored)}`);

    const repeated = await page.evaluate(() => window.MrFeastFresh.triggerHedgeMazeKeyScareForQA());
    assert(!repeated.triggered && repeated.reason === "already-seen", `the scare should be one-shot: ${JSON.stringify(repeated)}`);
    const guarded = await page.evaluate(() => {
      window.MrFeastFresh.resetHedgeMazeKeyScareForQA(true);
      return window.MrFeastFresh.triggerHedgeMazeKeyScareForQA({ simulateStormRun: true });
    });
    assert(!guarded.triggered && guarded.reason === "storm-run-active", `Storm Run must suppress the maze-key scare: ${JSON.stringify(guarded)}`);

    await context.close();
    assert(errors.length === 0, `unexpected browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast hedge-maze key release acceptance passed: key-first trigger, one-shot persistence, longer non-colliding hedge movement, leaves, localized light/rain hush, directional inhale/retreat audio, Storm Run guard, cleanup, and clean browser console verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
