#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 47100 + (process.pid % 900);
const base = `http://127.0.0.1:${port}`;

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

async function main() {
  const s = server();
  let browser;
  try {
    await new Promise((r) => setTimeout(r, 1000));
    browser = await chromium.launch({
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&time=noon`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 60000 });
    await page.evaluate(() => document.documentElement.classList.add("sf-maximised"));

    const step = async (sec) => {
      await page.evaluate((s) => window.__SF.advanceTime(s, 1 / 60), sec);
    };

    console.log("Testing Hill Traversal & Glide Continuity...\n");

    // Test 1: Long glide across varied dune terrain without premature stopping
    await page.evaluate(() => {
      const T = window.__SF;
      T.releaseCamera();
      T.invulnerable(true);
      // Teleport near a dune / hill area (e.g. x: 100, z: 200)
      T.teleport(100, 200, 0);
      T.resetBoost(true);
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      T.advanceTime(0.2, 1 / 60);
    });

    const startState = await page.evaluate(() => {
      const p = window.__SF.player.state;
      return { x: p.x, y: p.y, z: p.z };
    });

    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    // Hold Shift + W for 2.0 seconds while boosting across terrain
    for (let i = 0; i < 10; i++) {
      await step(0.2);
    }
    const midBoost = await page.evaluate(() => window.__SF.boostState());
    const midPlayer = await page.evaluate(() => {
      const p = window.__SF.player.state;
      return { x: p.x, y: p.y, z: p.z, speed: p.speed };
    });

    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");
    await step(0.1);

    const distGlided = Math.hypot(midPlayer.x - startState.x, midPlayer.z - startState.z);
    console.log(`1. Held Glide across terrain: Distance = ${distGlided.toFixed(1)}m, Mid-Glide Active = ${midBoost.active}, Speed = ${midPlayer.speed?.toFixed(1)} m/s`);
    if (distGlided >= 25 && midBoost.active) {
      console.log("   -> PASS: Glide sustained across terrain without premature interruption.");
    } else {
      throw new Error(`Glide stopped prematurely: dist=${distGlided}, active=${midBoost.active}`);
    }

    // Test 2: Flying directly toward a rising hill / ridge
    await page.evaluate(() => {
      const T = window.__SF;
      T.releaseCamera();
      T.invulnerable(true);
      // Find a location with rising terrain ahead
      T.teleport(-200, -300, 0);
      T.resetBoost(true);
      T.setJetpackState({ fuel: 100, inFlight: false, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      T.advanceTime(0.2, 1 / 60);
    });

    const flightStart = await page.evaluate(() => {
      const p = window.__SF.player.state;
      return { x: p.x, y: p.y, z: p.z };
    });

    // Press Shift + Space + W to take off and fly forward
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    await page.keyboard.down("KeyW");
    for (let i = 0; i < 12; i++) {
      await step(0.2);
    }

    const flightMid = await page.evaluate(() => {
      const p = window.__SF.player.state;
      const j = window.__SF.jetpackState() || {};
      return { x: p.x, y: p.y, z: p.z, inFlight: j.inFlight, speed: p.speed, vy: p.vy };
    });

    await page.keyboard.up("KeyW");
    await page.keyboard.up("Space");
    await page.keyboard.up("ShiftLeft");

    const flightDist = Math.hypot(flightMid.x - flightStart.x, flightMid.z - flightStart.z);
    console.log(`2. Flight toward/over rising terrain: Distance = ${flightDist.toFixed(1)}m, inFlight = ${flightMid.inFlight}, Speed = ${flightMid.speed?.toFixed(1)} m/s`);
    if (flightDist >= 35 && flightMid.inFlight) {
      console.log("   -> PASS: Flight smoothly traverses terrain without stopping at hills.");
    } else {
      throw new Error(`Flight blocked or failed: dist=${flightDist}, inFlight=${flightMid.inFlight}`);
    }

    console.log("\nALL HILL TRAVERSAL AUDIT CHECKS PASSED!");
  } finally {
    if (browser) await browser.close();
    s.kill();
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
