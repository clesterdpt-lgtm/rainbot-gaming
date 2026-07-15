import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const gamePath = path.join(root, "assets/js/big-baby-bum.js");
const pagePath = path.join(root, "games/big-baby-bum.html");
const outputDir = path.join(root, "output/playwright/big-baby-bum-visual-pass");
const gameSource = fs.readFileSync(gamePath, "utf8");
const pageSource = fs.readFileSync(pagePath, "utf8");
const failures = [];
const results = {};

fs.mkdirSync(outputDir, { recursive: true });

function check(requirement, condition, detail) {
  let passed = false;
  try {
    passed = typeof condition === "function" ? Boolean(condition()) : Boolean(condition);
  } catch (error) {
    detail = `${detail} (${error.message})`;
  }
  if (!passed) failures.push({ requirement, detail });
}

function pngDimensions(bytes) {
  const signature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== signature || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const generatedAssets = [
  "assets/textures/big-baby-bum/grass-clover-generated-v2.png",
  "assets/textures/big-baby-bum/gingham-generated-v2.png",
  "assets/textures/big-baby-bum/cedar-generated-v1.png",
  "assets/textures/big-baby-bum/asphalt-generated-v1.png",
];

let totalTextureBytes = 0;
for (const relativePath of generatedAssets) {
  const absolutePath = path.join(root, relativePath);
  const bytes = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath) : Buffer.alloc(0);
  const dimensions = bytes.length ? pngDimensions(bytes) : null;
  totalTextureBytes += bytes.length;
  check("generated texture exists", bytes.length > 0, `${relativePath} is missing or empty`);
  check("generated texture dimensions", dimensions?.width === 512 && dimensions?.height === 512, `${relativePath} must be a valid 512x512 PNG`);
  check("generated texture budget", bytes.length <= 700 * 1024, `${relativePath} exceeds the 700 KiB per-texture budget`);
}
check("generated texture bundle budget", totalTextureBytes <= 2.25 * 1024 * 1024, `generated texture bundle is ${(totalTextureBytes / 1024 / 1024).toFixed(2)} MiB`);

for (const marker of [
  "bbb_hero_baby_v2",
  "bbb_critter_v2",
  "bbb_person_v2",
  "bbb_vehicle_v2",
  "bbb_broadleaf_tree_v2",
  "bbb_building_${kind}_v2",
  "bbb_cedar_fence_v2",
]) {
  check("model upgrade marker", gameSource.includes(marker), `missing ${marker}`);
}
check("generated PBR materials", /bumpMap:\s*grassTex/.test(gameSource) && /bumpMap:\s*woodTex/.test(gameSource) && /bumpMap:\s*roadTex/.test(gameSource), "generated textures are not wired into the PBR material pass");
check("performance batching", /new T\.InstancedMesh/.test(gameSource) && /fence_pickets/.test(gameSource) && /vehicle_wheels/.test(gameSource), "repeated model details are not instanced");
check("renderer art direction", /ACESFilmicToneMapping/.test(gameSource) && /PCFSoftShadowMap/.test(gameSource) && /bbb_storybook_sky/.test(gameSource), "premium lighting, shadows, or sky setup is missing");
check("visual cache token", pageSource.includes("20260714-bbb-visual-v2"), "page does not reference the current visual-pass cache token");

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const decodedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const absolutePath = path.resolve(root, `.${decodedPath}`);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(absolutePath, (error, body) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": mime[path.extname(absolutePath).toLowerCase()] || "application/octet-stream" });
    response.end(body);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const target = `${origin}/games/big-baby-bum.html`;
let browser;

function watchPage(page, label, issues) {
  page.on("console", (message) => {
    const text = message.text();
    const benignScreenshotStall = message.type() === "warning" && /GL Driver Message.*GPU stall due to ReadPixels/.test(text);
    if (["error", "warning"].includes(message.type()) && !benignScreenshotStall) issues.push(`${label} console ${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => issues.push(`${label} page error: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(origin)) issues.push(`${label} request failed: ${request.url()} (${request.failure()?.errorText || "unknown"})`);
  });
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) issues.push(`${label} HTTP ${response.status()}: ${response.url()}`);
  });
}

try {
  browser = await chromium.launch({ headless: true });
  const issues = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
  });
  const page = await context.newPage();
  watchPage(page, "desktop", issues);
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__BBB?.state && window.__BBB?.three?.renderer, null, { timeout: 15_000 });
  await page.getByRole("button", { name: /new adventure/i }).click();
  await page.waitForFunction(() => window.__BBB?.state?.phase === "play", null, { timeout: 5_000 });
  await page.waitForFunction(() => {
    const found = new Map();
    window.__BBB.three.scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials.filter(Boolean)) {
        if (material.map?.name?.startsWith("bbb_generated_")) found.set(material.map.name, material.map.image);
      }
    });
    return found.size >= 4 && [...found.values()].every((image) => image?.width === 512 && image?.height === 512);
  }, null, { timeout: 10_000 });

  const initial = await page.evaluate(() => {
    const textureNames = new Set();
    let heroMeshes = 0;
    window.__BBB.three.scene.traverse((object) => {
      if (object.isMesh && object.parent === window.__BBB.three.hero) heroMeshes += 1;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials.filter(Boolean)) if (material.map?.name?.startsWith("bbb_generated_")) textureNames.add(material.map.name);
    });
    return { ...window.__BBB.state, textureNames: [...textureNames], heroMeshes };
  });
  results.initial = initial;
  check("fresh game state", initial.phase === "play" && Math.abs(initial.size - 0.35) < 0.01, `unexpected initial state ${JSON.stringify(initial)}`);
  check("hero model version", initial.heroModel === 2, `expected hero model v2, got ${initial.heroModel}`);
  check("generated textures loaded", initial.textureNames.length >= 4, `only ${initial.textureNames.length} generated textures reached rendered materials`);
  check("desktop performance", initial.drawCalls > 0 && initial.drawCalls < 950 && initial.triangles < 60_000, `initial render cost is ${initial.drawCalls} calls / ${initial.triangles} triangles`);

  const beforeMove = await page.evaluate(() => ({ x: window.__BBB.state.x, z: window.__BBB.state.z }));
  await page.locator("#gameCanvas").focus();
  await page.keyboard.down("w");
  await page.waitForTimeout(1_250);
  await page.keyboard.up("w");
  await page.waitForTimeout(2_600);
  const afterMove = await page.evaluate(() => ({ x: window.__BBB.state.x, z: window.__BBB.state.z }));
  check("keyboard movement", Math.hypot(afterMove.x - beforeMove.x, afterMove.z - beforeMove.z) > 0.15, "W input did not move the baby");
  await page.locator(".game-stage").screenshot({ path: path.join(outputDir, "final-desktop-backyard.png") });

  await page.evaluate(() => {
    window.__BBB.setSize(7.5);
    window.__BBB.teleport(40, 40);
    window.__BBB.step(8);
  });
  await page.waitForTimeout(3_200);
  const city = await page.evaluate(() => {
    const names = new Set();
    const styles = new Set();
    let v2Groups = 0;
    let instancedMeshes = 0;
    let standardMaterials = 0;
    window.__BBB.three.scene.traverse((object) => {
      if (object.name) names.add(object.name);
      if (object.userData?.modelVersion === 2) v2Groups += 1;
      if (object.userData?.buildingStyle) styles.add(object.userData.buildingStyle);
      if (object.isInstancedMesh) instancedMeshes += 1;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      standardMaterials += materials.filter((material) => material?.isMeshStandardMaterial).length;
    });
    return { ...window.__BBB.state, names: [...names], styles: [...styles], v2Groups, instancedMeshes, standardMaterials };
  });
  results.city = city;
  check("rolling growth stage", city.rolling && city.roundness === 1 && city.size > 6, `city probe did not reach the rolling stage: ${JSON.stringify(city)}`);
  check("upgraded city models", city.names.some((name) => name.startsWith("bbb_building_")) && city.names.includes("bbb_vehicle_v2"), "upgraded buildings or vehicles were absent from the active city scene");
  check("runtime batching", city.instancedMeshes >= 8, `only ${city.instancedMeshes} instanced batches are active`);
  check("PBR scene materials", city.standardMaterials >= 20, `only ${city.standardMaterials} standard-material bindings are active`);
  check("city performance", city.drawCalls > 0 && city.drawCalls < 850 && city.triangles < 60_000, `city render cost is ${city.drawCalls} calls / ${city.triangles} triangles`);
  await page.locator(".game-stage").screenshot({ path: path.join(outputDir, "final-desktop-city.png") });

  const effects = await page.evaluate(() => {
    window.__BBB.spawnEnemy("police", 12);
    window.__BBB.pukeNow(0.8);
    window.__BBB.burp();
    return window.__BBB.step(8);
  });
  results.effects = effects;
  check("hazard and hunter effects", effects.enemies >= 1 && effects.gas >= 1, `scripted visual effects did not activate: ${JSON.stringify(effects)}`);

  await page.locator("#btn-pause").click();
  check("pause control", (await page.evaluate(() => window.__BBB.state.phase)) === "paused", "pause button did not pause the game");
  await page.locator("#btn-pause").click();
  check("resume control", (await page.evaluate(() => window.__BBB.state.phase)) === "play", "pause button did not resume the game");
  await page.locator("#btn-restart").click();
  await page.waitForTimeout(300);
  const restarted = await page.evaluate(() => window.__BBB.state);
  check("restart control", restarted.phase === "play" && Math.abs(restarted.size - 0.35) < 0.01 && restarted.score === 0, `restart state is ${JSON.stringify(restarted)}`);
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await mobileContext.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
  });
  const mobile = await mobileContext.newPage();
  watchPage(mobile, "mobile", issues);
  await mobile.goto(target, { waitUntil: "domcontentloaded" });
  await mobile.waitForFunction(() => window.__BBB?.state && window.__BBB?.three?.renderer, null, { timeout: 15_000 });
  await mobile.getByRole("button", { name: /new adventure/i }).click();
  await mobile.waitForFunction(() => window.__BBB?.state?.phase === "play", null, { timeout: 5_000 });
  await mobile.waitForTimeout(3_500);
  const mobileLayout = await mobile.evaluate(() => {
    const rect = (selector) => {
      const bounds = document.querySelector(selector)?.getBoundingClientRect();
      return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      canvas: rect("#gameCanvas"),
      pause: rect("#btn-pause"),
      restart: rect("#btn-restart"),
      sound: rect("#btn-sound"),
      state: window.__BBB.state,
    };
  });
  results.mobile = mobileLayout;
  check("mobile canvas", mobileLayout.canvas?.width >= 350 && mobileLayout.canvas?.width <= 390 && mobileLayout.canvas?.height >= 220, `mobile canvas bounds are ${JSON.stringify(mobileLayout.canvas)}`);
  check("mobile controls", [mobileLayout.pause, mobileLayout.restart, mobileLayout.sound].every((button) => button && button.height >= 44 && button.width < 120), `mobile controls are not compact 44px targets: ${JSON.stringify(mobileLayout)}`);
  check("mobile performance", mobileLayout.state.drawCalls > 0 && mobileLayout.state.drawCalls < 950, `mobile render uses ${mobileLayout.state.drawCalls} draw calls`);
  await mobile.screenshot({ path: path.join(outputDir, "final-mobile-390x844.png"), fullPage: true });
  await mobileContext.close();

  check("browser console and network", issues.length === 0, issues.join(" | ") || "unexpected browser issue");
  fs.writeFileSync(path.join(outputDir, "visual-regression-results.json"), `${JSON.stringify({ generatedTextureBytes: totalTextureBytes, issues, results }, null, 2)}\n`);
} catch (error) {
  failures.push({ requirement: "browser regression completed", detail: error.stack || error.message });
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error(`Big Baby Bum visual regression: ${failures.length} unmet invariant${failures.length === 1 ? "" : "s"}`);
  failures.forEach((failure, index) => console.error(`${String(index + 1).padStart(2, "0")}. [${failure.requirement}] ${failure.detail}`));
  process.exitCode = 1;
} else {
  console.log("Big Baby Bum visual regression: all visual, model, performance, desktop, and mobile invariants passed");
  console.log(`Initial: ${results.initial.drawCalls} calls / ${results.initial.triangles} triangles`);
  console.log(`City: ${results.city.drawCalls} calls / ${results.city.triangles} triangles`);
  console.log(`Generated textures: ${(totalTextureBytes / 1024 / 1024).toFixed(2)} MiB`);
}
