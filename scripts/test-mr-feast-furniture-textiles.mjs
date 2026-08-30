import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_FURNITURE_TEST_PORT || (36000 + (process.pid % 12000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-furniture-textiles");

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

async function captureView(page, viewName, fileName) {
  const staged = await page.evaluate((name) => window.MrFeastFresh.teleport(name), viewName);
  assert(staged, `QA view ${viewName} should exist`);
  await page.waitForTimeout(350);
  const clip = await page.locator("#mansion-stage").boundingBox();
  assert(clip?.width > 0 && clip?.height > 0, `cannot capture ${fileName}: stage has no bounds`);
  await page.screenshot({ path: path.join(artifactDir, fileName), clip });
}

async function run() {
  const [runtime, html] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  // Red-first source contract: all three furniture families use a small
  // shared set of procedural textile maps rather than more geometry.
  assert(/const FURNITURE_TEXTILES = Object\.freeze\(\{/.test(runtime), "missing named FURNITURE_TEXTILES tuning table");
  assert(/function makeFurnitureTextileTexture\(kind/.test(runtime), "missing procedural furniture textile generator");
  assert(/getFurnitureTextileState/.test(runtime), "missing furniture textile diagnostics");
  for (const materialName of ["sofaForest", "sofaOxblood", "chairUpholstery", "bedLinen", "bedCoverlet", "bedHeadboard"]) {
    assert(runtime.includes(`${materialName}:`), `missing ${materialName} material`);
  }

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
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const sourceUrl = message.location().url || "";
      if (message.type() === "error" && !/favicon\.ico/i.test(`${message.text()} ${sourceUrl}`)) errors.push(message.text());
    });
    await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.waitForTimeout(500);

    const textiles = await page.evaluate(() => window.MrFeastFresh.getFurnitureTextileState());
    assert(textiles?.textureCount === 4, `expected four shared textile maps: ${JSON.stringify(textiles)}`);
    assert(textiles.shaderLightsAdded === 0 && textiles.geometryAdded === 0, `texture polish must not add lights or geometry: ${JSON.stringify(textiles)}`);
    assert(textiles.materials.length === 6, `expected six role-specific materials: ${JSON.stringify(textiles)}`);
    assert(textiles.materials.every((entry) => entry.hasMap && entry.hasBumpMap && entry.srgb && entry.repeatX >= 1 && entry.repeatY >= 1), `every furniture textile needs a repeating sRGB map and bump: ${JSON.stringify(textiles.materials)}`);
    assert(textiles.meshCounts.sofa >= 20, `sofa upholstery should use the new maps: ${JSON.stringify(textiles.meshCounts)}`);
    assert(textiles.meshCounts.chair >= 20, `chair upholstery should use the new maps: ${JSON.stringify(textiles.meshCounts)}`);
    assert(textiles.meshCounts.bed >= 20, `bed linen, coverlets, pillows, and headboards should use the new maps: ${JSON.stringify(textiles.meshCounts)}`);
    assert(textiles.unmappedFurnitureMeshes.length === 0, `furniture textile meshes should not retain flat-color placeholders: ${JSON.stringify(textiles.unmappedFurnitureMeshes)}`);

    await captureView(page, "libraryA", "library-sofa-textile-desktop.png");
    await captureView(page, "diningA", "dining-chair-textile-desktop.png");
    await captureView(page, "westFrontSuiteA", "upper-bed-textiles-desktop.png");
    await context.close();

    assert(errors.length === 0, `unexpected browser errors: ${errors.join(" | ")}`);
    const runtimeVersion = runtime.match(/MANSION_RUNTIME_VERSION = "([^"]+)"/)?.[1] || "";
    assert(html.includes(`mr-feast-mansion.js?v=${runtimeVersion}`), `page/runtime cache identities differ: ${runtimeVersion}`);
    console.log("Mr. Feast furniture textile acceptance passed: shared procedural maps, mapped couch/chair/bed surfaces, zero added geometry/lights, and three real-browser views verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
