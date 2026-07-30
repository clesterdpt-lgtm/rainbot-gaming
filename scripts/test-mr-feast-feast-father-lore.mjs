import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const manifestPath = path.join(root, "assets", "models", "mr-feast", "demon-prototypes", "manifest.json");
const gameplanPath = path.join(root, "docs", "gameplan.md");
const paintingPath = path.join(
  root,
  "assets",
  "textures",
  "mr-feast",
  "generated",
  "portraits",
  "portrait-feast-father-at-table-v1-ai.jpg",
);
const port = Number(process.env.MR_FEAST_FEAST_FATHER_TEST_PORT || (50000 + (process.pid % 10000)));
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-feast-father-lore");

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

function watchErrors(page, errors) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text())) {
      errors.push(message.text());
    }
  });
}

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function run() {
  const [runtime, pageHtml, manifestSource, gameplan, painting] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
    readFile(manifestPath, "utf8"),
    readFile(gameplanPath, "utf8"),
    readFile(paintingPath),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert(
    /MANSION_RUNTIME_VERSION = "20260730-feast-father-lore-1"/.test(runtime)
      && /mr-feast-mansion\.js\?v=20260730-feast-father-lore-1/.test(pageHtml),
    "page and runtime need the Feast Father lore cache identity",
  );
  assert(
    manifest.prototypes?.length === 1
      && manifest.prototypes[0].id === "banquet-saint"
      && manifest.prototypes[0].name === "The Feast Father",
    `the active legacy asset must expose the new display name: ${JSON.stringify(manifest.prototypes)}`,
  );
  assert(
    /Survive me\. Survive the Feast Father\. Survive the house\./.test(runtime)
      && /flashlight can stun the Feast Father/.test(runtime),
    "player-facing Victory Feast copy still uses the old demon name",
  );
  assert(!/"The Banquet Saint"/.test(runtime) && !/"The Banquet Saint"/.test(manifestSource), "the old display name remains in the live runtime or manifest");

  const loreSource = runtime.match(/const FEAST_FATHER_LORE_BOOK = Object\.freeze\(\{([\s\S]*?)\n  \}\);/)?.[1] || "";
  assert(
    /title:\s*"Household Observances for the Long Table"/.test(loreSource)
      && /The Feast Father remembers every guest/.test(loreSource),
    "the guaranteed Library lore volume is missing its restrained household warning",
  );
  assert(
    !/\b(?:demon|horn|claw|teeth|skull|true form)\b/i.test(loreSource),
    "the lore book reveals explicit creature anatomy",
  );
  assert(
    /"feast-father-at-table":[^\n]+title:\s*"The Place at the Head"/.test(runtime)
      && /artId:\s*"feast-father-at-table"[\s\S]*?circuitName:\s*"dining room lights"/.test(runtime)
      && /diningFeastFatherPainting:/.test(runtime),
    "the veiled Dining Room painting is not registered, placed, lit, and frameable",
  );
  assert(
    gameplan.includes("Two optional household artifacts quietly establish the Feast Father")
      && gameplan.includes("whose face and anatomy remain completely obscured"),
    "the canonical game plan does not preserve the intentionally incomplete lore boundary",
  );
  assert(
    painting[0] === 0xff
      && painting[1] === 0xd8
      && painting.length <= 550 * 1024,
    `the painting must be a delivery-sized JPEG; bytes=${painting.length}`,
  );

  let server = null;
  let browser = null;
  const errors = [];
  if (!(await serverResponds())) {
    server = spawn(
      "python3",
      ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root],
      { stdio: "ignore" },
    );
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    watchErrors(page, errors);
    await page.goto(
      `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1&view=diningFeastFatherPainting&frame=1`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 180000 });
    await page.waitForTimeout(450);

    let state = await diagnostics(page);
    assert(
      state.artwork?.expectedTextures === 18
        && state.artwork.loadedTextures === 18
        && state.artwork.fallbackFrames === 0
        && state.artwork.uniqueArtIds.includes("feast-father-at-table"),
      `the painting did not load through the mansion artwork system: ${JSON.stringify(state.artwork)}`,
    );
    const loreDiagnostic = state.books?.specialBooks?.find(
      (book) => book.placementId === "feast-father-household-observances",
    );
    assert(
      loreDiagnostic?.title === "Household Observances for the Long Table"
        && loreDiagnostic.kind === "lore"
        && loreDiagnostic.previewLength >= 180,
      `the fixed lore volume is absent from readable-book diagnostics: ${JSON.stringify(state.books)}`,
    );

    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "feast-father-veiled-painting-desktop.png"),
    });

    const opened = await page.evaluate(() => window.MrFeastFresh.openFeastFatherLoreBookForQA());
    assert(opened, "the guaranteed Feast Father lore volume did not open through its QA interaction path");
    await page.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    const reader = await page.evaluate(() => ({
      title: document.getElementById("mansion-book-title")?.textContent,
      author: document.getElementById("mansion-book-author")?.textContent,
      preview: document.getElementById("mansion-book-preview")?.textContent,
      collection: document.getElementById("mansion-book-collection")?.textContent,
      kind: document.getElementById("mansion-book-reader")?.dataset.bookKind,
    }));
    assert(
      reader.title === "Household Observances for the Long Table"
        && reader.author === "by E. Vane, Steward"
        && /keeping Father’s place/.test(reader.preview || "")
        && /Feast Father remembers every guest/.test(reader.preview || "")
        && /household records/.test(reader.collection || "")
        && reader.kind === "lore",
      `the shared reader did not present the intended subtle lore: ${JSON.stringify(reader)}`,
    );
    assert(
      !/\b(?:demon|horn|claw|teeth|skull|true form)\b/i.test(reader.preview || ""),
      `the readable excerpt gives away explicit creature anatomy: ${JSON.stringify(reader)}`,
    );
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "feast-father-lore-book-desktop.png"),
    });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("mansion-book-reader")?.hidden);

    state = await diagnostics(page);
    assert(!state.books.open, "closing the lore volume must return to ordinary exploration");
    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast Feast Father lore test: renamed finale, fixed Library volume, veiled Dining Room painting, and browser presentation passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast Feast Father lore test failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
