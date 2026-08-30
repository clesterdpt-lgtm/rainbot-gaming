import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_BATHROOM_MIRROR_TEST_PORT || (53000 + (process.pid % 10000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1&frame=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-bathroom-mirror-scare");

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

function watchErrors(page, errors) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
  });
}

async function mirrorState(page) {
  return page.evaluate(() => window.MrFeastFresh.getBathroomMirrorScareState());
}

async function captureStage(page, name) {
  await page.waitForTimeout(80);
  await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, name) });
}

async function run() {
  const [runtime, html] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  assert(/const BATHROOM_MIRROR_SCARE = Object\.freeze\(\{/.test(runtime), "missing named bathroom mirror tuning table");
  assert(/class BathroomMirrorScareSystem/.test(runtime), "missing lifecycle-owned bathroom mirror scare system");
  assert(runtime.includes('message: Object.freeze(["GET CLEAN.", "DINNER\\nIS SOON."])'), "approved two-beat mirror message is missing");
  assert(/fixture\.kind === "sink" \|\| fixture\.kind === "shower"/.test(runtime), "only bathroom sinks and showers should qualify");
  assert(/bathroomMirrorScare:\s*bathroomMirrorScareSystem\?\.getSnapshot/.test(runtime), "completion must be included in mansion saves");
  assert(/getBathroomMirrorScareState/.test(runtime) && /advanceBathroomMirrorScareForQA/.test(runtime), "focused mirror diagnostics are missing");
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

    let scare = await page.evaluate(() => window.MrFeastFresh.resetBathroomMirrorScareForQA());
    assert(scare.surfaceCount === 4 && scare.rooms.length === 2, `both paired vanities need authored overlays: ${JSON.stringify(scare)}`);
    assert(scare.message.join(" ") === "GET CLEAN. DINNER IS SOON.", `unexpected message: ${JSON.stringify(scare.message)}`);
    assert(scare.rooms.every((room) => room.visibleFogSurfaces === 0 && room.visibleMessageSurfaces === 0), "fresh mirrors should be clear");
    await page.evaluate(() => window.MrFeastFresh.frameBathroomMirrorScareForQA("main-hall-bathroom"));
    await captureStage(page, "main-hall-mirrors-clear-desktop.png");

    await page.evaluate(() => window.MrFeastFresh.setWater("kitchen sink", true));
    scare = await page.evaluate(() => window.MrFeastFresh.advanceBathroomMirrorScareForQA(45));
    assert(!scare.completed && !scare.activeRoomId, `the Kitchen sink must not trigger bathroom condensation: ${JSON.stringify(scare)}`);
    await page.evaluate(() => window.MrFeastFresh.setWater("kitchen sink", false));

    await page.evaluate(() => window.MrFeastFresh.setWater("main hall bathtub tap", true));
    scare = await page.evaluate(() => window.MrFeastFresh.advanceBathroomMirrorScareForQA(45));
    assert(!scare.completed && !scare.activeRoomId, `the bathtub tap must not trigger the sink/shower scare: ${JSON.stringify(scare)}`);
    await page.evaluate(() => window.MrFeastFresh.setWater("main hall bathtub tap", false));

    await page.evaluate(() => window.MrFeastFresh.setWater("upper grand bathroom sink 1", true));
    scare = await page.evaluate(() => window.MrFeastFresh.advanceBathroomMirrorScareForQA(18));
    const interrupted = scare.rooms.find((room) => room.id === "upper-grand-bathroom");
    assert(interrupted.fogProgress > 0 && interrupted.firstMessageProgress === 0, `fog should precede lettering: ${JSON.stringify(interrupted)}`);
    await page.evaluate(() => window.MrFeastFresh.setWater("upper grand bathroom sink 1", false));
    scare = await page.evaluate(() => window.MrFeastFresh.advanceBathroomMirrorScareForQA(8));
    assert(!scare.activeRoomId && scare.rooms.every((room) => room.visibleFogSurfaces === 0), `interrupted steam should recede cleanly: ${JSON.stringify(scare)}`);

    const lightLayoutBefore = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    await page.evaluate(() => window.MrFeastFresh.setWater("main hall bathroom sink 1", true));
    scare = await page.evaluate(() => window.MrFeastFresh.advanceBathroomMirrorScareForQA(14));
    let main = scare.rooms.find((room) => room.id === "main-hall-bathroom");
    assert(main.fogProgress > 0 && main.firstMessageProgress === 0 && main.visibleFogSurfaces === 2, `both vanity mirrors should fog before the warning: ${JSON.stringify(main)}`);
    await captureStage(page, "main-hall-mirrors-fogging-desktop.png");

    scare = await page.evaluate(() => window.MrFeastFresh.advanceBathroomMirrorScareForQA(12));
    main = scare.rooms.find((room) => room.id === "main-hall-bathroom");
    assert(main.firstMessageProgress > 0 && main.firstMessageProgress < 1, `GET CLEAN should wipe in gradually: ${JSON.stringify(main)}`);
    assert(main.secondMessageProgress === 0 && main.visibleMessageSurfaces === 1, `DINNER IS SOON must wait for the second beat: ${JSON.stringify(main)}`);
    await captureStage(page, "main-hall-mirror-get-clean-revealing-desktop.png");

    scare = await page.evaluate(() => window.MrFeastFresh.advanceBathroomMirrorScareForQA(14));
    main = scare.rooms.find((room) => room.id === "main-hall-bathroom");
    assert(scare.completed && scare.completedRoomId === "main-hall-bathroom", `the full warning should complete once: ${JSON.stringify(scare)}`);
    assert(main.firstMessageProgress === 1 && main.secondMessageProgress === 1 && main.visibleMessageSurfaces === 2, `both final phrases should remain readable while water runs: ${JSON.stringify(main)}`);
    await captureStage(page, "main-hall-mirror-message-complete-desktop.png");
    const lightLayoutAfter = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    assert(JSON.stringify(lightLayoutAfter) === JSON.stringify(lightLayoutBefore), "mirror overlays must not alter shader-light topology");

    await page.evaluate(() => window.MrFeastFresh.setWater("main hall bathroom sink 1", false));
    scare = await page.evaluate(() => window.MrFeastFresh.advanceBathroomMirrorScareForQA(8));
    main = scare.rooms.find((room) => room.id === "main-hall-bathroom");
    assert(main.visibleFogSurfaces === 0 && main.visibleMessageSurfaces === 0, `shutoff should clear the message over the bounded fade: ${JSON.stringify(main)}`);

    const saved = await page.evaluate(() => window.MrFeastFresh.saveGameForQA());
    assert(saved === true, "completed mirror scare should save");
    await page.evaluate(() => window.MrFeastFresh.resetBathroomMirrorScareForQA());
    const loaded = await page.evaluate(() => window.MrFeastFresh.loadGameForQA());
    assert(loaded === true, "completed mirror scare should load");
    scare = await mirrorState(page);
    assert(scare.completed && scare.completedRoomId === "main-hall-bathroom" && !scare.activeRoomId, `load should restore only the one-shot completion flag: ${JSON.stringify(scare)}`);
    assert(scare.rooms.every((room) => room.visibleFogSurfaces === 0 && room.visibleMessageSurfaces === 0), "load must never resume transient steam");

    await page.evaluate(() => window.MrFeastFresh.setWater("upper grand shower", true));
    scare = await page.evaluate(() => window.MrFeastFresh.advanceBathroomMirrorScareForQA(45));
    assert(scare.completedRoomId === "main-hall-bathroom" && !scare.activeRoomId, `the other bathroom must not replay a completed scare: ${JSON.stringify(scare)}`);
    await page.evaluate(() => window.MrFeastFresh.setWater("upper grand shower", false));

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast bathroom mirror scare acceptance passed: qualifying plumbing, delayed fog, ordered two-mirror reveal, clearing, exclusions, one-shot persistence, fixed lighting, and clean browser console verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
