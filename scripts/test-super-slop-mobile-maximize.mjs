import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const artifactDir = path.join(root, "output/playwright/super-slop-mobile-maximize");
const artifactPrefix = process.env.SSB_MOBILE_ARTIFACT_PREFIX || "after";
const failures = [];
const issues = [];
const requiredControlIds = [
  "ssb-touch-up",
  "ssb-touch-left",
  "ssb-touch-down",
  "ssb-touch-right",
  "ssb-touch-jump",
  "ssb-touch-attack",
  "ssb-touch-special",
  "ssb-touch-shield",
  "ssb-touch-grab",
];

fs.mkdirSync(artifactDir, { recursive: true });

function check(requirement, condition, detail) {
  let passed = false;
  try {
    passed = typeof condition === "function" ? Boolean(condition()) : Boolean(condition);
  } catch (error) {
    detail = `${detail} (${error.message})`;
  }
  if (!passed) failures.push({ requirement, detail });
}

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
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
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

function watchPage(page, label) {
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) issues.push(`${label} console ${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => issues.push(`${label} page error: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(origin)) issues.push(`${label} request failed: ${request.url()} (${request.failure()?.errorText || "unknown"})`);
  });
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) issues.push(`${label} HTTP ${response.status()}: ${response.url()}`);
  });
}

async function readLayout(page) {
  return page.evaluate((controlIds) => {
    const viewport = { width: innerWidth, height: innerHeight };
    const rectOf = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const centerX = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const centerY = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const hit = rect.width > 0 && rect.height > 0 ? document.elementFromPoint(centerX, centerY) : null;
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0,
        inViewport: rect.left >= -1
          && rect.top >= -1
          && rect.right <= innerWidth + 1
          && rect.bottom <= innerHeight + 1,
        tappableAtCenter: Boolean(hit && (hit === element || element.contains(hit))),
      };
    };
    const overlapArea = (a, b) => {
      if (!a || !b) return 0;
      return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    };
    const canvas = document.getElementById("gameCanvas");
    const maxButton = document.getElementById("btn-fullscreen");
    const menuButton = document.querySelector(".rb-escape-btn");
    const startButton = document.getElementById("ssb-start");
    const hud = document.querySelector(".ssb-page .hud");
    const mergeHint = document.querySelector(".ssb-page .merge-hint");
    const touchLayer = document.querySelector(".ssb-touch");
    const maxTarget = document.querySelector(".ssb-play-surface") || canvas?.closest(".canvas-wrap");
    const canvasRect = rectOf(canvas);
    const controlRects = controlIds.map((id) => ({ id, ...rectOf(document.getElementById(id)) }));
    const overlapPairs = [];
    for (let i = 0; i < controlRects.length; i++) {
      for (let j = i + 1; j < controlRects.length; j++) {
        if (overlapArea(controlRects[i], controlRects[j]) > 2) overlapPairs.push([controlRects[i].id, controlRects[j].id]);
      }
    }
    const arenaCenter = canvasRect ? {
      left: canvasRect.left + canvasRect.width * 0.28,
      right: canvasRect.right - canvasRect.width * 0.28,
      top: canvasRect.top + canvasRect.height * 0.22,
      bottom: canvasRect.bottom - canvasRect.height * 0.22,
    } : null;
    return {
      viewport,
      screen: JSON.parse(window.render_game_to_text()).screen,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      bodyMaxed: document.body.classList.contains("rb-game-maxed"),
      targetClass: maxTarget?.className || "",
      canvas: canvasRect,
      maxButton: rectOf(maxButton),
      maxButtonLabel: maxButton?.getAttribute("aria-label") || "",
      menuButton: rectOf(menuButton),
      startButton: rectOf(startButton),
      hud: rectOf(hud),
      mergeHint: rectOf(mergeHint),
      touchLayer: rectOf(touchLayer),
      touchParentClass: touchLayer?.parentElement?.className || "",
      targetContainsTouch: Boolean(maxTarget && touchLayer && maxTarget.contains(touchLayer)),
      targetContainsMaxButton: Boolean(maxTarget && maxButton && maxTarget.contains(maxButton)),
      controls: controlRects,
      overlapPairs,
      centerBlockedBy: arenaCenter
        ? controlRects.filter((rect) => overlapArea(rect, arenaCenter) > 2).map((rect) => rect.id)
        : controlIds,
    };
  }, requiredControlIds);
}

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    // Keep the deterministic CSS fallback active in headless Chromium while
    // still proving that the real fullscreen request path was attempted.
    Element.prototype.requestFullscreen = function requestFullscreenForQa() {
      window.__SSB_FULLSCREEN_REQUESTS__ = (window.__SSB_FULLSCREEN_REQUESTS__ || 0) + 1;
      return Promise.reject(new Error("QA fullscreen fallback"));
    };
  });
  const page = await context.newPage();
  watchPage(page, "mobile");
  await page.goto(`${origin}/games/super-slop-brothers.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SLOP?.getCharacterAnimationDiagnostics && document.querySelector(".rb-escape-btn"), null, { timeout: 15_000 });
  await page.evaluate(() => document.fonts?.ready);

  const embedded = await readLayout(page);
  await page.screenshot({ path: path.join(artifactDir, `${artifactPrefix}-portrait-embedded.png`), fullPage: true });
  check("embedded mobile layout", embedded.scrollWidth <= embedded.viewport.width + 1, JSON.stringify(embedded));
  check(
    "embedded setup hierarchy",
    embedded.targetContainsMaxButton
      && !embedded.bodyMaxed
      && !embedded.touchLayer?.visible
      && embedded.startButton?.visible
      && embedded.startButton.tappableAtCenter
      && embedded.startButton.height >= 44
      && embedded.hud?.height <= 60
      && !embedded.mergeHint?.visible,
    JSON.stringify(embedded),
  );
  check(
    "embedded mobile actions",
    embedded.maxButton?.visible
      && embedded.maxButton.inViewport
      && embedded.maxButton.width >= 44
      && embedded.maxButton.height >= 44
      && embedded.menuButton?.visible
      && embedded.menuButton.width >= 44
      && embedded.menuButton.height >= 44,
    JSON.stringify({ maxButton: embedded.maxButton, menuButton: embedded.menuButton }),
  );

  await page.evaluate(() => {
    window.__SLOP.setManualClock(true);
    window.__SLOP.start({ ids: ["rainbot", "gigachad"], stage: "rooftop" });
  });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).screen === "fight");
  await page.locator("#btn-fullscreen").click();
  await page.waitForFunction(() => document.querySelector(".is-maxed"));

  const portraitMax = await readLayout(page);
  await page.screenshot({ path: path.join(artifactDir, `${artifactPrefix}-portrait-max.png`) });
  check(
    "max-screen controls",
    portraitMax.bodyMaxed
      && portraitMax.targetContainsTouch
      && portraitMax.targetContainsMaxButton
      && portraitMax.touchLayer.top >= portraitMax.canvas.bottom + 8
      && portraitMax.controls.every((control) => control.visible && control.inViewport && control.tappableAtCenter),
    JSON.stringify(portraitMax),
  );
  check(
    "touch target geometry",
    portraitMax.controls.every((control) => control.width >= 44 && control.height >= 44)
      && portraitMax.overlapPairs.length === 0
      && portraitMax.centerBlockedBy.length === 0,
    JSON.stringify({ controls: portraitMax.controls, overlapPairs: portraitMax.overlapPairs, centerBlockedBy: portraitMax.centerBlockedBy }),
  );
  check(
    "max-screen chrome",
    portraitMax.maxButton?.visible
      && portraitMax.maxButton.inViewport
      && portraitMax.maxButton.tappableAtCenter
      && portraitMax.maxButtonLabel.toLowerCase().includes("exit")
      && portraitMax.menuButton?.visible
      && portraitMax.menuButton.inViewport
      && portraitMax.menuButton.tappableAtCenter,
    JSON.stringify({ maxButton: portraitMax.maxButton, maxButtonLabel: portraitMax.maxButtonLabel, menuButton: portraitMax.menuButton }),
  );

  const touchInput = await page.evaluate(() => {
    const fighter = window.__SLOP.state.fighters[0];
    const beforeX = fighter.x;
    document.getElementById("ssb-touch-right").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.__SLOP.step(24, 1 / 60);
    window.dispatchEvent(new MouseEvent("mouseup"));
    const afterX = fighter.x;
    document.getElementById("ssb-touch-attack").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.__SLOP.step(2, 1 / 60);
    window.dispatchEvent(new MouseEvent("mouseup"));
    return { beforeX, afterX, attack: fighter.attack?.name || null, screen: JSON.parse(window.render_game_to_text()).screen };
  });
  check("touch gameplay input", touchInput.afterX > touchInput.beforeX + 1 && Boolean(touchInput.attack) && touchInput.screen === "fight", JSON.stringify(touchInput));

  await page.locator("#btn-fullscreen").click();
  await page.waitForFunction(() => !document.querySelector(".is-maxed"));
  const exited = await readLayout(page);
  check(
    "exit max-screen",
    !exited.bodyMaxed
      && exited.screen === "fight"
      && exited.touchLayer?.visible
      && exited.touchParentClass.includes("game-stage")
      && exited.maxButtonLabel.toLowerCase().includes("max"),
    JSON.stringify(exited),
  );

  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator("#btn-fullscreen").click();
  await page.waitForFunction(() => document.querySelector(".is-maxed"));
  const landscapeMax = await readLayout(page);
  await page.screenshot({ path: path.join(artifactDir, `${artifactPrefix}-landscape-max.png`) });
  check(
    "landscape max-screen",
    landscapeMax.bodyMaxed
      && landscapeMax.canvas?.width >= 650
      && landscapeMax.controls.every((control) => control.visible && control.inViewport && control.width >= 44 && control.height >= 44)
      && landscapeMax.overlapPairs.length === 0
      && landscapeMax.centerBlockedBy.length === 0,
    JSON.stringify(landscapeMax),
  );

  const fullscreenRequests = await page.evaluate(() => window.__SSB_FULLSCREEN_REQUESTS__ || 0);
  check("native fullscreen attempt", fullscreenRequests >= 2, `fullscreen requests: ${fullscreenRequests}`);
  await context.close();

  const nativeContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  const nativePage = await nativeContext.newPage();
  watchPage(nativePage, "native-fullscreen");
  await nativePage.goto(`${origin}/games/super-slop-brothers.html`, { waitUntil: "domcontentloaded" });
  await nativePage.waitForFunction(() => window.__SLOP?.start && document.querySelector(".rb-escape-btn"), null, { timeout: 15_000 });
  await nativePage.evaluate(() => {
    window.__SLOP.setManualClock(true);
    window.__SLOP.start({ ids: ["rainbot", "gigachad"], stage: "rooftop" });
  });
  await nativePage.locator("#btn-fullscreen").click();
  await nativePage.waitForFunction(() => document.querySelector(".canvas-wrap.is-maxed"));
  await nativePage.waitForTimeout(150);
  const nativeLayout = await readLayout(nativePage);
  const nativeState = await nativePage.evaluate(() => {
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    const touchLayer = document.querySelector(".ssb-touch");
    return {
      requestSupported: typeof Element.prototype.requestFullscreen === "function"
        || typeof Element.prototype.webkitRequestFullscreen === "function",
      fullscreenActive: Boolean(fullscreenElement),
      fullscreenContainsTouch: Boolean(fullscreenElement && touchLayer && fullscreenElement.contains(touchLayer)),
    };
  });
  check(
    "native fullscreen subtree",
    nativeState.requestSupported
      && nativeLayout.bodyMaxed
      && nativeLayout.targetContainsTouch
      && nativeLayout.controls.every((control) => control.visible && control.inViewport && control.tappableAtCenter)
      && (!nativeState.fullscreenActive || nativeState.fullscreenContainsTouch),
    JSON.stringify({ nativeState, nativeLayout }),
  );
  await nativeContext.close();
  check("browser errors", issues.length === 0, issues.join("\n"));
} catch (error) {
  failures.push({ requirement: "browser regression", detail: error.stack || error.message });
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error(`Super Slop mobile maximize regression failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure.requirement}: ${failure.detail}`);
  process.exitCode = 1;
} else {
  console.log("Super Slop mobile maximize regression passed: embedded phone layout, portrait/landscape max-screen, nine safe touch targets, real touch input, exit flow, and zero browser errors.");
}
