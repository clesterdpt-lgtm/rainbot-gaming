import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const port = Number(process.env.MR_FEAST_SHARED_LIGHT_TEST_PORT || (48000 + (process.pid % 15000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-shared-light-circuits");

const SHARED_CIRCUITS = Object.freeze([
  Object.freeze({
    name: "wine cellar and laundry lights",
    firstSwitch: "wineCellarSwitch",
    secondSwitch: "laundrySwitch",
    firstRoom: "wine",
    secondRoom: "laundry",
    roles: Object.freeze(["wine-cellar", "laundry"]),
    fixtureCount: 6,
  }),
  Object.freeze({
    name: "archive and pantry lights",
    firstSwitch: "archiveSwitch",
    secondSwitch: "pantrySwitch",
    firstRoom: "archive",
    secondRoom: "pantry",
    roles: Object.freeze(["archive", "archive-landing", "pantry"]),
    fixtureCount: 4,
  }),
]);

const OPEN_VOLUME_CIRCUIT = Object.freeze({
  name: "foyer and staircase lights",
  switches: Object.freeze([
    "foyerMainSwitch",
    "foyerBalconySwitch",
    "grandStairSwitch",
    "upperLandingSharedSwitch",
  ]),
  roles: Object.freeze(["foyer", "grand-stair", "upper-landing"]),
  loungeName: "rear lounge lights",
  loungeSwitch: "rearLoungeSwitch",
});

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

async function circuitState(page, name) {
  return (await diagnostics(page)).circuits.find((circuit) => circuit.name === name) || null;
}

async function stageSwitch(page, destination, circuitName, action) {
  const state = await page.evaluate((view) => window.MrFeastFresh.teleport(view), destination);
  assert(!state?.error, `could not stage ${destination}: ${JSON.stringify(state)}`);
  await page.waitForFunction(
    ({ name, verb }) => {
      const current = JSON.parse(window.render_game_to_text());
      return current.prompt?.toLowerCase() === `${verb} ${name}`;
    },
    { name: circuitName, verb: action },
    { timeout: 5000 },
  );
  const prompt = (await diagnostics(page)).prompt;
  assert(prompt?.toLowerCase() === `${action} ${circuitName}`, `${destination} must target the complete shared circuit; prompt=${prompt}`);
}

async function screenshotStage(page, fileName) {
  const clip = await page.locator("#mansion-stage").boundingBox();
  assert(clip?.width > 0 && clip?.height > 0, `cannot capture ${fileName}: mansion stage has no bounds`);
  await page.screenshot({
    path: path.join(artifactDir, fileName),
    clip,
    animations: "disabled",
  });
}

async function run() {
  const runtime = await readFile(runtimePath, "utf8");

  // Red-first source contract: continuous basement rooms share one named
  // circuit, both physical switches are attached to it, and the fixed shader
  // budget preserves a representative fixture from each half.
  assert(/const SHARED_ROOM_LIGHTING = Object\.freeze/.test(runtime), "missing named shared-room lighting table");
  assert(/"WINE CELLAR": \[SHARED_ROOM_LIGHTING\.westBasement\.circuit\]/.test(runtime), "Wine Cellar is not mapped to the west shared circuit");
  assert(/"LAUNDRY & LINEN": \[SHARED_ROOM_LIGHTING\.westBasement\.circuit\]/.test(runtime), "Laundry is not mapped to the west shared circuit");
  assert(/"ARCHIVE": \[SHARED_ROOM_LIGHTING\.eastBasement\.circuit\]/.test(runtime), "Archive is not mapped to the east shared circuit");
  assert(/"PANTRY": \[SHARED_ROOM_LIGHTING\.eastBasement\.circuit\]/.test(runtime), "Pantry is not mapped to the east shared circuit");
  assert(/sharedRoomRole/.test(runtime) && /SHARED_ROOM_LIGHTING[\s\S]*?fixtureRoles/.test(runtime), "shared circuit fixtures need named room roles");
  assert(
    /fixtureRoles:\s*Object\.freeze\(\["archive",\s*"archive-landing",\s*"pantry"\]\)/.test(runtime)
      && /role:\s*"archive-landing",\s*x:\s*11\.3,\s*z:\s*7\.4,\s*intensityScale:\s*1\.25/.test(runtime),
    "Archive landing needs a fixed-budget, modestly boosted emitter at the bottom of the service stairs",
  );
  assert(
    /fixtureConfig\.intensityScale[\s\S]*?fixture\.userData\.baseIntensity\s*\*=/.test(runtime),
    "shared-room fixture tuning does not apply the authored Archive landing intensity boost",
  );
  assert(/for \(const sharedLighting of Object\.values\(SHARED_ROOM_LIGHTING\)\)/.test(runtime), "fixed light selection does not preserve both halves of shared circuits");
  assert(!/new LightCircuit\("(?:wine cellar|laundry|archive|pantry store) lights"/.test(runtime), "legacy independent basement circuits remain");
  for (const destination of SHARED_CIRCUITS.flatMap((circuit) => [circuit.firstSwitch, circuit.secondSwitch])) {
    assert(runtime.includes(`${destination}:`), `missing physical switch QA staging destination ${destination}`);
  }
  assert(/const OPEN_VOLUME_SHARED_LIGHTING = Object\.freeze/.test(runtime), "missing named foyer/stair shared-lighting contract");
  for (const room of ["FRONT FOYER", "GRAND STAIR HALL", "FOYER BALCONY", "UPPER LANDING"]) {
    assert(
      runtime.includes(`"${room}": [OPEN_VOLUME_SHARED_LIGHTING.circuit]`),
      `${room} is not mapped to the shared foyer/stair circuit`,
    );
  }
  assert(/"REAR LOUNGE": \["rear lounge lights"\]/.test(runtime), "rear lounge must remain a separate circuit");
  assert(
    /const OPEN_VOLUME_BUDGET_CIRCUITS = Object\.freeze\(\[\s*OPEN_VOLUME_SHARED_LIGHTING\.circuit,\s*\]\)/.test(runtime),
    "open-volume shader budgeting does not target the merged foyer/stair circuit",
  );
  assert(
    /for \(const role of OPEN_VOLUME_SHARED_LIGHTING\.fixtureRoles\)/.test(runtime),
    "fixed light selection does not preserve foyer, stair, and upper-landing coverage",
  );
  assert(
    !/new LightCircuit\("(?:foyer chandelier|grand stair lights|upper landing lights)"/.test(runtime),
    "legacy independent foyer/stair circuits remain",
  );
  for (const destination of [...OPEN_VOLUME_CIRCUIT.switches, OPEN_VOLUME_CIRCUIT.loungeSwitch]) {
    assert(runtime.includes(`${destination}:`), `missing open-volume switch QA staging destination ${destination}`);
  }

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
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.waitForTimeout(800);

    const initial = await diagnostics(page);
    assert(initial.lighting.shaderSpotBudget === 6 && initial.lighting.shaderPointBudget === 11, `shared circuits must preserve the fixed 6/11 shader-light budget: ${JSON.stringify(initial.lighting)}`);
    const circuitNames = initial.circuits.map((circuit) => circuit.name);
    for (const legacyName of ["wine cellar lights", "laundry lights", "archive lights", "pantry store lights"]) {
      assert(!circuitNames.includes(legacyName), `legacy circuit ${legacyName} still exists at runtime`);
    }

    for (const shared of SHARED_CIRCUITS) {
      let circuit = await circuitState(page, shared.name);
      assert(circuit?.on && circuit.controls === 2, `${shared.name} should begin on with two physical switches: ${JSON.stringify(circuit)}`);
      assert(circuit.lights === shared.fixtureCount, `${shared.name} should preserve all ${shared.fixtureCount} visible fixture emitters: ${JSON.stringify(circuit)}`);
      assert(
        shared.roles.every((role) => circuit.sharedRoomRoles?.includes(role)),
        `${shared.name} must expose both room roles: ${JSON.stringify(circuit)}`,
      );
      const other = SHARED_CIRCUITS.find((candidate) => candidate.name !== shared.name);
      const otherBefore = await circuitState(page, other.name);

      await stageSwitch(page, shared.firstSwitch, shared.name, "turn off");
      await page.keyboard.press("e");
      await page.waitForFunction(
        (name) => JSON.parse(window.render_game_to_text()).circuits.find((entry) => entry.name === name)?.on === false,
        shared.name,
      );
      await page.evaluate(() => window.MrFeastFresh.advanceLightFade(4));
      circuit = await circuitState(page, shared.name);
      assert(!circuit.on && circuit.activeLights === 0 && circuit.activeLightPools === 0, `first switch must darken the complete ${shared.name}: ${JSON.stringify(circuit)}`);
      assert((await circuitState(page, other.name)).on === otherBefore.on, `${shared.name} must not alter ${other.name}`);
      await page.evaluate((view) => window.MrFeastFresh.teleport(view), shared.secondRoom);
      await screenshotStage(page, `${shared.secondRoom}-dark-from-${shared.firstSwitch}.png`);

      await stageSwitch(page, shared.secondSwitch, shared.name, "turn on");
      await page.keyboard.press("e");
      await page.waitForFunction(
        (name) => JSON.parse(window.render_game_to_text()).circuits.find((entry) => entry.name === name)?.on === true,
        shared.name,
      );
      await page.evaluate(() => window.MrFeastFresh.advanceLightFade(4));
      circuit = await circuitState(page, shared.name);
      assert(circuit.on && circuit.activeLights >= 2, `second switch must relight both halves of ${shared.name}: ${JSON.stringify(circuit)}`);
      assert(
        shared.roles.every((role) => circuit.activeSharedRoomRoles?.includes(role)),
        `fixed light selection must visibly represent both halves of ${shared.name}: ${JSON.stringify(circuit)}`,
      );
      await page.evaluate((view) => window.MrFeastFresh.teleport(view), shared.firstRoom);
      await screenshotStage(page, `${shared.firstRoom}-lit-from-${shared.secondSwitch}.png`);
    }

    let openVolume = await circuitState(page, OPEN_VOLUME_CIRCUIT.name);
    let lounge = await circuitState(page, OPEN_VOLUME_CIRCUIT.loungeName);
    assert(openVolume?.on && openVolume.controls === 4, `foyer/stair circuit should begin on with four physical switches: ${JSON.stringify(openVolume)}`);
    assert(lounge?.on, `rear lounge should begin on independently: ${JSON.stringify(lounge)}`);
    assert(
      OPEN_VOLUME_CIRCUIT.roles.every((role) => openVolume.sharedRoomRoles?.includes(role)),
      `foyer/stair circuit must expose all open-volume fixture roles: ${JSON.stringify(openVolume)}`,
    );

    await stageSwitch(page, OPEN_VOLUME_CIRCUIT.switches[0], OPEN_VOLUME_CIRCUIT.name, "turn off");
    await page.keyboard.press("e");
    await page.waitForFunction(
      (name) => JSON.parse(window.render_game_to_text()).circuits.find((entry) => entry.name === name)?.on === false,
      OPEN_VOLUME_CIRCUIT.name,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceLightFade(4));
    openVolume = await circuitState(page, OPEN_VOLUME_CIRCUIT.name);
    lounge = await circuitState(page, OPEN_VOLUME_CIRCUIT.loungeName);
    assert(!openVolume.on && openVolume.activeLights === 0 && openVolume.activeLightPools === 0, `foyer switch must darken the complete open volume: ${JSON.stringify(openVolume)}`);
    assert(lounge.on, `foyer/stair circuit must not alter the rear lounge: ${JSON.stringify(lounge)}`);
    await page.evaluate(() => window.MrFeastFresh.teleport("upper"));
    await screenshotStage(page, "upper-landing-dark-from-foyerMainSwitch.png");

    await stageSwitch(page, OPEN_VOLUME_CIRCUIT.switches[3], OPEN_VOLUME_CIRCUIT.name, "turn on");
    await page.keyboard.press("e");
    await page.waitForFunction(
      (name) => JSON.parse(window.render_game_to_text()).circuits.find((entry) => entry.name === name)?.on === true,
      OPEN_VOLUME_CIRCUIT.name,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceLightFade(4));
    openVolume = await circuitState(page, OPEN_VOLUME_CIRCUIT.name);
    assert(
      OPEN_VOLUME_CIRCUIT.roles.every((role) => openVolume.activeSharedRoomRoles?.includes(role)),
      `fixed light selection must visibly represent foyer, stair, and upper landing: ${JSON.stringify(openVolume)}`,
    );
    for (const destination of OPEN_VOLUME_CIRCUIT.switches.slice(1, 3)) {
      await stageSwitch(page, destination, OPEN_VOLUME_CIRCUIT.name, "turn off");
    }
    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    await screenshotStage(page, "foyer-lit-from-upperLandingSharedSwitch.png");

    await stageSwitch(page, OPEN_VOLUME_CIRCUIT.loungeSwitch, OPEN_VOLUME_CIRCUIT.loungeName, "turn off");
    await page.keyboard.press("e");
    await page.waitForFunction(
      (name) => JSON.parse(window.render_game_to_text()).circuits.find((entry) => entry.name === name)?.on === false,
      OPEN_VOLUME_CIRCUIT.loungeName,
    );
    lounge = await circuitState(page, OPEN_VOLUME_CIRCUIT.loungeName);
    openVolume = await circuitState(page, OPEN_VOLUME_CIRCUIT.name);
    assert(!lounge.on && openVolume.on, `rear lounge switch must stay independent of the foyer/stair circuit: ${JSON.stringify({ lounge, openVolume })}`);
    await screenshotStage(page, "rear-lounge-dark-foyer-stair-lit.png");

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    await context.close();
    console.log("Mr. Feast shared light circuit test: basement wings and the four-switch foyer/stair volume toggle together with fixed-budget coverage, while the rear lounge stays independent");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
