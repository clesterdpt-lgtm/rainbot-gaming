import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_QUESTIONABLE_PROVISIONS_TEST_PORT || (54000 + (process.pid % 9000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1&frame=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-questionable-provisions");
const expected = Object.freeze([
  Object.freeze({ id: "fridge-patron-reserve", storage: "kitchen refrigerator", kind: "vacuum-cut" }),
  Object.freeze({ id: "fridge-house-sample", storage: "kitchen refrigerator", kind: "specimen-jar" }),
  Object.freeze({ id: "fridge-ocular-sample", storage: "kitchen refrigerator", kind: "ocular-sample" }),
  Object.freeze({ id: "fridge-choir-cut", storage: "kitchen refrigerator", kind: "stitched-muscle" }),
  Object.freeze({ id: "pantry-preserve-lot-04", storage: "preserves cabinet", kind: "preserve-jar" }),
  Object.freeze({ id: "pantry-preserve-lot-09", storage: "preserves cabinet", kind: "preserve-jar" }),
  Object.freeze({ id: "pantry-preserve-lot-12", storage: "preserves cabinet", kind: "preserve-jar" }),
  Object.freeze({ id: "pantry-joint-stock", storage: "preserves cabinet", kind: "joint-stock" }),
  Object.freeze({ id: "pantry-final-table-parcel", storage: "pantry cupboard", kind: "butcher-parcel" }),
  Object.freeze({ id: "pantry-marrow-stock", storage: "pantry tinned-goods cabinet", kind: "marrow-tin" }),
  Object.freeze({ id: "pantry-tenderizing-salts", storage: "pantry baking cabinet", kind: "tenderizing-salts" }),
  Object.freeze({ id: "pantry-dental-garnish", storage: "pantry dry-goods cabinet", kind: "dental-garnish" }),
  Object.freeze({ id: "pantry-fine-strands", storage: "pantry dry-goods cabinet", kind: "fine-strands" }),
  Object.freeze({ id: "pantry-rendered-reserve", storage: "pantry baking cabinet", kind: "rendered-reserve" }),
]);

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

function watchErrors(page, errors) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
  });
}

async function provisionState(page) {
  return page.evaluate(() => window.MrFeastFresh.getQuestionableProvisionState());
}

async function frameProvision(page, id, fileName) {
  const state = await page.evaluate((entryId) => window.MrFeastFresh.frameQuestionableProvisionForQA(entryId), id);
  assert(state, `could not frame ${id}`);
  const entry = state.entries.find((candidate) => candidate.id === id);
  assert(entry?.visible, `${id} should be visible when its real storage is open: ${JSON.stringify(entry)}`);
  await page.waitForTimeout(100);
  await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, fileName) });
  return state;
}

async function closeProvisionStorage(page, id) {
  const state = await page.evaluate((entryId) => window.MrFeastFresh.setQuestionableProvisionStorageForQA(entryId, false), id);
  assert(state && state.entries.find((entry) => entry.id === id)?.visible === false, `${id} should hide with its storage doors`);
  return state;
}

async function run() {
  const [runtime, html] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  assert(/const QUESTIONABLE_PROVISIONS = Object\.freeze\(\{/.test(runtime), "missing questionable-provisions visual contract");
  assert(/function addQuestionableProvisionContents\(/.test(runtime), "missing authored provision builder");
  assert(/makeQuestionableProvisionMarblingTexture/.test(runtime) && /makeQuestionableProvisionLabelTexture/.test(runtime), "provisions need local procedural textures");
  assert(/questionable-provisions-vacuum-plastic/.test(runtime) && /questionable-provisions-clouded-glass/.test(runtime) && /questionable-provisions-dark-brine/.test(runtime), "layered package materials are missing");
  assert(/questionable-provisions-ocular-sclera/.test(runtime) && /questionable-provisions-ocular-iris/.test(runtime) && /questionable-provisions-dental-enamel/.test(runtime), "organic eye/tooth materials are missing");
  assert(/questionable-provisions-lingual-muscle/.test(runtime) && /questionable-provisions-fine-strands/.test(runtime) && /questionable-provisions-rendered-reserve/.test(runtime), "ambiguous preparation materials are missing");
  assert(/reserveQuestionableProvisionShelfClearance/.test(runtime) && /questionableProvisionOverlapDiagnostics/.test(runtime), "questionable props need authored shelf-clearance enforcement");
  assert(/styleFoodStorageBackdrop/.test(runtime) && /stockAppearanceSignature/.test(runtime) && /minimumHeightScale/.test(runtime), "ordinary food stock needs deterministic per-instance proportion and pose variation");
  assert(/foodStorageSupportingStockDiagnostics/.test(runtime), "ordinary fridge/pantry stock needs assembly-aware overlap and repetition diagnostics");
  assert(/repeatedSilhouetteCount/.test(runtime), "ordinary fridge/pantry stock needs a within-storage silhouette repetition audit");
  for (const entry of expected) {
    const authoredLiterally = runtime.includes(`"${entry.id}"`);
    const isNumberedPreserve = entry.id.startsWith("pantry-preserve-lot-")
      && runtime.includes("`pantry-preserve-lot-${lot}`")
      && /const lot = \["04", "09", "12"\]\[index\]/.test(runtime);
    assert(authoredLiterally || isNumberedPreserve, `missing authored provision ${entry.id}`);
  }
  assert(!/questionableProvision[^\n]{0,80}(?:collider|addFixedBox|addKinematicBox)/i.test(runtime), "questionable provisions must remain collider-free visual discoveries");
  const runtimeVersion = runtime.match(/MANSION_RUNTIME_VERSION\s*=\s*"([^"]+)"/)?.[1];
  assert(runtimeVersion && html.includes(`mr-feast-mansion.js?v=${runtimeVersion}`), "page/runtime cache identities must match");

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
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });

    let state = await provisionState(page);
    assert(state.count === expected.length, `expected ${expected.length} authored provisions: ${JSON.stringify(state)}`);
    assert(state.refrigeratorCount === 4 && state.pantryCount === 10, `fridge/pantry distribution is wrong: ${JSON.stringify(state)}`);
    assert(state.visibleCount === 0, `closed storage should hide every questionable item: ${JSON.stringify(state.entries)}`);
    assert(state.labelTextureCount === expected.length, `every item needs its own readable aged label: ${JSON.stringify(state)}`);
    assert(state.totalParts > 105 && state.totalParts <= state.maximumAuthoredParts, `authored detail should be rich but bounded: ${JSON.stringify(state)}`);
    assert(state.shaderLightsAdded === 0, "provisions must not add shader lights");
    assert(state.materials && /marbling/.test(state.materials.marblingTexture) && /plastic/.test(state.materials.plastic) && /glass/.test(state.materials.glass), `material diagnostics are incomplete: ${JSON.stringify(state.materials)}`);
    assert(/sclera/.test(state.materials.sclera) && /iris/.test(state.materials.iris) && /enamel/.test(state.materials.tooth), `organic material diagnostics are incomplete: ${JSON.stringify(state.materials)}`);
    assert(/lingual/.test(state.materials.lingual) && /strands/.test(state.materials.strands) && /rendered/.test(state.materials.renderedFat), `ambiguous preparation diagnostics are incomplete: ${JSON.stringify(state.materials)}`);
    assert(state.clearance?.overlapCount === 0 && state.clearance.genericOverlapCount === 0 && state.clearance.authoredOverlapCount === 0, `questionable provisions overlap surrounding stock: ${JSON.stringify(state.clearance)}`);
    assert(state.clearance.reservedStorages.length === 6 && state.clearance.reservedStorages.every((record) => record.zones.length > 0), `each authored storage needs an enforced shelf-clearance zone: ${JSON.stringify(state.clearance.reservedStorages)}`);
    assert(state.clearance.supportingStock?.storageCount === 6 && state.clearance.supportingStock.instanceCount > 30, `all fridge/Pantry supporting stock must be audited: ${JSON.stringify(state.clearance.supportingStock)}`);
    assert(state.clearance.supportingStock.overlapCount === 0, `separate ordinary stock assemblies overlap: ${JSON.stringify(state.clearance.supportingStock.overlaps)}`);
    assert(state.clearance.supportingStock.duplicateAppearanceCount === 0, `ordinary stock still contains repeated visual signatures: ${JSON.stringify(state.clearance.supportingStock.duplicateAppearances)}`);
    assert(state.clearance.supportingStock.repeatedSilhouetteCount === 0, `ordinary stock still repeats a silhouette within one storage interior: ${JSON.stringify(state.clearance.supportingStock.repeatedSilhouettes)}`);
    for (const contract of expected) {
      const entry = state.entries.find((candidate) => candidate.id === contract.id);
      assert(entry?.storageName === contract.storage && entry.kind === contract.kind, `wrong storage or silhouette for ${contract.id}: ${JSON.stringify(entry)}`);
      assert(entry.partCount >= 4, `${contract.id} needs a genuinely layered silhouette: ${JSON.stringify(entry)}`);
      assert(entry.label?.title && entry.label?.detail && entry.label?.stamp, `${contract.id} needs a complete coded label: ${JSON.stringify(entry)}`);
    }

    const lightLayoutBefore = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    state = await frameProvision(page, "fridge-patron-reserve", "fridge-patron-reserve-desktop.png");
    assert(state.visibleCount === 4, `opening the refrigerator should reveal exactly its four hero provisions: ${JSON.stringify(state.entries)}`);
    await closeProvisionStorage(page, "fridge-patron-reserve");

    await frameProvision(page, "fridge-ocular-sample", "fridge-ocular-sample-desktop.png");
    await closeProvisionStorage(page, "fridge-ocular-sample");

    await frameProvision(page, "fridge-choir-cut", "fridge-choir-cut-desktop.png");
    await closeProvisionStorage(page, "fridge-choir-cut");

    state = await frameProvision(page, "pantry-preserve-lot-09", "pantry-numbered-preserves-desktop.png");
    assert(state.visibleCount === 4, `opening preserves should reveal three numbered lots and joint stock: ${JSON.stringify(state.entries)}`);
    await closeProvisionStorage(page, "pantry-preserve-lot-09");

    await frameProvision(page, "pantry-joint-stock", "pantry-joint-stock-desktop.png");
    await closeProvisionStorage(page, "pantry-joint-stock");

    await frameProvision(page, "pantry-final-table-parcel", "pantry-final-table-parcel-desktop.png");
    await closeProvisionStorage(page, "pantry-final-table-parcel");
    await frameProvision(page, "pantry-marrow-stock", "pantry-marrow-stock-desktop.png");
    await closeProvisionStorage(page, "pantry-marrow-stock");
    await frameProvision(page, "pantry-tenderizing-salts", "pantry-tenderizing-salts-desktop.png");
    await closeProvisionStorage(page, "pantry-tenderizing-salts");
    await frameProvision(page, "pantry-dental-garnish", "pantry-dental-garnish-desktop.png");
    await closeProvisionStorage(page, "pantry-dental-garnish");
    await frameProvision(page, "pantry-fine-strands", "pantry-fine-strands-desktop.png");
    await closeProvisionStorage(page, "pantry-fine-strands");
    await frameProvision(page, "pantry-rendered-reserve", "pantry-rendered-reserve-desktop.png");
    state = await closeProvisionStorage(page, "pantry-rendered-reserve");
    assert(state.visibleCount === 0, `closing the last cabinet should restore the fully hidden baseline: ${JSON.stringify(state.entries)}`);

    const lightLayoutAfter = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    assert(JSON.stringify(lightLayoutAfter) === JSON.stringify(lightLayoutBefore), `authored food must preserve shader-light topology: before=${JSON.stringify(lightLayoutBefore)} after=${JSON.stringify(lightLayoutAfter)}`);
    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast questionable provisions acceptance passed: fourteen separated hero props plus unique non-overlapping ordinary fridge/Pantry stock, assembly-aware lids/trays, coded labels, fixed lighting, close visual captures, and clean browser console verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
