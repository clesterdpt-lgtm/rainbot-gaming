#!/usr/bin/env node
/* Boot diagnostic: loads the game and reports exactly where startup stops. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const URL_ = `${BASE}/games/tardigrade-simulator.html?qa=1&quality=${process.env.Q || "ultra"}`;

const server = spawn("/opt/homebrew/bin/python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: root, stdio: ["ignore", "ignore", "ignore"],
});

async function waitForServer() {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${BASE}/games/tardigrade-simulator.html`)).ok) return; } catch (_) {}
    await delay(100);
  }
  throw new Error("server never started");
}

const browser = await (async () => {
  await waitForServer();
  return chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
})();

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => pageErrors.push(e.stack || e.message));

await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await delay(25000);

const state = await page.evaluate(() => ({
  hasTsim: typeof window.__TSIM !== "undefined",
  ready: window.__TSIM ? window.__TSIM.isReady() : false,
  ctxPhase: window.__TSIM_CTX ? window.__TSIM_CTX.state.phase : null,
  systems: window.__TSIM_CTX ? (window.__TSIM_CTX.systems || []).map((s) => s.id) : null,
  loaded: window.__TSIM_CTX
    ? ["materials", "physics", "world", "props", "tardigrade", "player", "vfx", "audio", "ui"]
        .map((id) => `${id}:${window.__TSIM_CTX[id] ? "ok" : "MISSING"}`)
    : null,
  bootStatus: document.getElementById("ts-boot-status")?.textContent || null,
  bootError: document.getElementById("ts-boot-error")?.textContent || null,
}));

console.log("=== BOOT STATE ===");
console.log(JSON.stringify(state, null, 2));
console.log("\n=== PAGE ERRORS ===");
pageErrors.slice(0, 6).forEach((e) => console.log(e.split("\n").slice(0, 8).join("\n") + "\n---"));
console.log("\n=== CONSOLE (first 25) ===");
consoleErrors.slice(0, 25).forEach((e) => console.log(e.slice(0, 400)));

await browser.close();
server.kill("SIGTERM");
