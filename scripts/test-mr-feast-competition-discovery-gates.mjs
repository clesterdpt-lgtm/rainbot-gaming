import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_GATE_TEST_PORT || (51500 + (process.pid % 12000)));
const baseUrl = `http://127.0.0.1:${port}`;

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

async function run() {
  const runtimeSource = await readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8");
  assert(!/intermissionSeconds\s*:/.test(runtimeSource), "Feast Says must not retain an elapsed-time trigger");
  assert(/clueId\s*!==\s*"hedge-maze-b13-cache"/.test(runtimeSource), "Storm Run must reject every clue except the B-13 key");
  assert(/clueId\s*!==\s*"patron-feed-sabotage"/.test(runtimeSource), "Feast Hunt must reject every clue except the severed patron feed");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
    });

    await page.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loadStatus === "ready", null, { timeout: 120000 });

    await page.evaluate(() => {
      window.MrFeastFresh.advanceFeastSaysForQA(900);
      window.MrFeastFresh.advanceFeastSaysForQA(900);
      window.MrFeastFresh.triggerFeastSaysClueForQA("book");
      window.MrFeastFresh.triggerFeastSaysClueForQA("shovel");
    });
    let feast = await page.evaluate(() => window.MrFeastFresh.getFeastSaysState());
    assert(feast.phase === "dormant" && feast.callCount === 0, `time and ordinary clues must not call Game 1; got ${JSON.stringify(feast)}`);
    assert(feast.callAfterSeconds === null && feast.secondsUntilCall === null, `Game 1 must expose no countdown trigger; got ${JSON.stringify(feast)}`);

    for (let index = 1; index <= 3; index += 1) {
      await page.evaluate((kind) => window.MrFeastFresh.triggerStormRunClueForQA(kind), `scratch-${index}`);
      feast = await page.evaluate(() => window.MrFeastFresh.getFeastSaysState());
      assert(feast.phase === "dormant" && feast.callCount === 0, `painting ${index} must not call Game 1 early; got ${JSON.stringify(feast)}`);
      assert(feast.triggerGate.paintingNumbersFound === index, `Game 1 should count painting ${index}; got ${JSON.stringify(feast.triggerGate)}`);
    }

    await page.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("scratch-4"));
    feast = await page.evaluate(() => window.MrFeastFresh.getFeastSaysState());
    assert(
      feast.phase === "called"
        && feast.callCount === 1
        && feast.triggerReason === "painting-code"
        && feast.triggerGate.paintingsComplete,
      `the fourth painting number must call Game 1 exactly once; got ${JSON.stringify(feast)}`,
    );

    const feastResult = await page.evaluate(() => window.MrFeastFresh.completeFeastSaysForQA(6));
    assert(feastResult?.survived === true, `Game 1 QA completion failed: ${JSON.stringify(feastResult)}`);

    const prematureStorm = await page.evaluate(() => window.MrFeastFresh.callStormRunForQA?.("gate"));
    if (prematureStorm) assert(prematureStorm.started === false, `painting completion must not call Game 2; got ${JSON.stringify(prematureStorm)}`);
    let storm = await page.evaluate(() => window.MrFeastFresh.getStormRunState());
    assert(storm.phase === "dormant" && storm.triggerGate.hedgeMazeKeyFound === false, `Game 2 must wait for the hedge key; got ${JSON.stringify(storm)}`);

    await page.evaluate(() => window.MrFeastFresh.triggerStormRunClueForQA("key"));
    storm = await page.evaluate(() => window.MrFeastFresh.getStormRunState());
    assert(
      storm.phase === "called"
        && storm.callCount === 1
        && storm.triggerReason === "hedge-maze-key"
        && storm.triggerClueId === "hedge-maze-b13-cache",
      `finding the hedge-maze key must call Game 2 exactly once; got ${JSON.stringify(storm)}`,
    );

    const stormResult = await page.evaluate(() => window.MrFeastFresh.completeStormRunForQA("player"));
    assert(stormResult?.survived === true, `Game 2 QA completion failed: ${JSON.stringify(stormResult)}`);

    const activeFeed = await page.evaluate(() => {
      window.MrFeastFresh.setFeastHuntGateForQA({ stormCompleted: true, relaySabotaged: false });
      return window.MrFeastFresh.callFeastHuntForQA("gate");
    });
    assert(activeFeed.started === false && activeFeed.reason === "patron-feed-active", `Game 3 must wait for the severed feed; got ${JSON.stringify(activeFeed)}`);

    const severedFeed = await page.evaluate(() => {
      window.MrFeastFresh.setFeastHuntGateForQA({ stormCompleted: true, relaySabotaged: true });
      return window.MrFeastFresh.callFeastHuntForQA("patron-feed-sabotage");
    });
    const hunt = await page.evaluate(() => window.MrFeastFresh.getFeastHuntState());
    assert(
      severedFeed.started === true
        && hunt.phase === "called"
        && hunt.callCount === 1
        && hunt.triggerReason === "patron-feed-sabotage",
      `severing the patron feed must call Game 3 exactly once; got call=${JSON.stringify(severedFeed)} state=${JSON.stringify(hunt)}`,
    );

    const rendered = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert(rendered.renderer.calls > 0 && rendered.renderer.triangles > 0, `the browser scene must remain rendered; got ${JSON.stringify(rendered.renderer)}`);
    assert(errors.length === 0, `console errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast competition discovery gate checks passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
