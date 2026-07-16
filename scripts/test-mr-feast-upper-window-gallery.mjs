import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_GALLERY_TEST_PORT || (49000 + (process.pid % 12000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-upper-window-gallery");

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

async function run() {
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
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });

    await page.evaluate(() => window.MrFeastFresh.teleport("overlookDown"));
    await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.1));
    let state = await diagnostics(page);
    assert(state.floor === "SECOND FLOOR" && state.room === "FOYER BALCONY" && state.player.grounded, `gallery edge probe should begin grounded upstairs; state=${JSON.stringify({ floor: state.floor, room: state.room, player: state.player })}`);
    const fallRecoveriesBefore = state.physics.fallRecoveries;
    await page.keyboard.down("w");
    for (let step = 0; step < 30; step += 1) {
      await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.1));
    }
    await page.keyboard.up("w");
    state = await diagnostics(page);
    assert(state.floor === "SECOND FLOOR" && state.room === "FOYER BALCONY" && state.player.grounded && state.player.feetY > 4.3, `physical gallery guard should stop a forward walk at the upper edge; state=${JSON.stringify({ floor: state.floor, room: state.room, player: state.player, physics: state.physics })}`);
    assert(state.physics.fallRecoveries === fallRecoveriesBefore, `gallery edge guard should prevent any recovery teleport; physics=${JSON.stringify(state.physics)}`);

    const gallery = state.upperWindowGallery;
    assert(gallery && gallery.depth >= 1.6 && gallery.usableDepth >= 1.4, `gallery diagnostics should expose comfortable deck clearance; gallery=${JSON.stringify(gallery)}`);
    assert(gallery.guard.height >= 0.9 && gallery.guard.span >= 6.8 && gallery.guard.collider, `gallery diagnostics should expose the full physical railing; gallery=${JSON.stringify(gallery)}`);
    assert(Math.abs(gallery.patrolZ - gallery.centerZ) < 0.01, `Mr. Feast should use the gallery centerline; gallery=${JSON.stringify(gallery)}`);
    await page.waitForFunction(() => window.MrFeastFresh?.getMrFeastState?.().loaded, null, { timeout: 120000 });
    const mrFeastGalleryProbe = await page.evaluate(() => window.MrFeastFresh.runMrFeastLocomotionProbeForQA({
      sourceId: "upper-east-rail",
      targetId: "upper-front-crosswalk",
      seconds: 6.5,
      settleSeconds: 0.5,
    }));
    const mrFeastMovingSamples = mrFeastGalleryProbe.samples.filter((sample) => sample.distance > 0.00001);
    assert(!mrFeastGalleryProbe.error && mrFeastMovingSamples.length > 300, `Mr. Feast should traverse the real east-to-center gallery segment; probe=${JSON.stringify({ error: mrFeastGalleryProbe.error, samples: mrFeastGalleryProbe.samples.length, moving: mrFeastMovingSamples.length })}`);
    assert(mrFeastMovingSamples.every((sample) => Math.abs(sample.root.y - 4.5) < 0.03 && Math.abs(sample.root.z - gallery.patrolZ) < 0.04), `Mr. Feast should remain centered and grounded on the widened gallery; probe=${JSON.stringify(mrFeastGalleryProbe.qaLastLocomotionProbe || { first: mrFeastMovingSamples[0]?.root, last: mrFeastMovingSamples.at(-1)?.root })}`);

    await page.evaluate(() => window.MrFeastFresh.teleport("overlookDown"));
    await page.waitForTimeout(300);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "upper-window-gallery-overlook.png") });
    await page.evaluate(() => window.MrFeastFresh.teleport("upperWindowGallerySide"));
    await page.waitForTimeout(300);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "upper-window-gallery-side.png") });

    await page.evaluate(() => window.MrFeastFresh.runRoute("upperBalconyLoop"));
    await page.waitForFunction(() => {
      const route = JSON.parse(window.render_game_to_text()).qaRoute;
      return route && route.name === "upperBalconyLoop" && route.status !== "running";
    }, null, { timeout: 30000 });
    state = await diagnostics(page);
    assert(state.qaRoute.status === "complete" && state.qaRoute.fallRecoveryDelta === 0 && state.qaRoute.circuitStatesUnchanged, `full balcony loop should remain grounded and light-stable; route=${JSON.stringify(state.qaRoute)}`);

    await page.evaluate(() => window.MrFeastFresh.teleport("upperWindowGalleryFoyer"));
    await page.waitForTimeout(300);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "upper-window-gallery-foyer.png") });
    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast upper window gallery browser test: physical guard, layout diagnostics, balcony loop, and foyer framing passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast upper window gallery browser test failed: ${error.message}`);
  process.exitCode = 1;
});
