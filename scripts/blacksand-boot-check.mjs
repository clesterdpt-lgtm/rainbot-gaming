#!/usr/bin/env node
/* ============================================================
   BLACKSAND - boot check

   Loads the game in a GPU-backed headless Chromium, waits for the QA
   hooks, forces a few frames and reports every console/page error.
   This is the fast gate: it catches syntax errors, bad imports and
   shader compile failures in about fifteen seconds.

   Usage:
     node scripts/blacksand-boot-check.mjs
     node scripts/blacksand-boot-check.mjs --quality low --headed
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i += 1; }
    } else args._.push(token);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const QUALITY = String(args.quality || "high");
const PORT = Number(args.port || 41500 + (process.pid % 9000));
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/games/blacksand.html?qa=1&quality=${QUALITY}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`static server never came up on ${BASE}`);
}

async function main() {
  const server = startServer();
  let browser = null;
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];

  try {
    await waitForServer();
    // `channel: "chromium"` is the full build. The headless shell
    // throttles requestAnimationFrame to ~1fps.
    browser = await chromium.launch({
      channel: "chromium",
      headless: !args.headed,
      args: [
        "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--force-device-scale-factor=1",
        "--hide-scrollbars", "--mute-audio",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    page.on("console", (message) => {
      const text = message.text();
      if (message.type() === "error") consoleErrors.push(text);
      else if (message.type() === "warning") consoleWarnings.push(text);
    });
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));

    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Surface a boot-screen failure rather than timing out on __BS.
    const outcome = await Promise.race([
      page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 120000 })
        .then(() => "ready"),
      page.waitForFunction(() => {
        const el = document.getElementById("bs-boot");
        return el && el.classList.contains("has-error");
      }, null, { timeout: 120000 }).then(() => "bootfail"),
    ]).catch((error) => `timeout:${error.message}`);

    if (outcome === "bootfail") {
      const detail = await page.evaluate(() => {
        const el = document.getElementById("bs-boot-error");
        return el ? el.textContent : "(no detail)";
      });
      console.error("BOOT SCREEN REPORTED A FAILURE:\n");
      console.error(detail);
      process.exitCode = 1;
      return;
    }
    if (String(outcome).startsWith("timeout")) {
      console.error(`The game never became ready. ${outcome}`);
      const status = await page.evaluate(() => {
        const el = document.getElementById("bs-boot-status");
        return el ? el.textContent : "(boot screen gone)";
      });
      console.error(`last boot status: ${status}`);
      process.exitCode = 1;
      return;
    }

    // Force real frames. Never trust a fixed wait here.
    await page.evaluate(() => {
      for (let i = 0; i < 30; i += 1) window.__BS.renderOnce(1 / 60);
    });
    await page.evaluate(() => window.__BS.advanceTime(3, 1 / 60));

    const report = await page.evaluate(() => window.__BS.report());
    console.log(JSON.stringify(report, null, 2));

    if (report.frame < 20) {
      console.error(`\nOnly ${report.frame} frames were produced - the renderer is not running.`);
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }

  if (pageErrors.length) {
    console.error(`\n${pageErrors.length} PAGE ERROR(S):`);
    pageErrors.slice(0, 12).forEach((e) => console.error(`  ${e}\n`));
    process.exitCode = 1;
  }
  if (consoleErrors.length) {
    console.error(`\n${consoleErrors.length} CONSOLE ERROR(S):`);
    consoleErrors.slice(0, 20).forEach((e) => console.error(`  ${e}`));
    process.exitCode = 1;
  }
  if (consoleWarnings.length) {
    console.warn(`\n${consoleWarnings.length} console warning(s):`);
    consoleWarnings.slice(0, 10).forEach((e) => console.warn(`  ${e}`));
  }
  if (!process.exitCode) console.log("\nBOOT OK - no errors.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
