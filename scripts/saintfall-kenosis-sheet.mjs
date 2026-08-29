#!/usr/bin/env node
/* Kenosis kit ANIMATION plates: close stills of every doctrine verb
   at its readable instant - melee swings mid-arc, the hammer
   wind-up/release/flight/catch, the tower-shield guard, the leap
   plume, the blink arrival, the crescent fire pose.

   Two rigs per subject, because each lies differently: the CHASE
   plate is what a player actually sees (required by the carry
   memory - beauty bearings passed while play looked wrong), and the
   FREE plate orbits to the reading the chase can never take (a
   guarding body faces the camera bearing BY DESIGN, so its front
   only exists to the free rig; `hidePlayer(false)` first or the
   free camera photographs empty snow). The stage sits 140m from
   the trial yard - inside 40m the cohort walks into every frame. */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/kenosis-sheet");
const port = 46310 + (process.pid % 1200);
const base = `http://127.0.0.1:${port}`;

const STAGE = { x: 90, z: 900, yaw: Math.PI };

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

async function boot(browser, character) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 780 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  await page.goto(
    `${base}/games/saintfall-white-vigil.html?qa=1&character=${character}&quality=high&time=goldenhour`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(({ STAGE }) => {
    document.documentElement.classList.add("sf-maximised");
    const T = window.__SF;
    T.hideHud(true);
    T.teleport(STAGE.x, STAGE.z, STAGE.yaw);
    T.advanceTime(1.0, 1 / 60);
  }, { STAGE });
  return { page, context, errors };
}

const runTo = (page, seconds) => page.evaluate((s) => {
  window.__SF.advanceTime(s, 1 / 60);
}, seconds);

async function shot(page, file) {
  await page.screenshot({ path: path.join(outDir, file), clip: { x: 0, y: 0, width: 1100, height: 780 } });
  console.log("plate", file);
}

/* Gameplay view: park the chase camera on a bearing and draw. */
async function chasePlate(page, file, off = -0.8, pitch = 0.05, dist = 3.8) {
  await page.evaluate(({ off, pitch, dist }) => {
    const T = window.__SF;
    T.releaseCamera();
    T.hidePlayer(false);
    T.setCam(T.player.state.yaw + off, pitch, dist);
    T.renderStill();
  }, { off, pitch, dist });
  await shot(page, file);
}

/* Reading view: orbit the free camera to a body-relative bearing.
   bearing 0 = dead ahead of the figure (its front), PI = behind. */
async function freePlate(page, file, bearing = 0, dist = 3.4, height = 1.5) {
  await page.evaluate(({ bearing, dist, height }) => {
    const T = window.__SF;
    const ps = T.player.state;
    T.hidePlayer(false);
    const a = ps.yaw + bearing;
    const pos = [ps.x + Math.sin(a) * dist, ps.y + height, ps.z + Math.cos(a) * dist];
    const target = [ps.x, ps.y + 1.15, ps.z];
    T.lookAt(pos, target, 46);
    T.renderStill();
  }, { bearing, dist, height });
  await shot(page, file);
  await page.evaluate(() => window.__SF.releaseCamera());
}

async function bastion(browser) {
  const { page, context, errors } = await boot(browser, "bastion-penitent");
  const swing = async (name, t, file) => {
    await page.evaluate(({ name }) => {
      const T = window.__SF;
      T.releaseCamera();
      T.player.beginAction(name);
    }, { name });
    await runTo(page, t);
    await freePlate(page, `${file}-side.png`, 0.9, 3.6, 1.6);
    await chasePlate(page, `${file}-chase.png`);
    await runTo(page, 2.0);
  };
  await swing("melee1", 0.45, "bastion-melee1");
  await swing("melee2", 0.52, "bastion-melee2");
  await swing("melee3", 0.60, "bastion-melee3");

  await page.evaluate(() => { window.__SF.summit.throwHammer(); });
  await runTo(page, 0.30);
  await freePlate(page, "bastion-throw-windup.png", 0.85, 3.8, 1.7);
  await runTo(page, 0.22);
  await freePlate(page, "bastion-throw-release.png", 0.85, 3.8, 1.7);
  await runTo(page, 0.20);
  await chasePlate(page, "bastion-hammer-flight.png", -0.25, 0.02, 5.4);
  await runTo(page, 2.6);
  await chasePlate(page, "bastion-catch.png", -0.85, 0.05, 3.8);
  await runTo(page, 6.0);

  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE" })));
  await runTo(page, 0.4);
  await freePlate(page, "bastion-guard-front.png", -0.35, 3.8, 1.5);
  await chasePlate(page, "bastion-guard-chase.png", -0.75, 0.06, 3.9);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyE" })));
  await runTo(page, 0.6);

  await page.evaluate(() => window.__SF.setJetInput(true));
  await runTo(page, 0.22);
  await page.evaluate(() => window.__SF.setJetInput(false));
  await freePlate(page, "bastion-leap.png", 1.1, 5.6, 1.9);
  await runTo(page, 3.0);
  if (errors.length) console.log("bastion pageErrors:", errors);
  await context.close();
}

async function vigil(browser) {
  const { page, context, errors } = await boot(browser, "white-vigil");
  const swing = async (name, t, file) => {
    await page.evaluate(({ name }) => {
      const T = window.__SF;
      T.releaseCamera();
      T.player.beginAction(name);
    }, { name });
    await runTo(page, t);
    await freePlate(page, `${file}-side.png`, 0.9, 3.3, 1.55);
    await chasePlate(page, `${file}-chase.png`);
    await runTo(page, 1.6);
  };
  await swing("melee1", 0.28, "vigil-melee1");
  await swing("melee2", 0.30, "vigil-melee2");
  await swing("melee3", 0.36, "vigil-melee3");

  await page.evaluate(() => { window.__SF.setFiring(true); });
  await runTo(page, 0.55);
  await freePlate(page, "vigil-fire-front.png", -0.5, 3.8, 1.6);
  await chasePlate(page, "vigil-fire-chase.png", -0.55, 0.03, 4.2);
  await page.evaluate(() => { window.__SF.setFiring(false); });
  await runTo(page, 1.2);

  await page.evaluate(() => { window.__SF.summit.blink(); });
  await runTo(page, 0.08);
  await chasePlate(page, "vigil-blink-arrival.png", -0.7, 0.04, 6.4);
  await runTo(page, 6.5);
  if (errors.length) console.log("vigil pageErrors:", errors);
  await context.close();
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    await bastion(browser);
    await vigil(browser);
  } finally {
    await browser?.close();
    child.kill();
  }
  console.log(`sheet: ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
