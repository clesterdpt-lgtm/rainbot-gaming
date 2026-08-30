#!/usr/bin/env node
/* Contact sheets for the Kenosis doctrine VFX - one plate per cue
   kind per Order, shot from the chase camera on flat open ground.
   The campaign has the same instrument for its five Orders
   (`saintfall-doctrine-vfx-sheet.mjs`); this is the Kenosis one.

   Two rules from the campaign's own VFX notes are what these plates
   exist to check: the chase camera is nearly level, so anything
   drawn flat on the ground foreshortens into a hairline and the read
   has to occupy the VERTICAL volume; and an additive saturated hue
   clips to white one channel at a time, so an Order that is drawn
   too hot stops being its own colour. Both are visible in a still
   and in nothing else. */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/kenosis-doctrine-vfx");
const port = 47500 + (process.pid % 1200);
const base = `http://127.0.0.1:${port}`;

/* The cue vocabulary each Order actually uses, in the order a player
   meets it. `capstone` plates are the Vow. */
const SHOTS = {
  "white-vigil": [
    ["quicksilver", "afterimage", { radius: 8 }],
    ["quicksilver", "capstone", { radius: 6.5, capstone: true }],
    ["crescent", "verdict", { radius: 3.4 }],
    ["crescent", "sunder", { radius: 3.4, count: 3 }],
    ["stoop", "wake", { radius: 6.5 }],
    ["stoop", "capstone", { radius: 8.5, capstone: true }],
    ["vigil", "lantern", { radius: 5.5 }],
    ["vigil", "capstone", { radius: 4.5, capstone: true }],
    ["antiphon", "verse", { radius: 8 }],
    ["antiphon", "answer", { radius: 9 }],
    ["antiphon", "chorus", { radius: 11, capstone: true }],
  ],
  "bastion-penitent": [
    ["bulwark", "bell", { radius: 7 }],
    ["bulwark", "capstone", { radius: 9, capstone: true }],
    ["cast", "bell", { radius: 3.4 }],
    ["cast", "chain", { radius: 3.4 }],
    ["forge", "stoke", { radius: 6.5 }],
    ["forge", "landing", { radius: 6 }],
    ["anvil", "mercy", { radius: 2.6 }],
    ["anvil", "capstone", { radius: 7.5, capstone: true }],
    ["tocsin", "toll", { radius: 7 }],
    ["tocsin", "brace", { radius: 4.2 }],
  ],
};

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}
async function waitServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall-white-vigil.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function sheet(browser, character) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  await page.goto(
    `${base}/games/saintfall-white-vigil.html?qa=1&character=${character}&quality=high&time=goldenhour`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    document.documentElement.classList.add("sf-maximised");
    const T = window.__SF;
    T.hideHud(true);
    /* Flat, open, and well away from the trial yard - the cohort
       walking into frame is the one thing that ruins a contact
       sheet, and its wake radius is 40m. */
    T.teleport(120, 930, Math.PI);
    T.advanceTime(1.0, 1 / 60);
  });

  for (const [order, kind, detail] of SHOTS[character]) {
    await page.evaluate(({ order, kind, detail }) => {
      const T = window.__SF;
      const ps = T.player.state;
      T.vfx.doctrineCue({
        order, kind, x: ps.x, y: ps.y, z: ps.z, yaw: ps.yaw,
        intensity: 1, rank: 2, ...detail,
      });
    }, { order, kind, detail });
    /* Far enough into the effect that a staged capstone has opened
       its later() beats, short of its fade. */
    await page.evaluate(() => window.__SF.advanceTime(0.22, 1 / 60));
    await page.evaluate(() => {
      const T = window.__SF;
      const ps = T.player.state;
      T.hidePlayer(false);
      T.setCam(ps.yaw - 0.9, 0.10, 9.5);
      T.renderStill();
    });
    await page.screenshot({
      path: path.join(outDir, `${character}-${order}-${kind}.png`),
      clip: { x: 0, y: 0, width: 1000, height: 700 },
    });
    console.log(`plate ${character}-${order}-${kind}`);
    await page.evaluate(() => window.__SF.advanceTime(2.2, 1 / 60));
  }

  const stats = await page.evaluate(() => window.__SF.summit.doctrineVfxState());
  console.log(`   ${character}: accepted ${stats.accepted}, rejected ${stats.rejected}, fallbacks ${stats.fallbacks}`);
  if (errors.length) console.log(`   pageErrors:`, errors.slice(0, 3));
  await context.close();
  return { stats, errors };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  const out = {};
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const character of Object.keys(SHOTS)) {
      out[character] = await sheet(browser, character);
    }
  } finally {
    await browser?.close();
    child.kill();
  }
  const bad = Object.entries(out).filter(([, r]) =>
    r.stats.rejected > 0 || r.stats.fallbacks > 0 || r.errors.length);
  console.log(`\nsheet: ${outDir}`);
  if (bad.length) {
    console.log("FAIL - a cue was rejected or fell back to the generic shape:",
      JSON.stringify(bad.map(([k, r]) => ({ k, rejected: r.stats.rejected, fallbacks: r.stats.fallbacks }))));
    process.exit(1);
  }
  console.log("every cue drew its own shape");
}

main().catch((e) => { console.error(e); process.exit(1); });
