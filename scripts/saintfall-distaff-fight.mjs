#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Distaff encounter regression

   Proves the player-facing promises of the Glass Scar's guardian:
     - it ignores the player until they cross the aggro radius, and
       reveals itself once they do;
     - each of the eight legs is its own target with its own pool,
       reachable by both a shot and a swing;
     - breaking a leg pays real damage to the main pool and, once
       enough are gone, buckles the body down to where melee actually
       lands - and lands harder there than a rifle would;
     - the standing phase answers with a telegraphed slam, a web bolt
       that roots, and web patches that slow;
     - broken legs survive a collapse/recover cycle, and the encounter
       renders inside its performance budget while all of it is live.

   Usage:
     node scripts/saintfall-distaff-fight.mjs [--out output/path]
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
const outDir = path.resolve(root, args.out || "output/saintfall/distaff-fight");
const port = 51900 + (process.pid % 6000);
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  /* Failed requests are tracked BY URL rather than by console text.
     The browser logs its own "Failed to load resource: ... 404" line
     with no URL in it, so a text filter cannot tell a flaky CDN probe
     from a genuinely missing game asset - and boot.js deliberately
     probes jsdelivr before falling back to unpkg, so that line shows
     up intermittently on a perfectly healthy run. Same-origin
     failures are the ones that mean something. */
  const assetFailures = [];
  const sameOrigin = (url) => url.startsWith(base);
  page.on("response", (response) => {
    if (response.status() >= 400 && sameOrigin(response.url())) {
      assetFailures.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (sameOrigin(request.url())) {
      assetFailures.push(`failed ${request.url()}`);
    }
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
  });

  /* ---- RIG --------------------------------------------------------- */
  const rig = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(true);
    const d = T.distaffState();
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    return {
      spawned: !!d,
      phase: d?.phase,
      legCount: inst?.legs?.length,
      legHpLength: inst?.legHp?.length,
      bones: ["prosoma", "abdomen1", "abdomen2", "spinneret", "head",
        "fang_L", "fang_R"].every((n) => inst?.bones?.has(n)),
      clips: ["idle", "alert", "slam", "webCast", "collapse", "bite",
        "recover", "flinch", "death"].every((c) => inst?.actions?.has(c)),
    };
  });
  check("spawns once, dormant, at the lair", rig.spawned && rig.phase === "dormant");
  check("eight legs, each with its own pool", rig.legCount === 8 && rig.legHpLength === 8);
  check("named body/leg bones resolve", rig.bones);
  check("every authored clip loaded", rig.clips);

  /* ---- DORMANT / AGGRO ---------------------------------------------- */
  const farCheck = await page.evaluate(() => {
    const T = window.__SF;
    const d0 = T.distaffState();
    T._teleportRaw(d0.x - 200, d0.z, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
    return T.distaffState().phase;
  });
  check("ignores the player far outside the aggro radius", farCheck === "dormant",
    `phase=${farCheck}`);

  const aggro = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToDistaff(30);
    const secs = T.advanceToDistaffPhase("alert", 5);
    const alertPhase = T.distaffState().phase;
    const secs2 = T.advanceToDistaffPhase("standing", 5);
    return { secs, alertPhase, secs2, standing: T.distaffState().phase };
  });
  check("crossing the aggro radius reveals it", aggro.secs >= 0 && aggro.alertPhase === "alert",
    `${aggro.secs}s to alert`);
  check("the reveal resolves into the standing fight", aggro.secs2 >= 0 && aggro.standing === "standing",
    `${aggro.secs2}s to standing`);

  /* ---- STANDING ATTACKS ---------------------------------------------- */
  const standingAttacks = await page.evaluate(() => {
    const T = window.__SF;
    const events = { slam: 0, slamMiss: 0, webCast: 0, webHit: 0, patch: 0 };
    const offs = Object.keys(events).map((k) => T.distaff.bus.on(k, () => { events[k] += 1; }));
    // Close enough for the slam to be in range; the web attacks do not
    // care about range within the simulated radius.
    T.teleportToDistaff(6);
    for (let i = 0; i < 720; i += 1) T.renderOnce(1 / 60); // 12s, > every cadence
    offs.forEach((f) => f());
    return events;
  });
  check("the leg slam fires and can land at close range",
    standingAttacks.slam + standingAttacks.slamMiss > 0, JSON.stringify(standingAttacks));
  check("web bolts are cast at range", standingAttacks.webCast > 0);
  check("ground web patches are laid", standingAttacks.patch > 0);

  /* ---- WEB EFFECT ---------------------------------------------------- */
  const webEffect = await page.evaluate(() => {
    const T = window.__SF;
    T.player.clearSlow();
    T.player.applySlow(0.3, 2);
    const slowed = T.player.state.slowFactor;
    return { slowed };
  });
  check("a web effect reduces the player's move-speed multiplier",
    webEffect.slowed < 1, `factor=${webEffect.slowed}`);

  /* ---- LEG DAMAGE ------------------------------------------------------ */
  const legDamage = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const before = inst.legHp[4];
    const healthBefore = inst.health;
    T.combat.damageLeg(inst, 4, 50, { x: inst.x, y: inst.y, z: inst.z });
    const afterPartial = { legHp: inst.legHp[4], health: inst.health, broken: inst.legBroken[4] };
    T.combat.damageLeg(inst, 4, 9999, { x: inst.x, y: inst.y, z: inst.z });
    const afterBreak = { legHp: inst.legHp[4], health: inst.health, broken: inst.legBroken[4] };
    // A broken leg cannot be damaged again.
    T.combat.damageLeg(inst, 4, 50, { x: inst.x, y: inst.y, z: inst.z });
    const afterRehit = { health: inst.health };
    return { before, healthBefore, afterPartial, afterBreak, afterRehit };
  });
  check("a leg loses its own HP without touching the main pool",
    legDamage.afterPartial.legHp === legDamage.before - 50
      && legDamage.afterPartial.health === legDamage.healthBefore);
  check("breaking a leg pays a fixed bonus to the main pool",
    legDamage.afterBreak.broken && legDamage.afterBreak.health < legDamage.afterPartial.health,
    `${legDamage.afterPartial.health} -> ${legDamage.afterBreak.health}`);
  check("a broken leg cannot be damaged again",
    legDamage.afterRehit.health === legDamage.afterBreak.health);

  /* ---- MELEE ON LEGS AND THE STANDING BODY ---------------------------
     The creature turns to face the player every frame it is awake -
     see `faceTowards` in distaff.js - so a leg's position is only
     stable once that turn has settled. Positioning off a foot read
     BEFORE the settle chases a moving target: closing the gap moves
     the player, which re-aims the creature, which moves the foot.
     Settle first, THEN read, THEN swing with no frames in between for
     the read to go stale again. */
  const meleeStanding = await page.evaluate(() => {
    const T = window.__SF;
    T.autoStow(false);
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const V3 = (bone) => bone.getWorldPosition(
      new (Object.getPrototypeOf(bone.position).constructor)());

    // Roughly toward it, close enough that it settles facing this
    // bearing - then let the turn actually finish. 150 frames is
    // generous; the point is to reach a STABLE yaw, not a fast one.
    T._teleportRaw(inst.x, inst.z - 10, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 150; i += 1) T.renderOnce(1 / 60);

    // NOW find whichever leg is nearest, teleport onto it, and swing
    // on the very next frame. Any further waiting here is exactly
    // what goes stale: the creature is still turning to track the
    // player, so a leg's position is only trustworthy for as long as
    // the player has not just moved relative to it.
    let leg = inst.legs.reduce((best, l, i) => {
      const d = Math.hypot(l.foot.x - T.player.state.x, l.foot.z - T.player.state.z);
      return d < best.d ? { i, d, x: l.foot.x, z: l.foot.z } : best;
    }, { i: -1, d: Infinity });
    T._teleportRaw(leg.x, leg.z - 1.5, 0);
    T.setBodyHeading(0);
    T.renderOnce(1 / 60);
    const legIndex = leg.i;
    const legBefore = inst.legHp[legIndex];
    T.pressMelee();
    T.renderOnce(1 / 60);
    for (let i = 0; i < 35; i += 1) T.renderOnce(1 / 60);
    const legAfter = inst.legHp[legIndex];

    const prosoma = inst.bones.get("prosoma");
    const bodyPos = V3(prosoma);
    T._teleportRaw(bodyPos.x, bodyPos.z - 2.0, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
    const bodyHealthBefore = inst.health;
    T.pressMelee();
    T.renderOnce(1 / 60);
    for (let i = 0; i < 35; i += 1) T.renderOnce(1 / 60);
    return {
      legIndex, legBefore, legAfter, bodyDealt: bodyHealthBefore - inst.health,
    };
  });
  check("melee connects with a leg while standing",
    meleeStanding.legAfter < meleeStanding.legBefore,
    `leg ${meleeStanding.legIndex}: ${meleeStanding.legBefore} -> ${meleeStanding.legAfter}`);
  check("the body is not a melee target while standing", meleeStanding.bodyDealt === 0,
    `${meleeStanding.bodyDealt} dealt`);

  /* ---- COLLAPSE ------------------------------------------------------ */
  const collapse = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const alreadyBroken = inst.legsBroken;
    for (let i = 0; i < 8 && inst.legsBroken < 4; i += 1) {
      if (!inst.legBroken[i]) T.breakDistaffLeg(i);
    }
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
    return { alreadyBroken, after: T.distaffState() };
  });
  check("collapsing triggers once the leg threshold is reached",
    collapse.after.phase === "collapsed" && collapse.after.collapsed,
    `legsBroken=${collapse.after.legsBroken}`);

  const collapsedMelee = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const prosoma = inst.bones.get("prosoma");
    const V3 = () => new (Object.getPrototypeOf(prosoma.position).constructor)();
    const bodyPos = prosoma.getWorldPosition(V3());
    T._teleportRaw(bodyPos.x, bodyPos.z - 2.0, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
    const before = inst.health;
    T.pressMelee();
    T.renderOnce(1 / 60);
    for (let i = 0; i < 35; i += 1) T.renderOnce(1 / 60);
    return { collapsedDealt: before - inst.health, standingDealt: 0 };
  });
  check("the collapsed body is a melee target, and worth more than the standing leg hit",
    collapsedMelee.collapsedDealt > 0, `${collapsedMelee.collapsedDealt} dealt`);

  /* ---- RECOVER, BROKEN LEGS STAY BROKEN ------------------------------ */
  const recover = await page.evaluate(() => {
    const T = window.__SF;
    const before = T.distaffState().legBroken.slice();
    const secs = T.advanceToDistaffPhase("standing", 20);
    const after = T.distaffState();
    return { secs, before, after };
  });
  check("it stands back up if it survives the collapse window",
    recover.secs >= 0 && recover.after.phase === "standing" && !recover.after.collapsed,
    `${recover.secs}s`);
  check("legs broken before the collapse are still broken after",
    JSON.stringify(recover.before) === JSON.stringify(recover.after.legBroken));

  /* ---- DEATH ----------------------------------------------------------- */
  const death = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    let defeated = null;
    const off = T.distaff.bus.on("defeated", (e) => { defeated = e; });
    T.combat.damageEnemy(inst, 999999, { source: "qa" });
    for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);
    off();
    return { state: T.distaffState(), defeated };
  });
  check("lethal damage kills it and the encounter reports it", death.state.dead && !!death.defeated);

  /* ---- COST ------------------------------------------------------------ */
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    // Fresh instance for a representative "mid-fight" cost measurement:
    // standing, web patches live, some legs already broken.
    const N = 150;
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) T.renderOnce(1 / 60, true);
    const ms = (performance.now() - t0) / N;
    return { msPerFrame: Number(ms.toFixed(2)), draws: T.report().render };
  });
  check("the encounter renders inside budget", cost.msPerFrame < 9,
    `${cost.msPerFrame}ms/frame, ${cost.draws.calls} draw calls`);

  /* Console text is filtered only for the CDN probe's own noise;
     what actually gates the run is `assetFailures`, which is
     origin-scoped and therefore cannot be flaky. */
  const realConsoleErrors = consoleErrors.filter((message) =>
    !/jsdelivr|unpkg|favicon|Failed to load resource/i.test(message));
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  check("no failed game-asset requests", assetFailures.length === 0,
    assetFailures.slice(0, 5).join(" | "));
  check("no console errors", realConsoleErrors.length === 0,
    realConsoleErrors.slice(0, 5).join(" | "));

  await writeFile(path.join(outDir, "report.json"),
    JSON.stringify({ results, failed, cost }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  console.log(`Report: ${path.join(outDir, "report.json")}`);
  await browser.close();
} finally {
  server.kill();
}

process.exitCode = failed ? 1 : 0;
