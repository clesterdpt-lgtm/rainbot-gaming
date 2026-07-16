import { spawn } from "node:child_process";
import { readFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_TEST_PORT || (45000 + (process.pid % 15000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1&view=foyerStatues&frame=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-estate-statues");
const assets = [
  "assets/models/mr-feast/statues/garden-weeping-crown.glb",
  "assets/models/mr-feast/statues/foyer-listening-host.glb",
  "assets/models/mr-feast/statues/foyer-veiled-waltz.glb",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseGlb(bytes, assetPath) {
  assert(bytes.length >= 20 && bytes.toString("utf8", 0, 4) === "glTF", `${assetPath} must be a binary glTF`);
  assert(bytes.readUInt32LE(4) === 2, `${assetPath} must use glTF 2.0`);
  assert(bytes.readUInt32LE(8) === bytes.length, `${assetPath} has an invalid declared byte length`);
  const jsonLength = bytes.readUInt32LE(12);
  assert(bytes.readUInt32LE(16) === 0x4e4f534a, `${assetPath} must begin with a JSON chunk`);
  const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength).trim());
  let triangles = 0;
  for (const mesh of gltf.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      if ((primitive.mode ?? 4) !== 4) continue;
      const count = primitive.indices == null
        ? gltf.accessors?.[primitive.attributes?.POSITION]?.count
        : gltf.accessors?.[primitive.indices]?.count;
      triangles += Math.floor((Number(count) || 0) / 3);
    }
  }
  return {
    triangles,
    meshes: gltf.meshes?.length || 0,
    materials: gltf.materials?.length || 0,
    textures: gltf.textures?.length || 0,
    animations: gltf.animations?.length || 0,
  };
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

async function run() {
  for (const assetPath of assets) {
    const absolutePath = path.join(root, assetPath);
    const info = await stat(absolutePath);
    assert(info.size > 1024, `${assetPath} is empty or implausibly small`);
    assert(info.size < 10 * 1024 * 1024, `${assetPath} exceeds the 10 MB browser budget`);
    const glb = parseGlb(await readFile(absolutePath), assetPath);
    assert(glb.meshes >= 1 && glb.triangles >= 500, `${assetPath} does not contain a readable statue mesh`);
    assert(glb.triangles <= 18000, `${assetPath} exceeds the 18k-triangle statue budget (${glb.triangles})`);
    assert(glb.materials >= 1 && glb.textures <= 8, `${assetPath} has an invalid material/texture budget`);
    assert(glb.animations === 0, `${assetPath} should remain a static prop without skeletal animation`);
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text())) errors.push(message.text());
    });

    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready && window.MrFeastFresh?.getEstateStatueDiagnostics?.().settled, null, { timeout: 120000 });
    await page.waitForTimeout(1000);
    const diagnostics = await page.evaluate(() => window.MrFeastFresh.getEstateStatueDiagnostics());
    assert(diagnostics.loaded === 3 && diagnostics.failed === 0, `all three statues should load: ${JSON.stringify(diagnostics)}`);
    assert(diagnostics.colliders === 3, "all three statues should have simple fixed colliders");
    assert(diagnostics.statues.filter((statue) => statue.location === "FRONT FOYER").length === 2, "two statues should be inside the foyer");
    assert(diagnostics.statues.filter((statue) => statue.location === "FORMAL GARDEN").length === 1, "one statue should crown the garden fountain");
    assert(diagnostics.statues.every((statue) => statue.grounded && statue.height > 0.8 && statue.height < 2.5), "statues should be grounded and correctly fitted");
    assert(diagnostics.legacyFountainFigureCount === 0, "the old primitive fountain figure should be removed");
    assert(diagnostics.legacyFoyerBustCount === 0, "the old procedural foyer busts should be removed");
    assert(diagnostics.centralFoyerAisleClear, "the two foyer statues must preserve the central rug and door aisle");
    await page.screenshot({ path: path.join(artifactDir, "foyer-statues-desktop.png") });

    await page.evaluate(() => window.MrFeastFresh.teleport("gardenFountainStatue"));
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(artifactDir, "garden-fountain-statue-desktop.png") });
    assert(errors.length === 0, `browser console errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast estate statue browser test: three Blender-prepared Meshy GLBs, fountain replacement, foyer placement, collision, and visual QA passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast estate statue browser test failed: ${error.message}`);
  process.exitCode = 1;
});
