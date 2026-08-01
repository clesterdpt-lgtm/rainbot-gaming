import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_BASEMENT_HAUNT_TEST_PORT || (50000 + (process.pid % 12000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1&view=archiveHauntBook&frame=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-archive-workroom-haunts");

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

async function captureStage(page, fileName) {
  await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, fileName) });
}

async function run() {
  const [runtime, html] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  assert(/const BASEMENT_HAUNT = Object\.freeze\(\{/.test(runtime), "missing named BASEMENT_HAUNT tuning and story table");
  assert(/class BasementHauntSystem/.test(runtime), "missing lifecycle-owned BasementHauntSystem");
  assert(/archive-feast-father-lore-book-floor/.test(runtime), "the Feast Father lore volume is not a physical Archive floor discovery");
  assert(!/feast-father-lore-book-cover/.test(runtime), "the Feast Father lore volume still has a duplicate Library-table prop");
  assert((runtime.match(/archive-contestant-preparation-file-/g) || []).length >= 3, "the Archive needs at least three physical previous-contestant files");
  assert(/workroomFeastFatherBreathing/.test(runtime), "the Workroom blackout lacks a dedicated Feast Father breathing treatment");
  assert(/setStatic\(active/.test(runtime) && /staticMix/.test(runtime), "the live Workroom monitor bank lacks a temporary animated-static state");
  assert(/setTransientBlackout\(active/.test(runtime), "room circuits need a transient blackout that preserves switch state");
  const runtimeVersion = runtime.match(/MANSION_RUNTIME_VERSION\s*=\s*"([^"]+)"/)?.[1];
  assert(runtimeVersion && html.includes(`mr-feast-mansion.js?v=${runtimeVersion}`), "page/runtime cache identities must match");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    watchErrors(page, errors);
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.evaluate(() => window.MrFeastFresh.prepareBasementHauntAudioForQA());

    let haunt = await page.evaluate(() => window.MrFeastFresh.resetBasementHauntForQA({ clearSeen: true }));
    assert(!haunt.archive.dropSeen && !haunt.archive.book.visible, `fresh Archive haunt state should hide the floor book: ${JSON.stringify(haunt)}`);
    haunt = await page.evaluate(() => window.MrFeastFresh.triggerArchiveHauntForQA());
    assert(haunt.archive.active && haunt.archive.phase === "book-falling", `Archive exploration should begin with the book fall: ${JSON.stringify(haunt)}`);
    haunt = await page.evaluate(() => window.MrFeastFresh.advanceBasementHauntForQA(0.9));
    assert(haunt.archive.dropSeen && haunt.archive.book.visible && haunt.archive.book.onFloor, `the impact must leave the lore book on the Archive floor: ${JSON.stringify(haunt.archive)}`);
    assert(haunt.archive.dropSoundCount === 1, `the physical drop should emit exactly one spatial impact: ${JSON.stringify(haunt.archive)}`);
    assert(haunt.archive.closedDoors.includes("basement stair door"), `the service-stair door should close behind the player: ${JSON.stringify(haunt.archive.closedDoors)}`);
    assert(haunt.archive.blackoutActive, `the Archive light circuit should fail after the drop: ${JSON.stringify(haunt.archive)}`);
    await captureStage(page, "archive-book-drop-blackout-desktop.png");

    haunt = await page.evaluate(() => window.MrFeastFresh.advanceBasementHauntForQA(5));
    assert(!haunt.archive.active && !haunt.archive.blackoutActive && haunt.archive.circuitOn, `Archive lighting should restore its pre-scare switch state: ${JSON.stringify(haunt.archive)}`);
    assert(haunt.archive.book.visible && haunt.archive.book.onFloor, "the dropped lore book should remain discoverable after the scare ends");
    await page.evaluate(() => window.MrFeastFresh.frameArchiveHauntBookForQA());
    await captureStage(page, "archive-book-grounded-restored-desktop.png");

    const loreOpened = await page.evaluate(() => window.MrFeastFresh.openFeastFatherLoreBookForQA());
    assert(loreOpened === true, "the dropped lore volume should use the shared readable-book UI");
    await page.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    const lore = await page.evaluate(() => ({
      title: document.getElementById("mansion-book-title")?.textContent,
      collection: document.getElementById("mansion-book-collection")?.textContent,
      preview: document.getElementById("mansion-book-preview")?.textContent,
    }));
    assert(/Household Observances/.test(lore.title || "") && /Archive/i.test(lore.collection || "") && /Feast Father/i.test(lore.preview || ""), `the floor book should be the canonical Feast Father lore volume: ${JSON.stringify(lore)}`);
    await captureStage(page, "archive-feast-father-lore-book-desktop.png");
    await page.keyboard.press("Escape");

    for (const id of ["contestant-04", "contestant-09", "contestant-12"]) {
      const file = await page.evaluate((fileId) => window.MrFeastFresh.readArchiveContestantFileForQA(fileId), id);
      assert(file?.id === id && file.read && /prepared|course|served|roast|brais|carv/i.test(`${file.title} ${file.body}`), `Archive file ${id} needs disturbing preparation records: ${JSON.stringify(file)}`);
    }
    haunt = await page.evaluate(() => window.MrFeastFresh.getBasementHauntState());
    assert(haunt.archive.files.readIds.length === 3 && haunt.archive.files.physicalCount >= 3, `all physical contestant dossiers should be independently readable: ${JSON.stringify(haunt.archive.files)}`);
    await page.evaluate(() => window.MrFeastFresh.frameArchiveContestantFilesForQA());
    await captureStage(page, "archive-contestant-preparation-files-desktop.png");

    await page.evaluate(() => window.MrFeastFresh.teleport("workroomMonitorWall"));
    const lightLayoutBefore = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    await page.evaluate(() => window.MrFeastFresh.triggerWorkroomPatronHauntForQA());
    haunt = await page.evaluate(() => window.MrFeastFresh.getBasementHauntState());
    assert(haunt.workroom.active && haunt.workroom.phase === "blackout", `relay sabotage should begin the Workroom haunt: ${JSON.stringify(haunt.workroom)}`);
    assert(haunt.workroom.blackoutActive && haunt.workroom.staticActive, `Workroom lights and all screens should fail together: ${JSON.stringify(haunt.workroom)}`);
    assert(haunt.workroom.closedDoors.includes("workroom door"), `the Workroom door should close without relocking: ${JSON.stringify(haunt.workroom.closedDoors)}`);
    assert(haunt.workroom.breathing.active && haunt.workroom.breathing.targetGain >= 0.2, `the close Feast Father breathing should be deliberately loud but bounded: ${JSON.stringify(haunt.workroom.breathing)}`);
    const monitorStatic = await page.evaluate(() => window.MrFeastFresh.getMonitorWallState());
    assert(monitorStatic.staticActive && monitorStatic.staticScreens === monitorStatic.screenCount, `every Workroom display should show animated static: ${JSON.stringify(monitorStatic)}`);
    await page.waitForTimeout(250);
    await captureStage(page, "workroom-patron-feed-static-blackout-desktop.png");

    haunt = await page.evaluate(() => window.MrFeastFresh.advanceBasementHauntForQA(7));
    assert(!haunt.workroom.active && haunt.workroom.seen && !haunt.workroom.blackoutActive && !haunt.workroom.staticActive, `the Workroom should return to normal after the bounded scare: ${JSON.stringify(haunt.workroom)}`);
    assert(!haunt.workroom.breathing.active && haunt.workroom.circuitOn, `breathing must stop and the prior Workroom light state must restore: ${JSON.stringify(haunt.workroom)}`);
    const monitorRestored = await page.evaluate(() => window.MrFeastFresh.getMonitorWallState());
    assert(!monitorRestored.staticActive && monitorRestored.staticScreens === 0, `live monitor presentation should return after the scare: ${JSON.stringify(monitorRestored)}`);
    const lightLayoutAfter = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    assert(JSON.stringify(lightLayoutAfter) === JSON.stringify(lightLayoutBefore), `haunts must not change the fixed shader-light topology: before=${JSON.stringify(lightLayoutBefore)} after=${JSON.stringify(lightLayoutAfter)}`);

    const saved = await page.evaluate(() => window.MrFeastFresh.saveGameForQA());
    assert(saved === true, "completed basement haunt flags should save");
    await page.evaluate(() => window.MrFeastFresh.resetBasementHauntForQA({ clearSeen: true }));
    const loaded = await page.evaluate(() => window.MrFeastFresh.loadGameForQA());
    assert(loaded === true, "completed basement haunt flags should load");
    haunt = await page.evaluate(() => window.MrFeastFresh.getBasementHauntState());
    assert(haunt.archive.dropSeen && haunt.workroom.seen && haunt.archive.files.readIds.length === 3, `one-shot discoveries and file reads should survive save/load: ${JSON.stringify(haunt)}`);
    assert(!haunt.archive.active && !haunt.workroom.active && !haunt.workroom.breathing.active, "save restoration must clear transient scare/audio state");

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast Archive and Workroom haunt regression passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
