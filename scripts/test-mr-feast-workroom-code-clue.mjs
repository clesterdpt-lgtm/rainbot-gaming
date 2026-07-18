import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_CODE_CLUE_TEST_PORT || (50100 + (process.pid % 14000)));
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-workroom-code-clue");

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

async function pressKey(page, code, key) {
  await page.evaluate(({ code, key }) => {
    const canvas = document.getElementById("mansion-canvas");
    canvas.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
  }, { code, key });
}

function clueEntry(state) {
  return (state.journal?.details || []).find((entry) => /workroom keypad scratches/i.test(entry.title || "")) || null;
}

async function run() {
  const runtimeSource = await readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8");
  assert(/const WORKROOM_CODE_SCRATCHES\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the WORKROOM_CODE_SCRATCHES table");
  const digits = [...runtimeSource.matchAll(/numeral:\s*"(?:I|II|III|IV)",\s*digit:\s*"(\d)"/g)].map((match) => match[1]);
  assert(digits.length === 4, `the scratch table should carry exactly four digits; got ${JSON.stringify(digits)}`);
  const configuredCode = runtimeSource.match(/code:\s*"(\d{4})"/)?.[1];
  assert(digits.join("") === configuredCode, `scratch digits in numeral order must assemble the keypad code; got ${digits.join("")} vs ${configuredCode}`);

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
    await page.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loadStatus === "ready", null, { timeout: 120000 });
    await page.waitForTimeout(300);

    // --- Baseline: four hidden scratches, no discoveries ----------------------
    let state = await diagnostics(page);
    const code = state.workroomCode;
    assert(code && code.targets?.length === 4, `diagnostics should expose four scratch targets; got ${JSON.stringify(code)}`);
    assert(code.discoveredCount === 0 && code.complete === false, `a fresh run should start with no discoveries; got ${JSON.stringify(code)}`);
    assert(code.targets.every((target) => target.revealed === false && target.discovered === false), `all scratches should start hidden; got ${JSON.stringify(code.targets)}`);
    assert(state.tamper.entries.some((entry) => entry.artId === "five-doors"), "tamper entries should expose portrait artIds");
    assert(clueEntry(state) === null, "the evidence pad should not mention the scratches before any discovery");

    // --- Real E reveal on the east-wall painting ------------------------------
    await page.evaluate(() => window.MrFeastFresh.teleport("codeScratchFiveDoors"));
    await page.waitForFunction(() => /tilt/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(page, "KeyE", "e");
    await page.waitForTimeout(150);
    state = await diagnostics(page);
    let target = state.workroomCode.targets.find((candidate) => candidate.artId === "five-doors");
    assert(target.revealed === true && target.discovered === true, `tilting the carrier painting should reveal and discover its scratch; got ${JSON.stringify(target)}`);
    assert(state.workroomCode.discoveredCount === 1, `one discovery should be recorded; got ${JSON.stringify(state.workroomCode)}`);
    let entry = clueEntry(state);
    assert(entry, "the first discovery should create the evidence-pad entry");
    assert(new RegExp(`${target.numeral}\\s+${target.digit}`).test(entry.body), `the entry should record the numeral and digit; got ${JSON.stringify(entry.body)}`);
    assert(!entry.body.includes(configuredCode), `the full code must not appear before all four are found; got ${JSON.stringify(entry.body)}`);
    await page.screenshot({ path: path.join(artifactDir, "scratch-revealed-desktop.png") });

    // Straightening hides the scratch again but keeps the discovery.
    await page.waitForFunction(() => /straighten/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(page, "KeyE", "e");
    await page.waitForTimeout(150);
    state = await diagnostics(page);
    target = state.workroomCode.targets.find((candidate) => candidate.artId === "five-doors");
    assert(target.revealed === false && target.discovered === true, `straightening should hide the scratch but keep the discovery; got ${JSON.stringify(target)}`);

    // --- Mr. Feast's fix also re-hides a revealed scratch ---------------------
    const secondArtId = await page.evaluate(() => {
      const second = window.MrFeastFresh.getTamperState().entries.find((candidate) => candidate.artId === "polite-eclipse");
      window.MrFeastFresh.tamperForQA(second.id, true);
      return second.artId;
    });
    state = await diagnostics(page);
    assert(state.workroomCode.targets.find((candidate) => candidate.artId === secondArtId).revealed === true, "a QA tilt should reveal the second scratch");
    await page.evaluate(() => window.MrFeastFresh.advanceTamperForQA(30));
    await page.evaluate(() => window.MrFeastFresh.runMrFeastHousekeepingForQA(420));
    state = await diagnostics(page);
    target = state.workroomCode.targets.find((candidate) => candidate.artId === secondArtId);
    assert(target.revealed === false && target.discovered === true, `Mr. Feast's fix should re-hide the scratch while the discovery persists; got ${JSON.stringify(target)}`);
    assert(state.workroomCode.discoveredCount === 2, `two discoveries should be recorded; got ${JSON.stringify(state.workroomCode)}`);

    // --- Save now, then finish the hunt; loading returns to two ---------------
    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    await page.waitForTimeout(120);
    assert(await page.evaluate(() => window.MrFeastFresh.saveGameForQA()) === true, "the mid-hunt save should succeed");

    await page.evaluate(() => {
      for (const artId of ["garden-knees", "choir-floorboards"]) {
        const entryForArt = window.MrFeastFresh.getTamperState().entries.find((candidate) => candidate.artId === artId);
        window.MrFeastFresh.tamperForQA(entryForArt.id, true);
      }
    });
    state = await diagnostics(page);
    assert(state.workroomCode.discoveredCount === 4 && state.workroomCode.complete === true, `all four discoveries should complete the hunt; got ${JSON.stringify(state.workroomCode)}`);
    entry = clueEntry(state);
    assert(entry.body.includes(configuredCode), `the finalized entry should assemble the code; got ${JSON.stringify(entry.body)}`);
    assert(state.workroomCode.code === configuredCode, `QA diagnostics should expose the assembled code; got ${JSON.stringify(state.workroomCode.code)}`);

    const loaded = await page.evaluate(() => window.MrFeastFresh.loadGameForQA());
    assert(loaded === true, "loading the mid-hunt save should succeed");
    await page.waitForTimeout(200);
    state = await diagnostics(page);
    assert(state.workroomCode.discoveredCount === 2 && state.workroomCode.complete === false, `loading should restore the two-discovery state; got ${JSON.stringify(state.workroomCode)}`);
    assert(state.workroomCode.targets.every((candidate) => candidate.revealed === false), "loading should resync all scratches to the untampered paintings");
    entry = clueEntry(state);
    assert(entry && !entry.body.includes(configuredCode), `the reloaded entry should be partial again; got ${JSON.stringify(entry?.body)}`);

    // --- Dev mode grants everything and restores on disable -------------------
    await page.evaluate(() => window.MrFeastFresh.setDevModeForQA(true));
    state = await diagnostics(page);
    assert(state.workroomCode.discoveredCount === 4 && clueEntry(state)?.body.includes(configuredCode), `dev mode should grant the finalized hunt; got ${JSON.stringify(state.workroomCode)}`);
    await page.evaluate(() => window.MrFeastFresh.setDevModeForQA(false));
    state = await diagnostics(page);
    assert(state.workroomCode.discoveredCount === 2, `disabling dev mode should restore the pre-dev hunt; got ${JSON.stringify(state.workroomCode)}`);

    // --- Keypad regression: an unlocked pad still echoes digits ---------------
    await page.evaluate(() => window.MrFeastFresh.resetWorkroomForQA());
    await page.evaluate((pin) => window.MrFeastFresh.submitWorkroomCodeForQA(pin), configuredCode);
    state = await diagnostics(page);
    assert(state.workroom.entrance.locked === false && state.workroom.keypad.status === "accepted", `submitting the assembled code should unlock the Workroom; got ${JSON.stringify(state.workroom.keypad)}`);
    await page.evaluate(() => window.MrFeastFresh.openWorkroomKeypadForQA());
    await page.waitForTimeout(150);
    await pressKey(page, "Digit7", "7");
    await pressKey(page, "Digit7", "7");
    await page.waitForTimeout(150);
    const padProbe = await page.evaluate(() => ({
      inputLength: window.MrFeastFresh.getWorkroomState().keypad.inputLength,
      display: document.getElementById("mansion-workroom-keypad-display")?.textContent || "",
      status: document.getElementById("mansion-workroom-keypad-status")?.textContent || "",
    }));
    assert(padProbe.inputLength === 2 && padProbe.display.startsWith("●●"), `an unlocked pad must still echo digit presses; got ${JSON.stringify(padProbe)}`);
    assert(/granted/i.test(padProbe.status), `an unlocked pad should keep reporting granted access; got ${JSON.stringify(padProbe)}`);
    await page.screenshot({ path: path.join(artifactDir, "unlocked-keypad-echo-desktop.png") });

    assert(errors.length === 0, `console errors: ${errors.join(" | ")}`);
    await page.close();

    console.log("Mr. Feast workroom keycode scratch clue checks passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
