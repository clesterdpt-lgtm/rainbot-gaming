#!/usr/bin/env node
/* Focused Saint Veyra / Saint Torren sound proof.

   The browser is muted in CI, so this uses two complementary checks:
   - the real operative verbs must reach their intended audio hooks;
   - OfflineAudioContext must render measurable signal for every new
     voice, including the difference between a hammer whiff and hit.
*/

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root,
  arg >= 0 ? process.argv[arg + 1] : "output/saintfall/operative-sfx");
const port = 47100 + (process.pid % 1300);
const base = `http://127.0.0.1:${port}`;
const report = { checks: [], states: {}, errors: {} };

function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`
    + (detail === undefined ? "" : `  ${JSON.stringify(detail)}`));
}

async function waitServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall-white-vigil.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function boot(browser, character) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(
    `${base}/games/saintfall-white-vigil.html?qa=1&character=${character}&quality=medium&time=noon&fuel=limited`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  return { context, page, errors };
}

const advance = (page, seconds) => page.evaluate((value) => {
  window.__SF.advanceTime(value, 1 / 60);
}, seconds);

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "ignore"] });

try {
  await mkdir(outDir, { recursive: true });
  await waitServer();
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });

  const vigil = await boot(browser, "white-vigil");
  report.errors.vigil = vigil.errors;
  const vigilState = await vigil.page.evaluate(() => {
    const T = window.__SF;
    const calls = { shot: 0, impact: 0, solidImpacts: 0 };
    const audio = T.ctx.audio;
    const shot = audio.crescentShot.bind(audio);
    const impact = audio.crescentImpact.bind(audio);
    audio.crescentShot = (...args) => { calls.shot += 1; return shot(...args); };
    audio.crescentImpact = (...args) => {
      calls.impact += 1;
      if (args[2]?.solid) calls.solidImpacts += 1;
      return impact(...args);
    };
    T.clearEnemies();
    const ps = T.player.state;
    ps.camPitch = 0;
    T.advanceTime(0.35, 1 / 60);
    const yaw = ps.aimViewYaw;
    T.spawnEnemy("gleaner", ps.x + Math.sin(yaw) * 11,
      ps.z + Math.cos(yaw) * 11, {});
    T.setFiring(true);
    T.advanceTime(1.25, 1 / 60);
    T.setFiring(false);
    return { calls, discharge: T.summit.dischargeState() };
  });
  report.states.vigil = vigilState;
  check("Veyra's real volley reaches the launch cue", vigilState.calls.shot >= 2,
    vigilState.calls);
  check("Veyra's real projectile contact reaches the new impact cue",
    vigilState.calls.impact >= 1 && vigilState.discharge.hits >= 1,
    { calls: vigilState.calls, hits: vigilState.discharge.hits });
  check("Veyra page stays console-clean", vigil.errors.length === 0, vigil.errors);

  const offline = await vigil.page.evaluate(async () => window.__SF.audioCheck());
  report.states.offline = offline;
  const required = ["crescentShot", "crescentImpact", "hammerMeleeWhiff",
    "hammerMeleeImpact", "hammerImpact", "leapBlast", "leapLand"];
  const silent = required.filter((name) => !offline[name]?.audible);
  check("all operative SFX render measurable audio", !offline.error && silent.length === 0,
    offline.error || silent);
  check("a connected Torren hammer blow outweighs its air-only whiff",
    offline.hammerMeleeImpact?.peak > offline.hammerMeleeWhiff?.peak * 1.8,
    {
      whiffPeak: offline.hammerMeleeWhiff?.peak,
      impactPeak: offline.hammerMeleeImpact?.peak,
    });
  check("Torren's leap landing carries a sustained heavy tail",
    offline.leapLand?.energy > offline.leapBlast?.energy,
    { launchEnergy: offline.leapBlast?.energy, landingEnergy: offline.leapLand?.energy });
  await vigil.context.close();

  const torren = await boot(browser, "bastion-penitent");
  report.errors.torren = torren.errors;
  await torren.page.evaluate(() => {
    const T = window.__SF;
    const audio = T.ctx.audio;
    const calls = { blast: 0, land: 0, landingSpeed: 0 };
    const blast = audio.leapBlast.bind(audio);
    const land = audio.leapLand.bind(audio);
    audio.leapBlast = (...args) => { calls.blast += 1; return blast(...args); };
    audio.leapLand = (...args) => {
      calls.land += 1;
      calls.landingSpeed = args[2] || 0;
      return land(...args);
    };
    T.__operativeSfxCalls = calls;
    T.setJetInput(true);
  });
  await advance(torren.page, 0.10);
  await torren.page.evaluate(() => window.__SF.setJetInput(false));
  await advance(torren.page, 2.5);
  const landing = await torren.page.evaluate(() => ({
    calls: window.__SF.__operativeSfxCalls,
    jet: window.__SF.jetpackState(),
    grounded: window.__SF.player.state.grounded,
  }));
  report.states.landing = landing;
  check("Torren's real leap reaches its dedicated landing cue",
    landing.grounded && landing.calls.blast === 1 && landing.calls.land === 1,
    landing);
  check("Torren landing audio receives preserved descent weight",
    landing.calls.landingSpeed > 6 && landing.jet.lastLandingSpeed > 6,
    { callSpeed: landing.calls.landingSpeed, statusSpeed: landing.jet.lastLandingSpeed });

  const melee = await torren.page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const events = [];
    const stop = T.combat.bus.on("melee", (event) => events.push({
      hits: event.hits, targets: event.targets.length, x: event.x, z: event.z,
    }));
    const ps = T.player.state;
    const yaw = ps.aimViewYaw;
    T.spawnEnemy("harrow", ps.x + Math.sin(yaw) * 2.2,
      ps.z + Math.cos(yaw) * 2.2, {});
    const started = T.player.meleeSwing(yaw);
    T.advanceTime(1.35, 1 / 60);
    stop?.();
    return { started, events };
  });
  report.states.melee = melee;
  check("Torren's real hammer strike emits a connected melee event",
    melee.started === true && melee.events.some((event) => event.hits > 0), melee);
  check("Torren page stays console-clean", torren.errors.length === 0, torren.errors);
  await torren.context.close();

  const audioSource = await readFile(path.join(root, "assets/js/saintfall/audio.js"), "utf8");
  check("Torren melee events route to the hammer-specific voice",
    /bastion-penitent[\s\S]{0,120}hammerMelee\(e\)/.test(audioSource));
  check("Veyra's old pitched toy chirp is absent",
    !audioSource.includes("1180 * detune") && !audioSource.includes("610 * detune"));

  await browser.close();
} finally {
  server.kill("SIGTERM");
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
}

const failed = report.checks.filter((entry) => !entry.pass);
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
