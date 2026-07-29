import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

/**
 * Breath Stealth was removed from free-roam / escape gameplay. This suite now
 * only proves the feature stays disabled while Captured-at-Dinner banquet
 * panic breathing remains a separate banquet-owned path.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_BREATH_STEALTH_TEST_PORT || (54000 + (process.pid % 8000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;

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

async function assertSourceContract() {
  const [runtime, html] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);
  assert(/const BREATH_STEALTH\s*=\s*Object\.freeze/.test(runtime), "missing named BREATH_STEALTH table");
  assert(/enabled:\s*false/.test(runtime), "gameplay breath stealth must remain explicitly disabled");
  assert(/class BreathStealthSystem/.test(runtime), "BreathStealthSystem should remain as a disabled stub for save/QA compatibility");
  assert(/BANQUET_LOSS[\s\S]*breathing:\s*Object\.freeze/.test(runtime), "captured-at-dinner panic breathing must stay banquet-owned");
  assert(/startBanquetBreathing|playBanquetBreath|updateBanquetBreathing/.test(runtime), "banquet panic breath methods must remain");
  assert(
    runtime.includes('const MANSION_RUNTIME_VERSION = "20260729-remove-gameplay-breath-1"')
      && html.includes("mr-feast-mansion.js?v=20260729-remove-gameplay-breath-1"),
    "page and runtime cache identities must agree after removing gameplay breath",
  );
  assert(!/<kbd>Space<\/kbd>\s*hold breath/i.test(html), "desktop guide must not advertise hold-breath");
  assert(
    !/event\.code === "Space"[\s\S]{0,120}setHolding\(true/.test(runtime),
    "Space must no longer arm gameplay breath hold",
  );
}

async function run() {
  let server = null;
  let browser = null;
  await assertSourceContract();
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => {
    throw new Error(`browser pageerror: ${error.message}`);
  });
  await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 180000 });
  await page.waitForFunction(() => Boolean(window.MrFeastFresh?.getBreathStealthState), null, { timeout: 60000 });

  const probe = await page.evaluate(() => {
    const hold = window.MrFeastFresh.holdBreathForQA(true);
    const emit = window.MrFeastFresh.emitPlayerBreathForQA("heavy");
    window.MrFeastFresh.setBreathAggroForQA(true);
    window.MrFeastFresh.setPlayerEnergyForQA(0);
    window.MrFeastFresh.advanceBreathStealthForQA?.(1.5);
    const state = window.MrFeastFresh.getBreathStealthState();
    const breathHidden = document.getElementById("mansion-breath")?.hidden !== false;
    const touchHidden = document.getElementById("touch-breath")?.hidden !== false;
    return { hold, emit, state, breathHidden, touchHidden };
  });

  assert(probe.state?.enabled === false, `breath stealth diagnostics must report disabled: ${JSON.stringify(probe.state)}`);
  assert(!probe.hold?.holding && probe.hold?.reason === "disabled", `hold must be refused: ${JSON.stringify(probe.hold)}`);
  assert(!probe.emit?.emitted && probe.emit?.reason === "disabled", `emit must be refused: ${JSON.stringify(probe.emit)}`);
  assert(probe.state?.tier === "silent" && !probe.state?.audible && !probe.state?.holding, `runtime breath state must stay silent: ${JSON.stringify(probe.state)}`);
  assert(probe.breathHidden && probe.touchHidden, "breath HUD and touch control must stay hidden");

  console.log("Mr. Feast breath stealth retirement: gameplay disabled; banquet path preserved in source.");
  await browser.close();
  if (server) server.kill("SIGTERM");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
