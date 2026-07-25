import { spawn } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_BANQUET_TEST_PORT || (59200 + (process.pid % 5000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-banquet-loss");
const closingLine = "Contestant Thirteen—you lost the million, but you still made the final cut. Our patrons call it sacrifice. The Guest calls it supper. I call it a feast.";

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

async function bootPage(browser, viewport, errors) {
  const page = await browser.newPage({ viewport });
  watchErrors(page, errors);
  await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 180000 });
  await page.waitForFunction(
    () => ["ready", "error"].includes(window.MrFeastFresh.getMrFeastState()?.loadStatus),
    null,
    { timeout: 180000 },
  );
  return page;
}

async function readState(page) {
  return page.evaluate(() => window.MrFeastFresh.getBanquetLossState());
}

async function assertSourceContract() {
  const [runtime, html, milestone] = await Promise.all([
    readFile(path.join(root, "assets", "js", "mr-feast-mansion.js"), "utf8"),
    readFile(path.join(root, "games", "mr-feast-mansion.html"), "utf8"),
    readFile(path.join(root, "docs", "milestones", "64-captured-at-dinner-loss.md"), "utf8"),
  ]);
  assert(/const BANQUET_LOSS\s*=\s*Object\.freeze/.test(runtime), "missing named banquet-loss tuning table");
  assert(/class BanquetLossSystem/.test(runtime), "missing focused BanquetLossSystem");
  assert(/banquetLoss:\s*\{/.test(runtime), "authoritative state must own the banquet loss");
  assert(/caughtReasons:[\s\S]{0,220}?witnessed[\s\S]{0,220}?recorded[\s\S]{0,220}?feast-hunt-eliminated/.test(runtime), "physical catch reasons are not explicitly routed");
  assert(/banquetLossSystem\?\.start/.test(runtime), "physical game over does not route into the banquet system");
  assert(/getBanquetLossState/.test(runtime) && /triggerBanquetLossForQA/.test(runtime) && /advanceBanquetLossForQA/.test(runtime), "focused banquet QA controls are missing");
  assert(runtime.includes(closingLine), "Mr. Feast's complete authored closing line is missing");
  assert(/data-banquet-loss/.test(html), "the stage needs a banquet-loss presentation state");
  assert(/user playtest/i.test(milestone), "Milestone 64 must retain visual user playtest acceptance");
}

async function assertAssetContract() {
  const manifestPath = path.join(root, "assets", "models", "mr-feast", "banquet", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(manifest.version === 1, `unexpected banquet manifest version: ${manifest.version}`);
  assert(manifest.body?.rigged === true && manifest.body?.meshy?.rigTaskId, `shared body must retain rigging provenance: ${JSON.stringify(manifest.body)}`);
  assert(manifest.body?.sourceCount === 1 && manifest.body?.runtimeFile, `exactly one body source must be reused: ${JSON.stringify(manifest.body)}`);
  assert(Array.isArray(manifest.masks) && manifest.masks.length === 6, `six masks are required: ${manifest.masks?.length}`);
  assert(new Set(manifest.masks.map((entry) => entry.id)).size === 6, "mask ids must be unique");
  assert(new Set(manifest.masks.map((entry) => entry.runtimeFile)).size === 6, "mask runtime files must be unique");
  assert(new Set(manifest.masks.map((entry) => entry.meshy?.sourceTaskId)).size <= 3, "credit budget allows no more than three Meshy mask source tasks");
  assert(manifest.masks.every((entry) => entry.blenderVariant && entry.boundsMeters && entry.forwardAxis), `every mask needs Blender/proportion metadata: ${JSON.stringify(manifest.masks)}`);

  const files = [manifest.body.runtimeFile, ...manifest.masks.map((entry) => entry.runtimeFile)];
  for (const file of files) {
    const fileStat = await stat(path.join(path.dirname(manifestPath), file));
    assert(fileStat.size > 1024, `${file} is not a viable GLB`);
    assert(fileStat.size <= 6 * 1024 * 1024, `${file} exceeds the 6 MB runtime budget (${fileStat.size} bytes)`);
  }
}

async function run() {
  await assertSourceContract();
  await assertAssetContract();

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

    const desktop = await bootPage(browser, { width: 1280, height: 820 }, errors);
    let initial = await readState(desktop);
    assert(initial.assetStatus === "idle", `banquet assets must remain deferred before a catch: ${JSON.stringify(initial)}`);
    assert(initial.phase === "inactive" && initial.visible === false, `loss dressing must be hidden during ordinary play: ${JSON.stringify(initial)}`);

    const caught = await desktop.evaluate(() => window.MrFeastFresh.triggerBanquetLossForQA("witnessed"));
    assert(caught?.reason === "witnessed", `QA catch must use the real game-over route: ${JSON.stringify(caught)}`);
    await desktop.waitForFunction(
      () => window.MrFeastFresh.getBanquetLossState()?.assetStatus === "ready"
        && window.MrFeastFresh.getBanquetLossState()?.visible,
      null,
      { timeout: 180000 },
    );
    let banquet = await readState(desktop);
    assert(
      banquet.phase === "revealing"
        && banquet.camera.mode === "first-person-table"
        && banquet.camera.locked
        && banquet.camera.room === "DINING ROOM"
        && banquet.camera.movementSuppressed,
      `catch must lock the table viewpoint before recovery UI: ${JSON.stringify(banquet.camera)}`,
    );
    assert(!banquet.overlayVisible, "the game-over overlay must not cover the establishing tableau");
    assert(
      banquet.patrons.length === 6
        && banquet.patrons.every((entry) => entry.visible && entry.seated && entry.facingPlayer)
        && new Set(banquet.patrons.map((entry) => entry.bodyFile)).size === 1
        && new Set(banquet.patrons.map((entry) => entry.maskId)).size === 6
        && new Set(banquet.patrons.map((entry) => entry.maskFile)).size === 6,
      `the Patron tableau must reuse one body with six unique masks: ${JSON.stringify(banquet.patrons)}`,
    );
    assert(
      banquet.host.visible
        && banquet.host.atFarEnd
        && banquet.host.facingPlayer
        && banquet.ritualDressing.placeCard === "CONTESTANT 13 — MAIN COURSE",
      `host/table ritual staging is incomplete: ${JSON.stringify({ host: banquet.host, ritual: banquet.ritualDressing })}`,
    );
    await desktop.screenshot({ path: path.join(artifactDir, "banquet-table-desktop.png") });

    await desktop.evaluate(() => window.MrFeastFresh.advanceBanquetLossForQA(2));
    banquet = await readState(desktop);
    assert(
      banquet.phase === "closing-line"
        && banquet.closingLine === closingLine
        && banquet.speech?.text === closingLine
        && !banquet.overlayVisible,
      `Mr. Feast must finish the scene before recovery UI: ${JSON.stringify(banquet)}`,
    );
    await desktop.screenshot({ path: path.join(artifactDir, "banquet-closing-line-desktop.png") });

    await desktop.evaluate(() => window.MrFeastFresh.advanceBanquetLossForQA(9));
    banquet = await readState(desktop);
    assert(
      banquet.phase === "complete"
        && banquet.overlayVisible
        && banquet.recovery.loadLabel === "Load last save"
        && banquet.recovery.restartLabel === "Start over",
      `the loss must end in recoverable controls: ${JSON.stringify(banquet)}`,
    );

    const cleared = await desktop.evaluate(() => window.MrFeastFresh.clearBanquetLossForQA());
    assert(cleared?.phase === "inactive" && !cleared.visible, `clearing the loss must remove the tableau: ${JSON.stringify(cleared)}`);
    const noShow = await desktop.evaluate(() => window.MrFeastFresh.triggerBanquetLossForQA("feast-says-no-show"));
    banquet = await readState(desktop);
    assert(noShow?.reason === "feast-says-no-show" && banquet.phase === "inactive" && banquet.overlayVisible, `non-catch loss must bypass the banquet: ${JSON.stringify(banquet)}`);
    await desktop.close();

    const phone = await bootPage(browser, { width: 390, height: 844 }, errors);
    await phone.evaluate(() => window.MrFeastFresh.triggerBanquetLossForQA("recorded"));
    await phone.waitForFunction(
      () => window.MrFeastFresh.getBanquetLossState()?.assetStatus === "ready"
        && window.MrFeastFresh.getBanquetLossState()?.visible,
      null,
      { timeout: 180000 },
    );
    const phoneState = await readState(phone);
    assert(phoneState.camera.locked && phoneState.host.visible && phoneState.patrons.filter((entry) => entry.inView).length >= 4, `phone framing must retain the host and at least four masks: ${JSON.stringify(phoneState)}`);
    await phone.screenshot({ path: path.join(artifactDir, "banquet-table-phone.png") });
    await phone.close();

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast banquet-loss regression passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
