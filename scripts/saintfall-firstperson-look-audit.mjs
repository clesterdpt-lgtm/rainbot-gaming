#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 47300 + (process.pid % 900);
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

    console.log("Testing Steep Look-Up First-Person Mode...\n");

    // Test 1: Level / Horizontal Look
    await page.evaluate(() => {
      const T = window.__SF;
      T.setCam(0, 0); // camYaw 0, camPitch 0
      T.advanceTime(0.5, 1 / 60);
    });

    const levelState = await page.evaluate(() => {
      const p = window.__SF.player;
      return {
        pitch: p.state.camPitch,
        firstPerson: p.state.firstPerson,
        figureVisible: p.figure.root.visible,
      };
    });

    console.log(`1. Horizontal Look (pitch=${levelState.pitch.toFixed(2)}): firstPerson=${levelState.firstPerson.toFixed(2)}, figureVisible=${levelState.figureVisible}`);
    if (levelState.firstPerson < 0.05 && levelState.figureVisible === true) {
      console.log("   -> PASS: 3rd person active and character visible when looking level.");
    } else {
      throw new Error(`Horizontal look failed: fp=${levelState.firstPerson}, visible=${levelState.figureVisible}`);
    }

    // Test 2: Steep Look Up (camPitch = -0.90 rad / ~51.5 degrees upward)
    await page.evaluate(() => {
      const T = window.__SF;
      T.setCam(0, -0.90);
      T.advanceTime(0.6, 1 / 60);
    });

    const steepState = await page.evaluate(() => {
      const p = window.__SF.player;
      return {
        pitch: p.state.camPitch,
        firstPerson: p.state.firstPerson,
        figureVisible: p.figure.root.visible,
        camY: window.__SF.ctx.camera.position.y,
        playerY: p.state.y,
      };
    });

    console.log(`2. Steep Look Up (pitch=${steepState.pitch.toFixed(2)}): firstPerson=${steepState.firstPerson.toFixed(2)}, figureVisible=${steepState.figureVisible}, camY=${steepState.camY.toFixed(2)} vs playerY=${steepState.playerY.toFixed(2)}`);
    if (steepState.firstPerson > 0.90 && steepState.figureVisible === false) {
      console.log("   -> PASS: Smoothly entered first-person mode with player model hidden to clear field of vision.");
    } else {
      throw new Error(`Steep look-up failed: fp=${steepState.firstPerson}, visible=${steepState.figureVisible}`);
    }

    // Test 3: Returning from steep look-up back to level
    await page.evaluate(() => {
      const T = window.__SF;
      T.setCam(0, 0);
      T.advanceTime(0.6, 1 / 60);
    });

    const returnState = await page.evaluate(() => {
      const p = window.__SF.player;
      return {
        pitch: p.state.camPitch,
        firstPerson: p.state.firstPerson,
        figureVisible: p.figure.root.visible,
      };
    });

    console.log(`3. Return to Level (pitch=${returnState.pitch.toFixed(2)}): firstPerson=${returnState.firstPerson.toFixed(2)}, figureVisible=${returnState.figureVisible}`);
    if (returnState.firstPerson < 0.05 && returnState.figureVisible === true) {
      console.log("   -> PASS: Seamlessly returned to 3rd person with character visible again.");
    } else {
      throw new Error(`Return to level failed: fp=${returnState.firstPerson}, visible=${returnState.figureVisible}`);
    }

    console.log("\nALL FIRST-PERSON LOOK AUDIT CHECKS PASSED!");
  } finally {
    if (browser) await browser.close();
    s.kill();
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
