import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_HOUSE_DISTRACTIONS_TEST_PORT || (52000 + (process.pid % 10000)));
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-house-distractions");

const expected = [
  {
    kind: "piano",
    room: "MUSIC ROOM",
    startPrompt: /start the player piano/i,
    stopPrompt: /stop the player piano/i,
    cue: "houseDistractionPiano",
    minimumVoices: 12,
  },
  {
    kind: "laundry",
    room: "LAUNDRY & LINEN",
    startPrompt: /start the laundry wringer/i,
    stopPrompt: /stop the laundry wringer/i,
    cue: "houseDistractionLaundry",
    minimumVoices: 2,
  },
  {
    kind: "service-bell",
    room: "DINING ROOM",
    startPrompt: /pull the service bell/i,
    stopPrompt: /silence the service bell/i,
    cue: "houseDistractionServiceBell",
    minimumVoices: 2,
  },
];

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

async function pressInteract(page) {
  await page.evaluate(() => {
    const canvas = document.getElementById("mansion-canvas");
    canvas.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", key: "e", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyE", key: "e", bubbles: true }));
  });
}

function entryFor(state, kind) {
  return state.houseDistractions?.entries?.find((entry) => entry.kind === kind) || null;
}

async function boot(page) {
  await page.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
  await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loadStatus === "ready", null, { timeout: 120000 });
  await page.evaluate(() => window.MrFeastFresh.setDevModeForQA(true));
  await page.evaluate(() => window.MrFeastFresh.prepareHouseDistractionAudioForQA());
  await page.waitForTimeout(250);
}

async function run() {
  const runtimeSource = await readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8");
  const pageSource = await readFile(path.join(root, "games/mr-feast-mansion.html"), "utf8");
  assert(/const MANSION_DISTRACTIONS\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the MANSION_DISTRACTIONS tuning table");
  assert(/const MANSION_DISTRACTIONS\s*=\s*Object\.freeze\(\{[\s\S]{0,500}noticeSeconds:\s*0\.8/.test(runtimeSource), "all three loud house devices must alert Mr. Feast within 0.8 seconds");
  assert(/registerDistraction\s*\(/.test(runtimeSource), "runtime is missing the shared distraction registration path");
  assert(/noticed-piano/.test(runtimeSource) && /fixed-service-bell/.test(runtimeSource), "runtime is missing device-specific Mr. Feast speech pools");
  assert(/competitionBlocksInvestigation\(\)/.test(runtimeSource), "distraction activation must preserve competition ownership");
  assert(!/house-distraction/i.test(pageSource), "house distractions must not add page UI or Escape-menu markup");

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
    await boot(page);

    let state = await diagnostics(page);
    assert(state.houseDistractions?.entries?.length === 3, `expected exactly three house distractions; got ${JSON.stringify(state.houseDistractions)}`);
    assert(state.houseDistractions.entries.every((entry) => !entry.active), "house distractions must start inactive");

    for (const device of expected) {
      await page.evaluate(() => {
        window.MrFeastFresh.resetMrFeastWandererForQA();
        window.MrFeastFresh.dismissSpeechForQA();
      });
      const placement = await page.evaluate((kind) => window.MrFeastFresh.placePlayerNearHouseDistractionForQA(kind), device.kind);
      assert(placement?.placed === true, `QA placement should find ${device.kind}; got ${JSON.stringify(placement)}`);
      await page.waitForFunction(
        (pattern) => new RegExp(pattern, "i").test(JSON.parse(window.render_game_to_text()).prompt || ""),
        device.startPrompt.source,
        { timeout: 8000 },
      );
      state = await diagnostics(page);
      assert(device.startPrompt.test(state.prompt || ""), `${device.kind} should expose its authored start prompt; got ${state.prompt}`);

      await pressInteract(page);
      await page.waitForTimeout(100);
      state = await diagnostics(page);
      let entry = entryFor(state, device.kind);
      assert(entry?.active === true, `real E interaction should activate ${device.kind}; got ${JSON.stringify(entry)}`);
      assert(entry.noticeRemaining > 0 && entry.noticeRemaining <= 0.81, `${device.kind} must make Mr. Feast react within 0.8 seconds; got ${JSON.stringify(entry)}`);
      assert(device.stopPrompt.test(state.prompt || ""), `${device.kind} should expose its stop prompt after activation; got ${state.prompt}`);
      const advanced = await page.evaluate(() => window.MrFeastFresh.advanceHouseDistractionsForQA(0.3));
      assert(advanced, `deterministic distraction time should advance for ${device.kind}`);
      state = await diagnostics(page);
      entry = entryFor(state, device.kind);
      assert(entry.pulseCount > 0, `${device.kind} should emit repeating spatial sound pulses; got ${JSON.stringify(entry)}`);
      assert(Math.abs(entry.visualOffset) > 0.001, `${device.kind} should visibly animate while active; got ${JSON.stringify(entry)}`);
      assert((state.audio.cueCounts[device.cue] || 0) > 0, `${device.kind} should record its procedural audio cue; got ${JSON.stringify(state.audio.cueCounts)}`);
      assert(state.audio.houseDistractions?.lastKind === device.kind && state.audio.houseDistractions.lastVoiceCount >= device.minimumVoices, `${device.kind} must schedule its audible spatial voices; got ${JSON.stringify(state.audio.houseDistractions)}`);
      if (device.kind === "piano") {
        assert(state.audio.houseDistractions.pianoNoteCount >= 4, `the piano must play a recognizable multi-note figure; got ${JSON.stringify(state.audio.houseDistractions)}`);
      }
      assert(state.room === device.room, `${device.kind} QA placement should remain in ${device.room}; got ${state.room}`);
      await page.screenshot({ path: path.join(artifactDir, `${device.kind}-active.png`), fullPage: true });

      // Move the player clear without resetting Mr. Feast: with the faster
      // response he may already own the errand by the end of image capture.
      await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
      const notice = await page.evaluate(() => window.MrFeastFresh.advanceHouseDistractionsForQA(30));
      state = await diagnostics(page);
      assert(
        notice.dispatched.includes(entry.id) || entryFor(state, device.kind)?.dispatched,
        `${device.kind} should dispatch Mr. Feast after its notice delay; got ${JSON.stringify({ notice, room: state.room, security: state.mrFeast.security, housekeeping: state.mrFeast.housekeeping })}`,
      );
      if (notice.dispatched.includes(entry.id)) {
        assert(notice.seconds <= 0.85, `${device.kind} should dispatch Mr. Feast in under a second; got ${JSON.stringify(notice)}`);
      } else {
        assert(entryFor(state, device.kind)?.dispatched, `${device.kind} should already be dispatched if the 0.8-second live window elapsed during capture; got ${JSON.stringify({ notice, entry: entryFor(state, device.kind) })}`);
      }
      assert(state.mrFeast.housekeeping.activeTaskId === entry.id, `Mr. Feast should own the ${device.kind} errand; got ${JSON.stringify(state.mrFeast.housekeeping)}`);
      assert(state.speech.category === `noticed-${device.kind}`, `${device.kind} should use its noticed speech pool; got ${JSON.stringify(state.speech)}`);

      const route = await page.evaluate(() => window.MrFeastFresh.runMrFeastHousekeepingForQA(420));
      assert(route.completed && route.fixesCompleted >= 1, `Mr. Feast should walk over and fix ${device.kind}; got ${JSON.stringify(route)}`);
      assert(route.teleports === 0, `${device.kind} housekeeping must not teleport Mr. Feast`);
      assert(route.states.includes("responding") && route.states.includes("searching") && route.states.includes("returning"), `${device.kind} should use the full housekeeping route; got ${JSON.stringify(route.states)}`);
      state = await diagnostics(page);
      assert(entryFor(state, device.kind).active === false, `Mr. Feast should leave ${device.kind} inactive`);
      assert(state.speech.lastCategory === `fixed-${device.kind}`, `${device.kind} should use its fixed speech pool; got ${JSON.stringify(state.speech)}`);
    }

    // The player can cancel an active distraction before Mr. Feast arrives.
    await page.evaluate(() => window.MrFeastFresh.placePlayerNearHouseDistractionForQA("piano"));
    await page.waitForFunction(() => /start the player piano/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressInteract(page);
    await page.waitForTimeout(80);
    await pressInteract(page);
    await page.waitForTimeout(80);
    state = await diagnostics(page);
    const cancelled = entryFor(state, "piano");
    assert(!cancelled.active && cancelled.cooldownRemaining > 0, `manual stop should silence the piano and apply cooldown; got ${JSON.stringify(cancelled)}`);

    // Loading/restarting clears every active device.
    await page.evaluate(() => window.MrFeastFresh.activateHouseDistractionForQA("laundry", true));
    const reset = await page.evaluate(() => window.MrFeastFresh.resetHouseDistractionsForQA());
    assert(reset.entries.every((entry) => !entry.active && entry.noticeRemaining === 0), `reset should clear all device state; got ${JSON.stringify(reset)}`);

    // Live competitions own Mr. Feast and make the devices unavailable.
    const competitionBlock = await page.evaluate(() => {
      const call = window.MrFeastFresh.callFeastSaysForQA("qa-house-distraction-block");
      const attempt = window.MrFeastFresh.activateHouseDistractionForQA("piano", true);
      return { call, attempt };
    });
    assert(competitionBlock.call.started === true, `Feast Says should enter its production hold for the block test; got ${JSON.stringify(competitionBlock)}`);
    assert(
      competitionBlock.attempt.active === false && /competition/i.test(competitionBlock.attempt.blockedReason || ""),
      `competition ownership should reject the distraction; got ${JSON.stringify(competitionBlock)}`,
    );

    assert(errors.length === 0, `desktop console errors: ${errors.join(" | ")}`);
    await page.close();

    // The shipped touch-interact control operates the same world interaction.
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobileErrors = [];
    watchErrors(mobile, mobileErrors);
    await boot(mobile);
    await mobile.evaluate(() => window.MrFeastFresh.placePlayerNearHouseDistractionForQA("service-bell"));
    await mobile.waitForFunction(() => /pull the service bell/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await mobile.locator("#touch-interact").tap();
    await mobile.waitForTimeout(100);
    state = await diagnostics(mobile);
    assert(entryFor(state, "service-bell")?.active === true, `touch interact should ring the service bell; got ${JSON.stringify(state.houseDistractions)}`);
    assert(await mobile.locator("[id*='house-distraction'], [class*='house-distraction']").count() === 0, "the feature must not add a distraction HUD");
    await mobile.screenshot({ path: path.join(artifactDir, "service-bell-mobile.png"), fullPage: true });
    assert(mobileErrors.length === 0, `mobile console errors: ${mobileErrors.join(" | ")}`);

    console.log(JSON.stringify({
      ok: true,
      devices: expected.map(({ kind, room }) => ({ kind, room })),
      artifacts: artifactDir,
      desktopErrors: errors,
      mobileErrors,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
