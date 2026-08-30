#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49964;
const BASE = `http://127.0.0.1:${PORT}`;
const outDir = path.join(root, "output/saintfall/doctrine");
fs.mkdirSync(outDir, { recursive: true });

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const findings = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) findings.push(label);
};

try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE}/games/saintfall.html`); if (r.ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => {
    console.error("[PAGEERROR]", err.message);
    pageErrors.push(err.message);
  });

  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 45000 });

  // Open the field menu on the Doctrine tab
  const survey = await page.evaluate(async () => {
    const T = window.__SF;
    const ctx = T.ctx;

    // Grant some seals/points so doctrine has unlocked and active items to display
    if (ctx.progression) {
      ctx.progression.state.rank = 5;
      ctx.progression.state.points = 4;
      ctx.progression.state.seals = 3;
    }

    if (T.openMenu) {
      T.openMenu("doctrine");
    } else if (ctx.gameUi?.openMenu) {
      ctx.gameUi.openMenu("doctrine");
    }

    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);

    const frame = document.querySelector(".sf-menu__frame");
    const doctrineBody = document.querySelector(".sf-doctrine__body");
    const summary = document.querySelector(".sf-doctrine__summary");
    const orders = document.querySelector(".sf-doctrine__orders");
    const orderPane = document.querySelector(".sf-doctrine__order");

    const frameRect = frame ? frame.getBoundingClientRect() : null;
    const bodyRect = doctrineBody ? doctrineBody.getBoundingClientRect() : null;
    const summaryRect = summary ? summary.getBoundingClientRect() : null;
    const ordersRect = orders ? orders.getBoundingClientRect() : null;
    const orderPaneRect = orderPane ? orderPane.getBoundingClientRect() : null;

    return {
      windowW: window.innerWidth,
      windowH: window.innerHeight,
      frame: frameRect ? { w: frameRect.width, h: frameRect.height, top: frameRect.top, left: frameRect.left } : null,
      doctrineBody: bodyRect ? { w: bodyRect.width, h: bodyRect.height } : null,
      summary: summaryRect ? { w: summaryRect.width, h: summaryRect.height } : null,
      orders: ordersRect ? { w: ordersRect.width, h: ordersRect.height } : null,
      orderPane: orderPaneRect ? { w: orderPaneRect.width, h: orderPaneRect.height } : null,
    };
  });

  console.log("\n=== FULLSCREEN DOCTRINE MENU SURVEY ===");
  console.log(`  Data: ${JSON.stringify(survey, null, 2)}`);

  check(survey.frame !== null, "Menu frame exists in DOM");
  check(survey.frame && Math.abs(survey.frame.w - survey.windowW) <= 2,
    "Menu frame spans the full screen width (edge-to-edge)",
    `frameW=${survey.frame?.w} windowW=${survey.windowW}`);
  check(survey.frame && Math.abs(survey.frame.h - survey.windowH) <= 2,
    "Menu frame spans the full screen height",
    `frameH=${survey.frame?.h} windowH=${survey.windowH}`);
  check(survey.orderPane && survey.orderPane.w >= 650,
    "Doctrine order pane has generous spacious width (>= 650px)",
    `orderPaneW=${survey.orderPane?.w}px`);

  // Screenshot Doctrine Tab
  await page.screenshot({ path: path.join(outDir, "1-doctrine-fullscreen.png") });

  // Screenshot Operation Tab
  await page.evaluate(() => { window.__SF.openMenu ? window.__SF.openMenu("operation") : window.__SF.ctx.gameUi.openMenu("operation"); });
  await delay(100);
  await page.screenshot({ path: path.join(outDir, "2-operation-fullscreen.png") });

  // Screenshot Controls Tab
  await page.evaluate(() => { window.__SF.openMenu ? window.__SF.openMenu("controls") : window.__SF.ctx.gameUi.openMenu("controls"); });
  await delay(100);
  await page.screenshot({ path: path.join(outDir, "3-controls-fullscreen.png") });

  // Screenshot Tactical Map Tab
  await page.evaluate(() => { window.__SF.openMenu ? window.__SF.openMenu("map") : window.__SF.ctx.gameUi.openMenu("map"); });
  await delay(100);
  await page.screenshot({ path: path.join(outDir, "5-map-fullscreen.png") });

  // Screenshot Saves Tab
  await page.evaluate(() => { window.__SF.openMenu ? window.__SF.openMenu("saves") : window.__SF.ctx.gameUi.openMenu("saves"); });
  await delay(100);
  await page.screenshot({ path: path.join(outDir, "6-saves-fullscreen.png") });

  check(pageErrors.length === 0, "Zero page errors during fullscreen menu checks", pageErrors.join("; "));

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (findings.length > 0) {
  console.error(`\nFAILED: ${findings.length} check(s)`);
  process.exit(1);
} else {
  console.log("\nALL FULLSCREEN MENU CHECKS PASSED!");
  process.exit(0);
}
