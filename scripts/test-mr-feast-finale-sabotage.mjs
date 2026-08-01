import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const milestonePath = path.join(root, "docs", "milestones", "74-finale-boiler-gate-sabotage.md");
const port = Number(process.env.MR_FEAST_FINALE_SABOTAGE_TEST_PORT || (62000 + (process.pid % 3000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-finale-sabotage");

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

async function sourceContract() {
  const [runtime, milestone] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(milestonePath, "utf8"),
  ]);
  for (const token of [
    "class FinaleSabotageSystem",
    'crowbarItemId: "finale-crowbar"',
    'crankItemId: "finale-boiler-crank"',
    'name: "wine cabinet"',
    'name: "workroom tool cabinet"',
    "boiler-main-power-cutoff",
    "pry-front-gate",
  ]) assert(runtime.includes(token), `missing finale sabotage source contract: ${token}`);
  for (const text of [
    "Locked. I guess we're stuck here.",
    "The gate is locked. Cut off the power source.",
    "The power is cut, but the gate is jammed. Find something to pry it open.",
  ]) {
    assert(runtime.includes(text), `missing conditional gate text: ${text}`);
    assert(milestone.includes(text), `milestone omits conditional gate text: ${text}`);
  }
  for (const hook of [
    "getFinaleSabotageState",
    "placePlayerAtFinaleItemForQA",
    "collectFinaleItemForQA",
    "placePlayerAtBoilerCutoffForQA",
    "interactBoilerCutoffForQA",
    "placePlayerAtFinaleGateForQA",
    "interactFinaleGateForQA",
  ]) assert(runtime.includes(hook), `missing finale sabotage QA hook: ${hook}`);
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text())) {
        errors.push(message.text());
      }
    });
    await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 180000 });
    await page.waitForFunction(
      () => ["ready", "error"].includes(window.MrFeastFresh.getMrFeastState?.()?.loadStatus),
      null,
      { timeout: 180000 },
    );

    let route = await page.evaluate(() => window.MrFeastFresh.getFinaleSabotageState());
    assert(!route.chaseActive, `route must be dormant before the Feast Father: ${JSON.stringify(route)}`);
    assert(route.gateLabel === "Locked. I guess we're stuck here.", `pre-chase gate leaked a finale clue: ${JSON.stringify(route)}`);
    assert(!route.boilerInteractionActive, `Boiler cutoff must be inert before the chase: ${JSON.stringify(route)}`);
    await page.evaluate(() => window.MrFeastFresh.placePlayerAtFinaleGateForQA());
    await page.evaluate(() => window.MrFeastFresh.interactFinaleGateForQA());
    const preChaseGateText = await page.locator("#mansion-discovery-body").textContent();
    assert(preChaseGateText === "Locked. I guess we're stuck here.", `pre-chase gate interaction leaked a later solution: ${preChaseGateText}`);

    const crowbarPlacement = await page.evaluate(() => (
      window.MrFeastFresh.placePlayerAtFinaleItemForQA("finale-crowbar")
    ));
    route = await page.evaluate(() => window.MrFeastFresh.getFinaleSabotageState());
    assert(route.items.crowbar.visible && route.items.crowbar.cabinetOpen, `Wine Cellar crowbar must appear inside its open cabinet: ${JSON.stringify({ crowbarPlacement, route })}`);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "wine-cellar-crowbar.png") });

    const crankPlacement = await page.evaluate(() => (
      window.MrFeastFresh.placePlayerAtFinaleItemForQA("finale-boiler-crank")
    ));
    route = await page.evaluate(() => window.MrFeastFresh.getFinaleSabotageState());
    assert(route.items.crank.visible && route.items.crank.cabinetOpen, `Workroom crank must appear inside its open cabinet: ${JSON.stringify({ crankPlacement, route })}`);

    const called = await page.evaluate(() => window.MrFeastFresh.callVictoryFeastForQA("finale-sabotage-test"));
    assert(called.started, `Victory Feast call failed: ${JSON.stringify(called)}`);
    await page.evaluate(() => window.MrFeastFresh.awaitVictoryFeastAssetsForQA());
    await page.waitForFunction(
      () => window.MrFeastFresh.getVictoryFeastState?.()?.saint?.loadStatus === "ready",
      null,
      { timeout: 180000 },
    );
    const started = await page.evaluate(() => window.MrFeastFresh.startVictoryFeastForQA());
    assert(started.started, `Victory Feast dialogue failed to start: ${JSON.stringify(started)}`);
    await page.evaluate(() => window.MrFeastFresh.skipVictoryFeastDialogueForQA());
    const revealed = await page.evaluate(() => window.MrFeastFresh.revealVictoryFeastSaintForQA());
    assert(revealed.triggered, `Feast Father reveal failed: ${JSON.stringify(revealed)}`);
    const escaped = await page.evaluate(() => window.MrFeastFresh.startVictoryFeastEscapeForQA());
    assert(escaped.started, `Feast Father chase failed to start: ${JSON.stringify(escaped)}`);

    route = await page.evaluate(() => window.MrFeastFresh.getFinaleSabotageState());
    assert(route.chaseActive && route.boilerInteractionActive, `cutoff must activate only with the chase: ${JSON.stringify(route)}`);
    assert(route.gateLabel === "The gate is locked. Cut off the power source.", `powered chase gate must direct the player to power: ${JSON.stringify(route)}`);

    let boilerPlacement = await page.evaluate(() => window.MrFeastFresh.placePlayerAtBoilerCutoffForQA());
    assert(/empty.*socket/i.test(boilerPlacement?.prompt || ""), `missing crank needs a readable empty-socket prompt: ${JSON.stringify(boilerPlacement)}`);
    const missingCrankAccepted = await page.evaluate(() => window.MrFeastFresh.interactBoilerCutoffForQA());
    const missingCrankText = await page.locator("#mansion-discovery-body").textContent();
    assert(!missingCrankAccepted && /empty crank socket.*find the crank/i.test(missingCrankText || ""), `missing-crank interaction must supply its chase clue: ${missingCrankText}`);
    await page.evaluate(() => window.MrFeastFresh.collectFinaleItemForQA("finale-boiler-crank"));
    route = await page.evaluate(() => window.MrFeastFresh.getFinaleSabotageState());
    assert(route.items.crank.owned && !route.items.crank.visible, `Collected crank must enter the Bag and leave the cabinet: ${JSON.stringify(route)}`);
    boilerPlacement = await page.evaluate(() => window.MrFeastFresh.placePlayerAtBoilerCutoffForQA());
    assert(/crank|cut power/i.test(boilerPlacement?.prompt || ""), `Boiler cutoff needs a readable crank prompt: ${JSON.stringify(boilerPlacement)}`);
    const cutoffStarted = await page.evaluate(() => window.MrFeastFresh.interactBoilerCutoffForQA());
    assert(cutoffStarted, "Boiler cutoff timed interaction did not start");
    await delay(1750);
    route = await page.evaluate(() => window.MrFeastFresh.getFinaleSabotageState());
    let feast = await page.evaluate(() => window.MrFeastFresh.getVictoryFeastState());
    const game = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert(route.powerCut && route.items.crank.installed, `crank must cut power and remain visibly installed: ${JSON.stringify(route)}`);
    assert(route.gateColliderEnabled && !route.gateOpened, `power cut must leave the jammed gate physically blocked: ${JSON.stringify(route)}`);
    assert(route.gateLabel === "The power is cut, but the gate is jammed. Find something to pry it open.", `unpowered gate must hint for a pry tool: ${JSON.stringify(route)}`);
    assert(feast.blackout.allInteriorOff && !feast.cameras.operational, `house power cut must kill lights and cameras: ${JSON.stringify({ blackout: feast.blackout, cameras: feast.cameras })}`);
    assert(game.yard?.lighting?.on === false, `exterior circuit must lose power too: ${JSON.stringify(game.yard?.lighting)}`);
    await page.evaluate(() => window.MrFeastFresh.placePlayerAtFinaleGateForQA());
    await page.evaluate(() => window.MrFeastFresh.interactFinaleGateForQA());
    const missingCrowbarText = await page.locator("#mansion-discovery-body").textContent();
    assert(missingCrowbarText === "The power is cut, but the gate is jammed. Find something to pry it open.", `unpowered gate interaction must supply the pry-tool clue: ${missingCrowbarText}`);

    await page.evaluate(() => window.MrFeastFresh.collectFinaleItemForQA("finale-crowbar"));
    route = await page.evaluate(() => window.MrFeastFresh.getFinaleSabotageState());
    assert(route.gateLabel === "Pry the jammed gate open with the crowbar", `crowbar ownership must unlock the pry action: ${JSON.stringify(route)}`);
    const gatePlacement = await page.evaluate(() => window.MrFeastFresh.placePlayerAtFinaleGateForQA());
    assert(/pry.*crowbar/i.test(gatePlacement?.prompt || ""), `gate needs a readable crowbar prompt: ${JSON.stringify(gatePlacement)}`);
    const pryStarted = await page.evaluate(() => window.MrFeastFresh.interactFinaleGateForQA());
    assert(pryStarted, "Gate pry timed interaction did not start");
    await delay(2350);
    await page.evaluate(() => window.MrFeastFresh.advanceFinaleSabotageForQA(0.7));
    route = await page.evaluate(() => window.MrFeastFresh.getFinaleSabotageState());
    feast = await page.evaluate(() => window.MrFeastFresh.getVictoryFeastState());
    assert(route.gateOpened && !route.gateColliderEnabled && route.gateOpenProgress === 1, `gate leaves and collision must open together: ${JSON.stringify(route)}`);
    assert(feast.escape.completed && feast.outcome === "escaped" && !route.chaseActive, `prying the gate must complete and stop the chase: ${JSON.stringify({ feast, route })}`);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "front-gate-pried-open.png") });

    assert(errors.length === 0, `browser emitted errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast finale sabotage browser regression passed.");
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
  }
}

async function run() {
  await sourceContract();
  await runBrowserFlow();
}

run().catch((error) => {
  console.error(`Mr. Feast finale sabotage regression failed: ${error.message}`);
  process.exitCode = 1;
});
