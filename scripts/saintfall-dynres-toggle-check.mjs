#!/usr/bin/env node
/* ============================================================
   SAINTFALL - dynamic-resolution toggle + visual trade evidence

   1. Drives the REAL settings switch (field menu -> settings ->
      dynamic resolution) on the production path and asserts the
      renderer followed it and localStorage kept it.

   2. Captures the same still at scale 1.0 and at the 0.62 floor,
      DPR 2, and writes a side-by-side crop so the cost of the trade
      can be judged by eye instead of asserted.

   Usage: node scripts/saintfall-dynres-toggle-check.mjs
   Artifacts: output/saintfall/dynres/
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(root, "output/saintfall/dynres");
const PORT = 48900 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/games/saintfall.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2,
    })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/games/saintfall.html?intro=0&time=goldenhour`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
      window.__SF.teleport(-14, 830, Math.PI);
      window.__SF.advanceTime(1, 1 / 60);
    });

    /* ------------------- 1. the real switch ------------------- */
    console.log("--- settings switch, production path ---");
    await page.evaluate(() => window.__SF.gameUi.openMenu("settings"));
    const sw = page.locator('[data-setting="dynamic-res"]');
    await sw.waitFor({ state: "visible", timeout: 10000 });
    const before = await page.evaluate(() => window.__SF.render.autoScale);
    await sw.click();
    const afterOff = await page.evaluate(() => ({
      auto: window.__SF.render.autoScale,
      scale: window.__SF.render.renderScale,
      stored: JSON.parse(localStorage.getItem("saintfall:field-ui:v1") || "{}").dynamicRes,
      aria: document.querySelector('[data-setting="dynamic-res"]').getAttribute("aria-checked"),
    }));
    check("switch turns controller off", before === true && afterOff.auto === false,
      `auto ${before} -> ${afterOff.auto}`);
    check("off restores native scale", afterOff.scale === 1, `scale=${afterOff.scale}`);
    check("preference persisted", afterOff.stored === false, `stored=${afterOff.stored}`);
    check("switch shows OFF", afterOff.aria === "false");
    await sw.click();
    const afterOn = await page.evaluate(() => ({
      auto: window.__SF.render.autoScale,
      stored: JSON.parse(localStorage.getItem("saintfall:field-ui:v1") || "{}").dynamicRes,
    }));
    check("switch turns controller back on", afterOn.auto === true && afterOn.stored === true);
    await page.evaluate(() => window.__SF.gameUi.closeMenu());
    check("no page errors", errors.length === 0, errors[0] || "");

    /* --------------- 2. the visual trade, by eye --------------- */
    console.log("--- native vs floor-scale stills (DPR2) ---");
    const still = async (scale, name) => {
      await page.evaluate((s) => {
        const T = window.__SF;
        T.render.setAutoScale(false);
        T.render.setRenderScale(s);
        T.renderOnce(0); T.renderOnce(0);
      }, scale);
      const buf = await page.screenshot({ type: "png" });
      await writeFile(path.join(OUT, name), buf);
      return buf;
    };
    const nativeBuf = await still(1.0, "native-scale-1.00.png");
    const floorBuf = await still(0.62, "floor-scale-0.62.png");
    await page.evaluate(() => {
      window.__SF.render.setRenderScale(1);
      window.__SF.render.setAutoScale(true);
    });

    // Side-by-side crop of the same detail region, labeled by filename.
    const region = { left: 900, top: 500, width: 640, height: 480 };
    const a = await sharp(nativeBuf).extract(region).toBuffer();
    const b = await sharp(floorBuf).extract(region).toBuffer();
    await sharp({
      create: {
        width: region.width * 2 + 8, height: region.height, channels: 3,
        background: { r: 12, g: 10, b: 12 },
      },
    }).composite([
      { input: a, left: 0, top: 0 },
      { input: b, left: region.width + 8, top: 0 },
    ]).png().toFile(path.join(OUT, "compare-native-left-floor-right.png"));
    console.log(`  wrote ${path.relative(root, OUT)}/compare-native-left-floor-right.png`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
