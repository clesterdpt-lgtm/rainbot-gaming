#!/usr/bin/env node
/* ============================================================
   SAINTFALL - melee impact regression

   Proves the player-facing promises of the censer-lance:
     - the visible polearm travels through a materially larger arc;
     - a real queued melee press one-shots an over-health Thresher;
     - the dying light enemy is physically displaced by the impact;
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

    const inst = T.enemies.spawn("thresher", -12, 833.25,
      { health: 240, yaw: Math.PI });
    inst.health = 240;
    inst.maxHealth = 240;
    inst.suspicion = 0;
    inst.alerted = false;

    let event = null;
    let impactOrigin = null;
    const off = T.combat.bus.on("melee", (next) => {
      event = { ...next };
      impactOrigin = { x: inst.x, z: inst.z };
    });

    T.pressMelee();
    T.renderOnce(1 / 60); // drain the production input event
    const started = T.player.action;
    for (let frame = 0; frame < 25; frame += 1) T.renderOnce(1 / 60);
    const impactImage = T.captureDataURL();
    for (let frame = 0; frame < 35; frame += 1) T.renderOnce(1 / 60);

    if (typeof off === "function") off();
    return {
      started,
      event,
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

  const harrow = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
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
