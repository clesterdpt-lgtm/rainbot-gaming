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
  "bbb_enemy_territorial_goose_v1",
  "bbb_enemy_furious_babysitter_v1",
  "bbb_enemy_runaway_mower_v1",
  "bbb_enemy_diaper_drone_v1",
  "bbb_enemy_demolition_dozer_v1",
]) {
  check("model upgrade marker", gameSource.includes(marker), `missing ${marker}`);
}
check("generated PBR materials", /bumpMap:\s*grassTex/.test(gameSource) && /bumpMap:\s*woodTex/.test(gameSource) && /map:\s*roadIntersectionTex/.test(gameSource), "generated textures are not wired into the PBR material pass");
check("road bump shimmer removed", !/bumpMap:\s*roadTex/.test(gameSource), "painted curb and lane colors must not double as road height data");
check("road crossing ownership", gameSource.includes("bbb_road_intersections_v3") && /polygonOffsetUnits:\s*-4/.test(gameSource), "roads lack deterministic asphalt-only intersection caps");
check("roof geometry fix", gameSource.includes("bbb_gable_roof_geometry_v3") && gameSource.includes("bbb_roof_flat_v3"), "roof winding/gap fix markers are missing");
check("baby bib removed", !gameSource.includes("baby_bib") && !gameSource.includes("baby_generated_gingham_back_patch"), "bib or matching rear patch still exists in the hero source");
check("performance batching", /new T\.InstancedMesh/.test(gameSource) && /fence_pickets/.test(gameSource) && /vehicle_wheels/.test(gameSource), "repeated model details are not instanced");
check("renderer art direction", /ACESFilmicToneMapping/.test(gameSource) && /PCFSoftShadowMap/.test(gameSource) && /bbb_storybook_sky/.test(gameSource), "premium lighting, shadows, or sky setup is missing");
check("expanded attacker roster", /ENEMY_MAX_ACTIVE\s*=\s*4/.test(gameSource) && /function activeEnemyTpls/.test(gameSource), "mixed attacker roster or cap is missing");
check("visual cache token", pageSource.includes("20260714-bbb-roads-roofs-enemies-v3"), "page does not reference the current visual-pass cache token");

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
    const heroNames = [];
    const heroMaps = [];
    const sceneMaterials = [];
    const roadNames = [];
    const roadYs = [];
    let intersectionCount = 0;
    let intersectionOffset = 0;
    const roofTriangles = [];
    const flatRoofGaps = [];
    window.__BBB.three.hero.traverse((object) => {
      if (object.isMesh) heroMeshes += 1;
      if (object.name) heroNames.push(object.name);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials.filter(Boolean)) if (material.map?.name) heroMaps.push(material.map.name);
    });
    window.__BBB.three.scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials.filter(Boolean)) {
        if (material.map?.name?.startsWith("bbb_generated_")) textureNames.add(material.map.name);
        sceneMaterials.push({ name: material.name, map: material.map?.name || "" });
      }
      if (object.name?.startsWith("bbb_road_")) {
        roadNames.push(object.name);
        if (object.name !== "bbb_road_intersections_v3") roadYs.push(object.position.y);
      }
      if (object.name === "bbb_road_intersections_v3") {
        intersectionCount = object.count;
        intersectionOffset = object.material?.polygonOffsetUnits || 0;
      }
      if (object.name === "bbb_roof_gable_v3") {
        const position = object.geometry?.attributes?.position;
        const normal = object.geometry?.attributes?.normal;
        if (position && normal)
          for (let i = 0; i < position.count; i += 3)
            roofTriangles.push({
              allBase: [0, 1, 2].every((offset) => Math.abs(position.getY(i + offset)) < 1e-6),
              normalY: normal.getY(i),
              normalZ: normal.getZ(i),
            });
      }
      if (object.name === "bbb_roof_flat_v3") flatRoofGaps.push(object.userData?.baseAboveWall || 0);
    });
    return {
      ...window.__BBB.state,
      textureNames: [...textureNames],
      heroMeshes,
      heroNames,
      heroMaps,
      sceneMaterials,
      roadNames,
      roadYs,
      intersectionCount,
      intersectionOffset,
      roofTriangles,
      flatRoofGaps,
      enemyRoster: window.__BBB.enemyRoster(),
    };
  });
  results.initial = initial;
  check("fresh game state", initial.phase === "play" && Math.abs(initial.size - 0.35) < 0.01, `unexpected initial state ${JSON.stringify(initial)}`);
  check("hero model version", initial.heroModel === 2, `expected hero model v2, got ${initial.heroModel}`);
  check("generated textures loaded", initial.textureNames.length >= 4, `only ${initial.textureNames.length} generated textures reached rendered materials`);
  check("hero mesh traversal", initial.heroMeshes >= 17, `recursive hero traversal found only ${initial.heroMeshes} meshes`);
  check("baby pattern removal", !initial.heroNames.includes("baby_bib") && !initial.heroNames.includes("baby_generated_gingham_back_patch") && !initial.heroMaps.includes("bbb_generated_picnic_gingham"), `gingham remains on the hero: ${JSON.stringify({ names: initial.heroNames, maps: initial.heroMaps })}`);
  check("picnic gingham retained", initial.sceneMaterials.some(({ name, map }) => name === "bbb_picnic_gingham" && map === "bbb_generated_picnic_gingham"), "removing the baby pattern also removed the picnic blanket texture");
  check("complete road grid", initial.roadNames.filter((name) => name.startsWith("bbb_road_ns_")).length === 16 && initial.roadNames.filter((name) => name.startsWith("bbb_road_ew_")).length === 16 && initial.roadNames.includes("bbb_road_ew_150") && initial.roadNames.includes("bbb_road_ew_-150"), `road grid is incomplete: ${JSON.stringify(initial.roadNames)}`);
  check("road depth ownership", initial.roadYs.length === 32 && initial.roadYs.every((y) => Math.abs(y - initial.roadYs[0]) < 1e-6) && initial.intersectionCount === 256 && initial.intersectionOffset <= -4, `road planes/caps are not deterministic: ${JSON.stringify({ ys: initial.roadYs, count: initial.intersectionCount, offset: initial.intersectionOffset })}`);
  check("gable roof faces", initial.roofTriangles.length > 0 && initial.roofTriangles.every((triangle) => !triangle.allBase && triangle.normalY >= -1e-6) && initial.roofTriangles.some((triangle) => triangle.normalY > 0.2) && initial.roofTriangles.some((triangle) => triangle.normalZ > 0.5) && initial.roofTriangles.some((triangle) => triangle.normalZ < -0.5), `gable normals/caps are invalid: ${JSON.stringify(initial.roofTriangles)}`);
  check("attacker roster models", initial.enemyRoster.length === 9 && ["goose", "babysitter", "mower", "drone", "dozer"].every((key) => initial.enemyRoster.some((enemy) => enemy.key === key)), `attacker roster is ${JSON.stringify(initial.enemyRoster)}`);
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

  // Enemy placement remains random in the shipped game, but the regression
  // uses a fixed stream so required pack members and hit timing cannot flake.
  await page.evaluate(() => {
    let seed = 0x0bbb2026;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  });

  const earlyHunters = await page.evaluate(() => {
    window.__BBB.setSize(3);
    window.__BBB.teleport(40, 40);
    window.__BBB.step(360, 1 / 60);
    const modelNames = [];
    window.__BBB.three.scene.traverse((object) => {
      if (object.name?.startsWith("bbb_enemy_")) modelNames.push(object.name);
    });
    return { ...window.__BBB.state, status: window.__BBB.enemyStatus(), modelNames };
  });
  results.earlyHunters = earlyHunters;
  const earlyKeys = new Set(earlyHunters.status.filter((enemy) => enemy.state !== "retire").map((enemy) => enemy.key));
  check("early mixed attacker pack", earlyKeys.size >= 3 && earlyKeys.has("goose") && earlyHunters.activeEnemies <= 4, `early hunter state is ${JSON.stringify(earlyHunters)}`);
  check("attackers damage the baby", earlyHunters.enemyHitsTaken > 0 && earlyHunters.size < 3, `early hunters never landed a hit: ${JSON.stringify(earlyHunters)}`);
  check("new early enemy models", earlyHunters.modelNames.includes("bbb_enemy_territorial_goose_v1") && earlyHunters.modelNames.some((name) => name === "bbb_enemy_furious_babysitter_v1" || name === "bbb_enemy_angry_dad_v2"), `early enemy models are ${JSON.stringify(earlyHunters.modelNames)}`);

  await page.evaluate(() => {
    window.__BBB.setSize(7.5);
    window.__BBB.teleport(90, 90);
    window.__BBB.step(480, 1 / 60);
  });
  const city = await page.evaluate(() => {
    const names = new Set();
    const styles = new Set();
    let v2Groups = 0;
    let instancedMeshes = 0;
    let standardMaterials = 0;
    const flatRoofGaps = [];
    window.__BBB.three.scene.traverse((object) => {
      if (object.name) names.add(object.name);
      if (object.userData?.modelVersion === 2) v2Groups += 1;
      if (object.userData?.buildingStyle) styles.add(object.userData.buildingStyle);
      if (object.isInstancedMesh) instancedMeshes += 1;
      if (object.name === "bbb_roof_flat_v3") flatRoofGaps.push(object.userData?.baseAboveWall || 0);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      standardMaterials += materials.filter((material) => material?.isMeshStandardMaterial).length;
    });
    return { ...window.__BBB.state, names: [...names], styles: [...styles], v2Groups, instancedMeshes, standardMaterials, flatRoofGaps, enemyStatus: window.__BBB.enemyStatus() };
  });
  results.city = city;
  check("rolling growth stage", city.rolling && city.roundness === 1 && city.size > 6, `city probe did not reach the rolling stage: ${JSON.stringify(city)}`);
  check("upgraded city models", city.names.some((name) => name.startsWith("bbb_building_")) && city.names.includes("bbb_vehicle_v2"), "upgraded buildings or vehicles were absent from the active city scene");
  check("runtime batching", city.instancedMeshes >= 8, `only ${city.instancedMeshes} instanced batches are active`);
  check("PBR scene materials", city.standardMaterials >= 20, `only ${city.standardMaterials} standard-material bindings are active`);
  check("flat roof separation", city.flatRoofGaps.length > 0 && city.flatRoofGaps.every((gap) => gap >= 0.006), `flat roof gaps are ${JSON.stringify(city.flatRoofGaps)}`);
  check("midgame mixed attacker pack", ["mower", "police", "drone"].every((key) => city.enemyStatus.some((enemy) => enemy.key === key && enemy.state !== "retire")) && city.activeEnemies <= 4, `midgame hunter state is ${JSON.stringify(city.enemyStatus)}`);
  check("ranged enemy attacks", city.enemyShotsFired > 0 && city.names.includes("bbb_enemy_diaper_drone_v1"), `drone never fired or rendered: ${JSON.stringify({ shots: city.enemyShotsFired, names: city.names })}`);
  check("city performance", city.drawCalls > 0 && city.drawCalls < 850 && city.triangles < 60_000, `city render cost is ${city.drawCalls} calls / ${city.triangles} triangles`);
  await page.locator(".game-stage").screenshot({ path: path.join(outputDir, "final-desktop-city.png") });
  await page.locator("#gameCanvas").screenshot({ path: path.join(outputDir, "final-enemy-swarm.png") });

  const effects = await page.evaluate(() => {
    window.__BBB.spawnEnemy("police", 12);
    window.__BBB.pukeNow(0.8);
    window.__BBB.burp();
    return window.__BBB.step(8);
  });
  results.effects = effects;
  check("hazard and hunter effects", effects.enemies >= 1 && effects.gas >= 1, `scripted visual effects did not activate: ${JSON.stringify(effects)}`);

  const endgameHunters = await page.evaluate(() => {
    window.__BBB.setSize(20);
    window.__BBB.teleport(180, 180);
    window.__BBB.step(240, 1 / 60);
    const modelNames = [];
    window.__BBB.three.scene.traverse((object) => {
      if (object.name?.startsWith("bbb_enemy_")) modelNames.push(object.name);
    });
    return { ...window.__BBB.state, status: window.__BBB.enemyStatus(), modelNames };
  });
  results.endgameHunters = endgameHunters;
  check("endgame attacker pressure", endgameHunters.activeEnemies === 2 && endgameHunters.status.filter((enemy) => enemy.state !== "retire").every((enemy) => enemy.key === "dozer") && endgameHunters.modelNames.includes("bbb_enemy_demolition_dozer_v1"), `endgame hunter state is ${JSON.stringify(endgameHunters)}`);

  await page.locator("#btn-pause").click();
  check("pause control", (await page.evaluate(() => window.__BBB.state.phase)) === "paused", "pause button did not pause the game");
  await page.evaluate(() => {
    for (const selector of ["#overlay", "#bbb-banner", "#float-layer"]) {
      const element = document.querySelector(selector);
      if (element) element.style.visibility = "hidden";
    }
  });

  const canvasShot = async (filename) => page.locator("#gameCanvas").screenshot({ path: path.join(outputDir, filename) });
  const captureWorld = async (filename, eye, targetPoint) => {
    await page.evaluate(({ eye, targetPoint }) => {
      const { camera, renderer, scene, hero } = window.__BBB.three;
      hero.visible = false;
      camera.position.fromArray(eye);
      camera.lookAt(...targetPoint);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
    }, { eye, targetPoint });
    await canvasShot(filename);
  };
  const captureRoof = async (filename, name, side) => {
    const captured = await page.evaluate(({ name, side }) => {
      const { camera, renderer, scene, hero } = window.__BBB.three;
      let roof = null;
      scene.traverse((object) => {
        if (!roof && object.name === name && object.visible) roof = object;
      });
      if (!roof) return false;
      hero.visible = false;
      const box = new THREE.Box3().setFromObject(roof);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const distance = Math.max(size.x, size.y, size.z, 8) * 2.25;
      if (side === "front") camera.position.set(center.x + size.x * 0.22, center.y + distance * 0.58, center.z + distance);
      else if (side === "rear") camera.position.set(center.x - size.x * 0.22, center.y + distance * 0.58, center.z - distance);
      else camera.position.set(center.x + distance * 0.72, center.y + distance * 0.62, center.z + distance * 0.72);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      return true;
    }, { name, side });
    check("roof capture target", captured, `${name} was not active for ${filename}`);
    if (captured) await canvasShot(filename);
  };

  await captureWorld("final-road-residential-intersection.png", [55, 29, 55], [30, 0, 30]);
  await captureWorld("final-road-main-avenue.png", [55, 31, -118], [30, 0, -150]);
  await captureWorld("final-road-positive-150.png", [55, 31, 182], [30, 0, 150]);
  await captureRoof("final-roof-gable-front.png", "bbb_roof_gable_v3", "front");
  await captureRoof("final-roof-gable-rear.png", "bbb_roof_gable_v3", "rear");
  await captureRoof("final-roof-flat-oblique.png", "bbb_roof_flat_v3", "oblique");
  await page.evaluate(() => {
    window.__BBB.three.hero.visible = true;
    for (const selector of ["#overlay", "#bbb-banner", "#float-layer"]) {
      const element = document.querySelector(selector);
      if (element) element.style.removeProperty("visibility");
    }
    window.__BBB.three.renderer.render(window.__BBB.three.scene, window.__BBB.three.camera);
  });

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
