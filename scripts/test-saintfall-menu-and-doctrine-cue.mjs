import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".avif": "image/avif",
  ".webp": "image/webp",
};

function createServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    let filePath = path.join(ROOT, urlPath === "/" ? "games/saintfall.html" : urlPath);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    if (fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Access-Control-Allow-Origin": "*" });
    fs.createReadStream(filePath).pipe(res);
  });
  return server;
}

async function run() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  console.log(`Server listening on http://127.0.0.1:${port}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });

  let passCount = 0;
  let failCount = 0;

  function assert(name, condition, extra = "") {
    if (condition) {
      console.log(`PASS: ${name}`);
      passCount += 1;
    } else {
      console.error(`FAIL: ${name} ${extra}`);
      failCount += 1;
    }
  }

  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on("pageerror", (e) => console.error("Page error:", e.message));

    await page.goto(`http://127.0.0.1:${port}/games/saintfall.html?qa=1&skipIntro=1&quality=high`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for boot to finish and game to initialize
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 60000 });
    console.log("Game initialized and ready.");

    // Advance time slightly to settle frame
    await page.evaluate(() => window.__SF.advanceTime(0.5));

    // Focus canvas to own keyboard
    await page.evaluate(() => {
      document.querySelector("canvas")?.focus?.();
    });

    // TEST 1: Initial state - menu closed, doctrine cue hidden (0 points)
    const initial = await page.evaluate(() => ({
      menuOpen: window.__SF.menuState()?.open,
      doctrineCue: window.__SF.doctrineCueState(),
      doctrinePoints: window.__SF.progressionState()?.doctrine?.pointsAvailable ?? 0,
    }));
    assert("Initial menu is closed", !initial.menuOpen, JSON.stringify(initial));
    assert("Doctrine cue is hidden with 0 points", initial.doctrineCue?.hidden === true, JSON.stringify(initial));

    // TEST 2: Pressing Tab opens the menu
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => window.__SF.menuState()?.open, null, { timeout: 3000 });
    const tabOpened = await page.evaluate(() => ({
      open: window.__SF.menuState()?.open,
      panel: window.__SF.menuState()?.panel,
      paused: document.body.classList.contains("rb-escape-menu-open"),
    }));
    assert("Tab opens the menu", tabOpened.open && tabOpened.paused, JSON.stringify(tabOpened));

    // TEST 3: Pressing Tab inside menu closes the menu
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => !window.__SF.menuState()?.open, null, { timeout: 3000 });
    const tabClosed = await page.evaluate(() => !window.__SF.menuState()?.open);
    assert("Tab closes the menu", tabClosed);

    // TEST 4: Pressing Escape opens the menu
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__SF.menuState()?.open, null, { timeout: 3000 });
    const escOpened = await page.evaluate(() => ({
      open: window.__SF.menuState()?.open,
      panel: window.__SF.menuState()?.panel,
      paused: document.body.classList.contains("rb-escape-menu-open"),
    }));
    assert("Escape opens the menu", escOpened.open && escOpened.paused, JSON.stringify(escOpened));

    // TEST 5: Pressing Escape closes the menu
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !window.__SF.menuState()?.open, null, { timeout: 3000 });
    const escClosed = await page.evaluate(() => !window.__SF.menuState()?.open);
    assert("Escape closes the menu", escClosed);

    // TEST 6: Maximize screen, open menu, close menu, and fully minimize
    // Maximize via menu button
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__SF.menuState()?.open, null, { timeout: 3000 });
    await page.evaluate(() => {
      const maxBtn = document.querySelector('[data-menu-action="maximize"]');
      maxBtn?.click();
    });
    const maxActive = await page.evaluate(() => ({
      htmlMax: document.documentElement.classList.contains("sf-maximised"),
      stageMax: document.querySelector(".sf-stage")?.classList.contains("is-maxed"),
      bodyMax: document.body.classList.contains("rb-game-maxed"),
    }));
    assert("Screen is maximized", maxActive.htmlMax && maxActive.stageMax && maxActive.bodyMax, JSON.stringify(maxActive));

    // Open menu with Escape while maximized
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__SF.menuState()?.open, null, { timeout: 3000 });
    const maxDuringMenu = await page.evaluate(() => ({
      menuOpen: window.__SF.menuState()?.open,
      htmlMax: document.documentElement.classList.contains("sf-maximised"),
      stageMax: document.querySelector(".sf-stage")?.classList.contains("is-maxed"),
    }));
    assert("Escape opens menu while keeping screen maximized", maxDuringMenu.menuOpen && maxDuringMenu.htmlMax && maxDuringMenu.stageMax, JSON.stringify(maxDuringMenu));

    // Minimize from menu: click "EXIT MAX SCREEN"
    await page.evaluate(() => {
      const maxBtn = document.querySelector('[data-menu-action="maximize"]');
      maxBtn?.click();
    });
    const minAfterMenu = await page.evaluate(() => ({
      menuOpen: window.__SF.menuState()?.open,
      htmlMax: document.documentElement.classList.contains("sf-maximised"),
      stageMax: document.querySelector(".sf-stage")?.classList.contains("is-maxed"),
      bodyMax: document.body.classList.contains("rb-game-maxed"),
      navVisible: getComputedStyle(document.querySelector(".nav")).visibility !== "hidden",
      sideVisible: getComputedStyle(document.querySelector(".game-side")).visibility !== "hidden",
    }));
    assert("Exit max screen fully minimizes game and restores site visibility",
      !minAfterMenu.htmlMax && !minAfterMenu.stageMax && !minAfterMenu.bodyMax && minAfterMenu.navVisible && minAfterMenu.sideVisible,
      JSON.stringify(minAfterMenu)
    );

    // TEST 7: Doctrine talent points HUD cue
    // Grant XP to reach Rank 2 (1 doctrine point)
    await page.evaluate(() => {
      window.__SF.grantProgressionXpForQA(130, "test:rank2");
      window.__SF.advanceTime(0.1);
    });

    const cueAfter1Pt = await page.evaluate(() => ({
      progressionState: window.__SF.progressionState(),
      cueState: window.__SF.doctrineCueState(),
    }));
    assert("1 doctrine point available", cueAfter1Pt.progressionState?.pointsAvailable === 1, JSON.stringify(cueAfter1Pt));
    assert("Doctrine cue is visible with 1 point", cueAfter1Pt.cueState?.hidden === false && cueAfter1Pt.cueState?.points === 1, JSON.stringify(cueAfter1Pt));
    assert("Doctrine cue text mentions 1 DOCTRINE TALENT POINT AVAILABLE", cueAfter1Pt.cueState?.text.includes("1 DOCTRINE TALENT POINT AVAILABLE"), JSON.stringify(cueAfter1Pt));

    // Grant more XP to reach Rank 3 (2 total doctrine points)
    await page.evaluate(() => {
      window.__SF.grantProgressionXpForQA(170, "test:rank3");
      window.__SF.advanceTime(0.1);
    });
    const cueAfter2Pt = await page.evaluate(() => window.__SF.doctrineCueState());
    assert("Doctrine cue reflects 2 points", cueAfter2Pt?.points === 2 && cueAfter2Pt?.text.includes("2 DOCTRINE TALENT POINTS AVAILABLE"), JSON.stringify(cueAfter2Pt));

    // TEST 8: Cue hides when menu is opened, and reappears when closed
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__SF.menuState()?.open, null, { timeout: 3000 });
    const cueInMenu = await page.evaluate(() => window.__SF.doctrineCueState());
    assert("Doctrine cue is hidden while menu is open", cueInMenu?.hidden === true, JSON.stringify(cueInMenu));

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !window.__SF.menuState()?.open, null, { timeout: 3000 });
    await page.evaluate(() => window.__SF.advanceTime(0.1));
    const cueAfterResume = await page.evaluate(() => window.__SF.doctrineCueState());
    assert("Doctrine cue reappears when menu is closed", cueAfterResume?.hidden === false && cueAfterResume?.points === 2, JSON.stringify(cueAfterResume));

    // TEST 9: Clicking the cue opens the menu directly to the Doctrine tab
    await page.evaluate(() => {
      const cue = document.getElementById("sf-doctrine-cue");
      cue?.click();
    });
    await page.waitForFunction(() => window.__SF.menuState()?.open, null, { timeout: 3000 });
    const menuAfterCueClick = await page.evaluate(() => ({
      open: window.__SF.menuState()?.open,
      panel: window.__SF.menuState()?.panel,
    }));
    assert("Clicking doctrine cue opens Doctrine panel", menuAfterCueClick.open && menuAfterCueClick.panel === "doctrine", JSON.stringify(menuAfterCueClick));

    // Close menu
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !window.__SF.menuState()?.open, null, { timeout: 3000 });

    console.log(`\nAll tests completed: ${passCount} passed, ${failCount} failed.`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test runner threw uncaught error:", err);
  process.exit(1);
});
