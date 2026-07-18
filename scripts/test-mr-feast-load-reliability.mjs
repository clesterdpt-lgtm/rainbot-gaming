import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_LOAD_TEST_PORT || (54000 + (process.pid % 10000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gamePath = "/games/mr-feast-mansion.html";
const artifactDir = path.join(root, "output", "playwright", "mr-feast-load-reliability");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function serverResponds() {
  try {
    return (await fetch(`${baseUrl}${gamePath}`, { cache: "no-store" })).ok;
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
    if (message.type() === "error" && !/favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text())) {
      errors.push(message.text());
    }
  });
}

async function observeStartup(page, navigation, { bootOnly = false } = {}) {
  await page.waitForFunction(
    (runtimeRequired) => window.__MR_FEAST_BOOT__ && (!runtimeRequired || window.MrFeastFresh?.state),
    !bootOnly,
    { timeout: 10000 },
  );
  const transitions = [];
  let previous = "";
  let sawFailure = false;
  for (let attempt = 0; attempt < 2400; attempt += 1) {
    const snapshot = await page.evaluate(() => ({
      bootStatus: window.__MR_FEAST_BOOT__?.status || null,
      ready: Boolean(window.MrFeastFresh?.state?.ready),
      loadFailed: Boolean(window.MrFeastFresh?.state?.loadFailed),
      startupPhase: window.MrFeastFresh?.state?.startupPhase || null,
      button: document.getElementById("mansion-enter")?.textContent || null,
    }));
    const serialized = JSON.stringify(snapshot);
    if (serialized !== previous) transitions.push(snapshot);
    previous = serialized;
    if (snapshot.bootStatus === "failed" || snapshot.loadFailed || snapshot.button === "Retry loading") {
      sawFailure = true;
    }
    if (snapshot.ready) break;
    await delay(25);
  }
  await navigation;
  return { transitions, sawFailure };
}

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function run() {
  const [pageSource, runtimeSource] = await Promise.all([
    readFile(path.join(root, "games", "mr-feast-mansion.html"), "utf8"),
    readFile(path.join(root, "assets", "js", "mr-feast-mansion.js"), "utf8"),
  ]);

  // Red-first contracts: cold downloads get a generous page-owned window,
  // while runtime progress turns initialization protection into an inactivity
  // watchdog instead of a fixed total-duration deadline.
  const pageStallTimeout = Number(pageSource.match(/const BOOT_STALL_TIMEOUT_MS\s*=\s*(\d+)/)?.[1]);
  const runtimeStallTimeout = Number(runtimeSource.match(/const STARTUP_STALL_TIMEOUT_MS\s*=\s*(\d+)/)?.[1]);
  assert(pageStallTimeout >= 45000, `page boot watchdog is still too short for a cold runtime download: ${pageStallTimeout || "missing"}ms`);
  assert(runtimeStallTimeout >= 30000, `runtime startup watchdog is still too short for cold mansion assets: ${runtimeStallTimeout || "missing"}ms`);
  assert(/progress\(phase, percent\)[\s\S]*?armTimer\(\)/.test(pageSource), "page boot handshake does not refresh its timer when runtime progress arrives");
  assert(/function noteStartupActivity\([\s\S]*?boot\?\.progress/.test(runtimeSource), "runtime does not report startup activity to the page shell");
  assert(/function setLoading\([\s\S]*?noteStartupActivity\(\)/.test(runtimeSource), "loading phases do not refresh the runtime inactivity watchdog");
  assert(/function loadEstateStatueGltf\([\s\S]*?noteStartupActivity\(\)/.test(runtimeSource), "large estate-statue transfers do not keep the startup watchdog alive");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });

    // Simulate the reported first-load race without making the suite wait 18
    // seconds: only the legacy 18s timer is compressed, while the cold core
    // script response remains healthy and arrives just afterward.
    const coldContext = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    await coldContext.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, milliseconds, ...args) => (
        nativeSetTimeout(callback, milliseconds === 18000 ? 700 : milliseconds, ...args)
      );
    });
    const coldPage = await coldContext.newPage();
    const coldErrors = [];
    watchErrors(coldPage, coldErrors);
    await coldPage.route(/mr-feast-mansion\.js\?v=/, async (route) => {
      await delay(1000);
      await route.continue();
    });
    const coldNavigation = coldPage.goto(`${baseUrl}${gamePath}?qa=1&coldRuntime=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    const coldResult = await observeStartup(coldPage, coldNavigation, { bootOnly: true });
    assert(!coldResult.sawFailure, `healthy cold runtime download flashed a false retry state: ${JSON.stringify(coldResult.transitions)}`);
    const coldDiagnostics = await diagnostics(coldPage);
    assert(coldDiagnostics.ready && coldDiagnostics.startupPhase === "Ready", `cold runtime did not become ready: ${JSON.stringify(coldDiagnostics)}`);
    assert(coldErrors.length === 0, `cold runtime emitted browser errors: ${coldErrors.join(" | ")}`);
    await coldPage.screenshot({ path: path.join(artifactDir, "cold-runtime-ready.png"), fullPage: true });
    await coldContext.close();

    // Two individually healthy sub-second transfer gaps exceed the legacy
    // absolute 1s QA timeout only in aggregate. A progress-aware timer resets
    // between them and reaches Ready without ever exposing Retry loading.
    const progressPage = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const progressErrors = [];
    watchErrors(progressPage, progressErrors);
    await progressPage.route(/blue-damask-wallpaper-ai\.jpg/, async (route) => {
      await delay(650);
      await route.continue();
    });
    await progressPage.route(/assets\/models\/mr-feast\/statues\/.*\.glb/, async (route) => {
      await delay(650);
      await route.continue();
    });
    const progressNavigation = progressPage.goto(
      `${baseUrl}${gamePath}?qa=1&initTimeout=1000&progressProbe=${Date.now()}`,
      { waitUntil: "domcontentloaded", timeout: 120000 },
    );
    const progressResult = await observeStartup(progressPage, progressNavigation);
    assert(!progressResult.sawFailure, `healthy phased asset loading flashed a false retry state: ${JSON.stringify(progressResult.transitions)}`);
    const progressDiagnostics = await diagnostics(progressPage);
    assert(progressDiagnostics.ready && progressDiagnostics.startupPhase === "Ready", `progressive startup did not become ready: ${JSON.stringify(progressDiagnostics)}`);
    assert(progressErrors.length === 0, `progressive startup emitted browser errors: ${progressErrors.join(" | ")}`);
    await progressPage.screenshot({ path: path.join(artifactDir, "progressive-assets-ready.png"), fullPage: true });
    await progressPage.close();

    // A genuinely silent runtime still needs a visible recovery action.
    const stalledPage = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await stalledPage.goto(`${baseUrl}${gamePath}?qa=1&simulateHang=1&initTimeout=700`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await stalledPage.waitForFunction(() => (
      window.MrFeastFresh?.state?.loadFailed
      && document.getElementById("mansion-enter")?.textContent === "Retry loading"
    ), null, { timeout: 5000 });
    const stalled = await stalledPage.evaluate(() => ({
      ready: window.MrFeastFresh.state.ready,
      failed: window.MrFeastFresh.state.loadFailed,
      action: window.MrFeastFresh.state.failureAction,
      button: document.getElementById("mansion-enter").textContent,
    }));
    assert(!stalled.ready && stalled.failed && stalled.action === "retry", `true stall did not preserve recovery: ${JSON.stringify(stalled)}`);
    await stalledPage.close();

    console.log("Mr. Feast load reliability regression: all startup recovery checks passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
