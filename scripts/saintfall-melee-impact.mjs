#!/usr/bin/env node
/* ============================================================
   SAINTFALL - melee impact regression

   Proves the player-facing promises of the censer-lance:
     - the visible polearm travels through a materially larger arc;
     - a real queued melee press one-shots an over-health Thresher;
     - the dying light enemy is physically displaced by the impact;
     - confirmed contact briefly holds gameplay and adds a camera shove;
     - whiffs do neither, and a wide sweep still requests one impact beat;
     - larger castes retain their normal health balance.

   Usage:
     node scripts/saintfall-melee-impact.mjs [--out output/path]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((part) => part.trim().split(/\s+/)).map(([key, value]) => [key, value ?? true])
);
const outDir = path.resolve(root, args.out || "output/saintfall/melee-impact");
const port = 50000 + (process.pid % 9000);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(outDir, { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
  });

  const arcs = await page.evaluate(() => ["melee1", "melee2", "melee3"]
    .map((name) => window.__SF.animProbe(name, 1.3)));
  for (const sample of arcs) {
    check(`${sample.action} visibly sweeps the polearm`, sample.arcDiagonalM >= 2.25,
      `${sample.arcDiagonalM}m tip envelope, ${sample.travelM}m travel`);
    check(`${sample.action} carries the trooper's body`,
      sample.bodyTravelM >= 0.30 && sample.legTravelM >= 0.25,
      `${sample.bodyTravelM}m body, ${sample.legTravelM}m legs`);
  }

  const thresher = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.invulnerable(true);
    T.autoStow(false);
    T._teleportRaw(-12, 830, 0);
    T.setBodyHeading(0);
    T.setCam(0, -0.10, 5.8);
    T.meleeFeedback.reset();

    const inst = T.enemies.spawn("thresher", -12, 833.25,
      { health: 240, yaw: Math.PI });
    inst.health = 240;
    inst.maxHealth = 240;
    inst.suspicion = 0;
    inst.alerted = false;

    let event = null;
    let impactOrigin = null;
    let feedbackAtImpact = null;
    let heaveAtImpact = 0;
    const off = T.combat.bus.on("melee", (next) => {
      event = { ...next };
      impactOrigin = { x: inst.x, z: inst.z };
      feedbackAtImpact = T.meleeFeedback.status();
      heaveAtImpact = T.player.state.heave;
    });

    T.pressMelee();
    T.renderOnce(1 / 60); // drain the production input event
    const started = T.player.action;
    const clockDeltas = [];
    for (let frame = 0; frame < 25; frame += 1) {
      const beforeClock = T.player.state.clock;
      T.renderOnce(1 / 60);
      clockDeltas.push(T.player.state.clock - beforeClock);
    }
    const impactImage = T.captureDataURL();
    for (let frame = 0; frame < 35; frame += 1) T.renderOnce(1 / 60);

    if (typeof off === "function") off();
    return {
      started,
      event,
      feedbackAtImpact,
      feedbackEnd: T.meleeFeedback.status(),
      heaveAtImpact,
      minClockDelta: Math.min(...clockDeltas),
      startHp: 240,
      endHp: inst.health,
      endState: inst.state,
      displacement: impactOrigin
        ? Math.hypot(inst.x - impactOrigin.x, inst.z - impactOrigin.z) : 0,
      impactImage,
      knockbackApi: typeof T.enemies.knockback,
    };
  });

  const image = thresher.impactImage;
  delete thresher.impactImage;
  await writeFile(path.join(outDir, "thresher-impact.png"),
    Buffer.from(image.slice(image.indexOf(",") + 1), "base64"));

  check("enemy system exposes authoritative knockback", thresher.knockbackApi === "function");
  check("real melee input starts the enlarged opening swing", thresher.started === "melee1",
    `action=${thresher.started}`);
  check("over-health Thresher is killed in one clean swing",
    thresher.startHp === 240 && thresher.endHp === 0 && thresher.endState === "death",
    `hp ${thresher.startHp} -> ${thresher.endHp}, state=${thresher.endState}`);
  check("melee event records one kill and one physical push",
    thresher.event?.hits === 1 && thresher.event?.kills === 1
      && thresher.event?.knockbacks === 1,
    JSON.stringify(thresher.event));
  check("dying Thresher is visibly knocked backward", thresher.displacement >= 2,
    `${thresher.displacement.toFixed(3)}m after impact`);
  check("confirmed kill requests one short contact pause",
    thresher.feedbackAtImpact?.requests === 1
      && thresher.feedbackAtImpact?.last?.duration >= 0.034
      && thresher.feedbackAtImpact?.last?.duration <= 0.040,
    JSON.stringify(thresher.feedbackAtImpact));
  check("contact pause withholds gameplay time, then fully expires",
    thresher.minClockDelta <= 1e-6
      && thresher.feedbackEnd?.active === false
      && Math.abs(thresher.feedbackEnd?.frozenSeconds - 0.036) <= 1e-6,
    `min clock delta=${thresher.minClockDelta}, ${JSON.stringify(thresher.feedbackEnd)}`);
  check("confirmed contact adds a distinct heavy camera shove",
    thresher.heaveAtImpact >= 0.16,
    `heave=${thresher.heaveAtImpact}`);

  const whiff = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T._teleportRaw(-12, 830, 0);
    T.setBodyHeading(0);
    T.meleeFeedback.reset();
    T.player.state.heave = 0;
    const beforeClock = T.player.state.clock;
    const hits = T.combat.meleeStrike(1, 1.42, false, 1.34, 1, 1);
    const afterStrike = T.meleeFeedback.status();
    const heave = T.player.state.heave;
    T.renderOnce(1 / 60);
    return {
      hits,
      afterStrike,
      heave,
      clockDelta: T.player.state.clock - beforeClock,
    };
  });
  check("a whiff never requests hit-stop or contact heave",
    whiff.hits === 0 && whiff.afterStrike.requests === 0
      && whiff.afterStrike.active === false && whiff.heave === 0,
    JSON.stringify(whiff));
  check("a whiff leaves the next gameplay frame at full length",
    Math.abs(whiff.clockDelta - 1 / 60) <= 1e-6,
    `clock delta=${whiff.clockDelta}`);

  const crowd = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T._teleportRaw(-12, 830, 0);
    T.setBodyHeading(0);
    T.meleeFeedback.reset();
    T.enemies.spawn("harrow", -12.55, 832.45, { yaw: Math.PI });
    T.enemies.spawn("harrow", -11.45, 832.45, { yaw: Math.PI });
    const hits = T.combat.meleeStrike(1, 1.8, false, 1.34, 1, 1);
    return { hits, feedback: T.meleeFeedback.status() };
  });
  check("one crowd-clearing sweep requests one impact beat",
    crowd.hits === 2 && crowd.feedback.requests === 1
      && crowd.feedback.last?.hits === 2,
    JSON.stringify(crowd));

  const profiles = await page.evaluate(() => {
    const T = window.__SF;
    const sample = ({ slam = false, sweepId = 1, reduced = false }) => {
      T.clearEnemies();
      T._teleportRaw(-12, 830, 0);
      T.setBodyHeading(0);
      T.meleeFeedback.reset();
      document.body.classList.toggle("sf-reduced-motion", reduced);
      T.enemies.spawn("harrow", -12, 832.5, { yaw: Math.PI });
      T.combat.meleeStrike(1, slam ? 1.7 : 1.2, slam, 1.34,
        slam ? 3 : sweepId === 6 ? 3 : 1, sweepId);
      const status = T.meleeFeedback.status();
      document.body.classList.remove("sf-reduced-motion");
      return status.last;
    };
    return {
      strike: sample({}),
      pierce: sample({ sweepId: 6 }),
      finisher: sample({ slam: true, sweepId: 3 }),
      reduced: sample({ reduced: true }),
    };
  });
  check("strike, piercing thrust, and finisher keep distinct contact timing",
    Math.abs(profiles.strike?.duration - 0.030) <= 1e-6
      && Math.abs(profiles.pierce?.duration - 0.020) <= 1e-6
      && Math.abs(profiles.finisher?.duration - 0.050) <= 1e-6,
    JSON.stringify(profiles));
  check("reduced motion shortens the contact pause",
    profiles.reduced?.reducedMotion === true
      && Math.abs(profiles.reduced?.duration - 0.0135) <= 1e-6,
    JSON.stringify(profiles.reduced));

  const harrow = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.meleeFeedback.reset();
    T._teleportRaw(-12, 830, 0);
    T.setBodyHeading(0);
    T.weapons.setMode("melee");
    const inst = T.enemies.spawn("harrow", -12, 832.7, { yaw: Math.PI });
    const before = inst.health;
    T.combat.meleeStrike(1, 1.42, false, 1.34);
    return { before, after: inst.health, state: inst.state };
  });
  check("larger castes keep their normal melee balance",
    harrow.after > 0 && harrow.after < harrow.before && harrow.state !== "death",
    `Harrow hp ${harrow.before} -> ${harrow.after}`);

  check("melee impact probe has no page errors", pageErrors.length === 0,
    pageErrors.slice(0, 3).join(" | "));
  check("melee impact probe has no console errors", consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(" | "));

  await writeFile(path.join(outDir, "report.json"), JSON.stringify({
    results, arcs, thresher, harrow, pageErrors, consoleErrors,
  }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
