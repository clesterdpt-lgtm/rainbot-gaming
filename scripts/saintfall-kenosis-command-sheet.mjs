#!/usr/bin/env node
/* Contact sheets for the Kenosis field commands - the beacon while it
   burns, and each call at the frame it arrives.

   These exist because the two ways a command effect goes wrong are
   both invisible to a probe and obvious in a still:

   THE BEACON GETS BRIGHTER WITH DISTANCE. It is additive geometry,
   so seen through haze it ADDS the sky - an unpatched column two
   hundred metres out reads brighter than one at fifty, which is
   backwards. Hence the `-far` plates.

   A DIRECTIONAL EFFECT DRAWN RADIALLY LOOKS FINE. The Standing Gate
   is the only call in this set with a facing, and a burst drawn round
   its centre rather than along its span still photographs as a
   perfectly reasonable explosion that happens to have left a wall
   behind. The `gate-along` and `gate-across` plates are the same
   event from two bearings; the dust has to lie on the span in one and
   read end-on in the other. */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/kenosis-commands-vfx");
const port = 47950 + (process.pid % 900);
const base = `http://127.0.0.1:${port}`;

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

/* Each plate: [key, label, secondsAfterImpact, camera]. The camera is
   {yawOffset, pitch, dist} on the chase rig. */
const PLATES = {
  "white-vigil": [
    ["mirrorchoir", "choir-arrive", 0.20, { yaw: -0.55, pitch: 0.04, dist: 16 }],
    ["mirrorchoir", "choir-standing", 2.60, { yaw: -0.55, pitch: 0.06, dist: 14 }],
    ["crescentrain", "rain-falling", 0.22, { yaw: -0.5, pitch: -0.02, dist: 22 }],
    ["crescentrain", "rain-landing", 0.62, { yaw: -0.5, pitch: 0.05, dist: 20 }],
  ],
  "bastion-penitent": [
    ["standinggate", "gate-across", 0.18, { yaw: -0.5, pitch: 0.05, dist: 20 }],
    /* The same event, viewed down the wall's own span. */
    ["standinggate", "gate-along", 0.18, { yaw: -1.62, pitch: 0.05, dist: 20 }],
    ["standinggate", "gate-standing", 3.00, { yaw: -0.5, pitch: 0.06, dist: 18 }],
    ["fallinganvil", "anvil-arrive", 0.24, { yaw: -0.5, pitch: 0.05, dist: 24 }],
    ["fallinganvil", "anvil-wave", 0.62, { yaw: -0.5, pitch: 0.08, dist: 30 }],
  ],
};

async function sheet(browser, character) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 760 } });
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
    T.teleport(120, 930, Math.PI);
    T.advanceTime(1.0, 1 / 60);
  });

  /* THE BEACON, near and far. */
  for (const [label, dist, pitch] of [["beacon-near", 16, 0.02], ["beacon-far", 150, 0.0]]) {
    await page.evaluate(({ dist, pitch }) => {
      const T = window.__SF;
      T.summit.commandReset();
      T.summit.commandCall(T.summit.commandCatalog().order[0]);
      T.advanceTime(0.5, 1 / 60);
      const ps = T.player.state;
      T.hidePlayer(false);
      T.setCam(ps.yaw - 0.15, pitch, dist);
      T.renderStill();
    }, { dist, pitch });
    await page.screenshot({
      path: path.join(outDir, `${character}-${label}.png`),
      clip: { x: 0, y: 0, width: 1200, height: 760 },
    });
    console.log(`plate ${character}-${label}`);
    await page.evaluate(() => { window.__SF.summit.commandReset(); });
  }

  for (const [key, label, after, cam] of PLATES[character]) {
    await page.evaluate(async ({ key, after, cam }) => {
      const T = window.__SF;
      T.summit.commandReset();
      T.clearEnemies();
      const ps = T.player.state;
      /* A couple of bodies so the scale of the effect is legible
         against something the eye already knows the size of - and
         held still so they are where the command lands. */
      const tx = ps.x + Math.sin(ps.camYaw) * 22;
      const tz = ps.z + Math.cos(ps.camYaw) * 22;
      for (let i = 0; i < 3; i += 1) {
        T.spawnEnemy("thresher", tx + (i - 1) * 4, tz + 2, {});
      }
      T.enemies.live.forEach((e) => { e.stunTime = 999; e.health = 9000; });
      T.summit.commandCall(key);
      /* Run the fuse out, then stop `after` seconds into the effect. */
      const spec = T.summit.commandCatalog().stratagems[key];
      T.advanceTime(spec.delay + 0.001, 1 / 60);
      T.advanceTime(after, 1 / 60);
      T.hidePlayer(false);
      T.setCam(ps.yaw + cam.yaw, cam.pitch, cam.dist);
      T.renderStill();
    }, { key, after, cam });
    await page.screenshot({
      path: path.join(outDir, `${character}-${label}.png`),
      clip: { x: 0, y: 0, width: 1200, height: 760 },
    });
    console.log(`plate ${character}-${label}`);
    await page.evaluate(() => {
      window.__SF.summit.commandReset();
      window.__SF.clearEnemies();
      window.__SF.advanceTime(3.0, 1 / 60);
    });
  }

  if (errors.length) console.log(`   pageErrors:`, errors.slice(0, 3));
  await context.close();
  return errors;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  const errs = {};
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const character of Object.keys(PLATES)) {
      errs[character] = await sheet(browser, character);
    }
  } finally {
    await browser?.close();
    child.kill();
  }
  console.log(`\nsheet: ${outDir}`);
  const bad = Object.entries(errs).filter(([, e]) => e.length);
  if (bad.length) {
    console.log("FAIL - page errors:", JSON.stringify(bad));
    process.exit(1);
  }
  console.log("every plate rendered without a page error");
}

main().catch((e) => { console.error(e); process.exit(1); });
