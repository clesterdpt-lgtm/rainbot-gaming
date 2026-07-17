import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_AUDIO_TEST_PORT || (48500 + (process.pid % 12000)));
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

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function moveForward(page, seconds = 1.2, { sprint = false } = {}) {
  if (sprint) await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.evaluate((duration) => window.MrFeastFresh.advancePlayerForQA(duration), seconds);
  await page.keyboard.up("w");
  if (sprint) await page.keyboard.up("Shift");
  await page.waitForTimeout(60);
}

async function waitForCue(page, cue, previous = 0) {
  await page.waitForFunction(
    ({ cueName, oldCount }) => (window.MrFeastFresh?.getAudioStateForQA?.().cueCounts?.[cueName] || 0) > oldCount,
    { cueName: cue, oldCount: previous },
    { timeout: 10000 },
  );
}

async function run() {
  const runtimePath = path.join(root, "assets/js/mr-feast-mansion.js");
  const runtimeSource = await readFile(runtimePath, "utf8");
  const pageSource = await readFile(path.join(root, "games/mr-feast-mansion.html"), "utf8");
  const licenseSource = await readFile(path.join(root, "assets/Sounds/mr-feast/LICENSES.md"), "utf8");
  const expectedAssets = [
    "rain-concrete.ogg",
    "thunder-01.ogg",
    "thunder-02.ogg",
    "thunder-03.ogg",
    "thunder-04.ogg",
    "footstep-wood-01.ogg",
    "footstep-wood-02.ogg",
    "footstep-wood-03.ogg",
    "footstep-wood-04.ogg",
    "footstep-stone-01.ogg",
    "footstep-stone-02.ogg",
    "footstep-stone-03.ogg",
    "footstep-stone-04.ogg",
    "footstep-grass-01.ogg",
    "footstep-grass-02.ogg",
    "footstep-grass-03.ogg",
    "footstep-grass-04.ogg",
    "door-open-01.ogg",
    "door-open-02.ogg",
    "door-close-01.ogg",
    "door-close-02.ogg",
    "book-open.ogg",
    "book-close.ogg",
    "book-flip-01.ogg",
    "book-flip-02.ogg",
    "cloth-01.ogg",
    "cloth-02.ogg",
    "metal-click.ogg",
    "metal-latch.ogg",
    "light-switch-on.ogg",
    "light-switch-off.ogg",
    "keypad-tick.ogg",
    "keypad-confirm.ogg",
    "keypad-error.ogg",
  ];
  for (const filename of expectedAssets) {
    const info = await stat(path.join(root, "assets/Sounds/mr-feast", filename));
    assert(info.size > 1000, `${filename} should be a non-empty local audio asset`);
  }
  assert(
    /BigSoundBank/i.test(licenseSource)
      && /1,289/.test(licenseSource)
      && /3,113/.test(licenseSource)
      && /3,116/.test(licenseSource)
      && /Kenney Impact Sounds/i.test(licenseSource)
      && /Kenney RPG Audio/i.test(licenseSource)
      && /Kenney Interface Sounds/i.test(licenseSource)
      && /CC0/i.test(licenseSource)
      && !/CC BY/i.test(licenseSource),
    "audio provenance should record the BigSoundBank and Kenney CC0 sources without attribution-only licenses",
  );
  assert(/const MANSION_AUDIO_ASSETS\s*=\s*Object\.freeze/.test(runtimeSource), "runtime should declare a local mansion audio manifest");
  for (const filename of expectedAssets) {
    assert(runtimeSource.includes(filename), `the mansion audio manifest should reference ${filename}`);
  }
  assert(/updateFootsteps\(fixedDt\)/.test(runtimeSource) && /audioSystem\?\.updateFootsteps\(1 \/ 60\)/.test(runtimeSource), "footsteps should be advanced from fixed-step grounded movement");
  assert(/footstepSurface\(/.test(runtimeSource) && /footstepWood|footstepStone|footstepGrass/.test(runtimeSource), "footsteps should distinguish wood, stone, and grass surfaces");
  assert(/const stride = state\.movement\.crouched[^;]+state\.movement\.sprinting/.test(runtimeSource) && /const baseVolume = state\.movement\.crouched[^;]+state\.movement\.sprinting/.test(runtimeSource), "crouch, walk, and sprint should have distinct footstep cadence and loudness");
  assert(/audioSystem\.book\("open"\)/.test(runtimeSource) && /audioSystem\.book\("close"\)/.test(runtimeSource), "readable books should have open and close foley hooks");
  assert(/audioSystem\.hide\("enter"\)/.test(runtimeSource) && /audioSystem\.hide\("exit"\)/.test(runtimeSource), "hiding should have fabric movement hooks");
  assert(/audioSystem\.pickup\("key"\)/.test(runtimeSource) && /audioSystem\.key\("unlock"\)/.test(runtimeSource), "story pickups and locks should use physical key cues");
  assert(
    /Enable game audio/.test(pageSource) && !/(?:Enable|Mute) storm audio/.test(pageSource) && /Mute game audio/.test(runtimeSource),
    "the sound control should describe the full game mix instead of only the storm",
  );

  let server = null;
  let browser = null;
  if (!(await serverResponds())) server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });

  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&allLights=1&bookSeed=13013&view=readableBookLibrary&frame=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.locator("#mansion-enter").click();
    await page.waitForFunction(() => window.MrFeastFresh?.getAudioStateForQA?.().contextState === "running", null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const audio = window.MrFeastFresh?.getAudioStateForQA?.();
      return audio?.expectedAssets >= 34 && audio.loadedAssets?.length === audio.expectedAssets;
    }, null, { timeout: 30000 });

    let audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(audio.enabled && audio.contextState === "running", `trusted entry should enable the complete audio mix; audio=${JSON.stringify(audio)}`);
    assert(audio.expectedAssets >= expectedAssets.length, `the browser manifest should include every local mansion sample; audio=${JSON.stringify(audio)}`);
    assert(audio.loadedAssets.length === audio.expectedAssets, `every declared mansion sample should decode; audio=${JSON.stringify(audio)}`);
    assert(audio.failedAssets.length === 0 && audio.pendingAssets.length === 0, `all local mansion samples should decode; audio=${JSON.stringify(audio)}`);
    assert(audio.rain.mode === "recorded" && audio.rain.layers >= 2, `rain should use a layered recorded mix; rain=${JSON.stringify(audio.rain)}`);
    assert(audio.thunder.mode === "recorded-ready", `recorded thunder should be ready; thunder=${JSON.stringify(audio.thunder)}`);

    const bookOpenBefore = audio.cueCounts.bookOpen || 0;
    await page.evaluate(() => window.MrFeastFresh.openReadableBookForQA(0));
    await waitForCue(page, "bookOpen", bookOpenBefore);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    const bookCloseBefore = audio.cueCounts.bookClose || 0;
    await page.evaluate(() => window.MrFeastFresh.closeReadableBookForQA());
    await waitForCue(page, "bookClose", bookCloseBefore);

    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    const lightBefore = audio.cueCounts.lightSwitch || 0;
    await page.evaluate(() => window.MrFeastFresh.toggleCircuit("library"));
    await waitForCue(page, "lightSwitch", lightBefore);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    const doorBefore = audio.cueCounts.doorOpen || 0;
    await page.evaluate(() => window.MrFeastFresh.setDoorForAudioQA("library door", true));
    await waitForCue(page, "doorOpen", doorBefore);

    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    const woodBefore = audio.footsteps.count;
    await moveForward(page, 1.3);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(audio.footsteps.count > woodBefore && audio.footsteps.lastSurface === "wood", `main-floor movement should emit wood footsteps; footsteps=${JSON.stringify(audio.footsteps)}`);
    const walkSteps = audio.footsteps.count - woodBefore;

    const stationaryBefore = audio.footsteps.count;
    await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.9));
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(audio.footsteps.count === stationaryBefore, `standing still should not emit footsteps; footsteps=${JSON.stringify(audio.footsteps)}`);

    const beforeBasementTeleport = audio.footsteps.count;
    await page.evaluate(() => window.MrFeastFresh.teleport("basement"));
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(audio.footsteps.count === beforeBasementTeleport, `teleporting should not emit a footstep; footsteps=${JSON.stringify(audio.footsteps)}`);
    const stoneBefore = audio.footsteps.count;
    await moveForward(page, 1.3);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(audio.footsteps.count > stoneBefore && audio.footsteps.lastSurface === "stone", `basement movement should emit stone footsteps; footsteps=${JSON.stringify(audio.footsteps)}`);

    await page.evaluate(() => window.MrFeastFresh.teleport("yardRearCirculationA"));
    const grassBefore = (await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA())).footsteps.count;
    await moveForward(page, 1.3);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(audio.footsteps.count > grassBefore && audio.footsteps.lastSurface === "grass", `lawn movement should emit grass footsteps; footsteps=${JSON.stringify(audio.footsteps)}`);

    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    await page.keyboard.press("c");
    const crouchBefore = (await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA())).footsteps.count;
    await moveForward(page, 1.3);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    const crouchSteps = audio.footsteps.count - crouchBefore;
    assert(crouchSteps > 0 && crouchSteps < walkSteps, `crouching should use a slower step cadence than walking; walk=${walkSteps}, crouch=${crouchSteps}`);
    await page.keyboard.press("c");

    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    const sprintBefore = (await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA())).footsteps.count;
    await moveForward(page, 1.3, { sprint: true });
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    const sprintSteps = audio.footsteps.count - sprintBefore;
    assert(sprintSteps > walkSteps, `sprinting should use a faster step cadence than walking; walk=${walkSteps}, sprint=${sprintSteps}`);

    await page.keyboard.press("Escape");
    const pausedBefore = audio.footsteps.count;
    await moveForward(page, 0.9);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(audio.footsteps.count === pausedBefore, `paused movement should not emit footsteps; footsteps=${JSON.stringify(audio.footsteps)}`);
    await page.keyboard.press("Escape");

    await page.evaluate(() => window.MrFeastFresh.setCameraPlayerHiddenForQA(true));
    const hiddenBefore = audio.footsteps.count;
    await moveForward(page, 0.9);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(audio.footsteps.count === hiddenBefore, `hidden movement should not emit footsteps; footsteps=${JSON.stringify(audio.footsteps)}`);
    await page.evaluate(() => window.MrFeastFresh.setCameraPlayerHiddenForQA(false));

    const thunderBefore = audio.cueCounts.thunder || 0;
    await page.evaluate(() => window.MrFeastFresh.playAudioCueForQA("thunder"));
    await waitForCue(page, "thunder", thunderBefore);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(audio.thunder.playCount > 0 && audio.thunder.lastDelay >= 0, `recorded thunder playback should be observable; thunder=${JSON.stringify(audio.thunder)}`);

    const countsBeforeMute = { ...audio.cueCounts };
    await page.keyboard.press("m");
    assert(!(await diagnostics(page)).audio.enabled, "M should mute the whole mansion mix");
    await page.evaluate(() => window.MrFeastFresh.openReadableBookForQA(1));
    await page.waitForTimeout(150);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert((audio.cueCounts.bookOpen || 0) === (countsBeforeMute.bookOpen || 0), "muted interactions should not schedule new audible cues");
    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);

    // The longer concrete track is an enhancement, not a single point of
    // failure for the already-shipped recorded rain bed. Simulate a missing
    // detail file and prove the base MP3 remains the active recorded layer.
    await page.close();
    const fallbackPage = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const fallbackErrors = [];
    fallbackPage.on("pageerror", (error) => fallbackErrors.push(error.message));
    await fallbackPage.route("**/rain-concrete.ogg", (route) => route.fulfill({ status: 404, body: "missing for QA" }));
    await fallbackPage.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&frame=1`, { waitUntil: "domcontentloaded" });
    await fallbackPage.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await fallbackPage.locator("#mansion-enter").click();
    await fallbackPage.waitForFunction(() => {
      const rain = window.MrFeastFresh?.getAudioStateForQA?.().rain;
      return rain?.mode === "recorded" && rain.layers === 1;
    }, null, { timeout: 30000 });
    const fallbackAudio = await fallbackPage.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    assert(fallbackAudio.rain.baseReady && !fallbackAudio.rain.detailReady, `base recorded rain should survive a missing detail layer; rain=${JSON.stringify(fallbackAudio.rain)}`);
    assert(fallbackAudio.failedAssets.some((entry) => /rain-concrete\.ogg$/.test(entry.path)), `missing optional rain detail should be diagnosed; audio=${JSON.stringify(fallbackAudio)}`);
    assert(fallbackErrors.length === 0, `rain fallback browser errors: ${fallbackErrors.join(" | ")}`);
    await fallbackPage.close();
    console.log("Mr. Feast audio upgrade browser test: layered rain, recorded thunder, material footsteps, interaction foley, mute, provenance, and one-layer recorded-rain fallback passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast audio upgrade browser test failed: ${error.message}`);
  process.exitCode = 1;
});
