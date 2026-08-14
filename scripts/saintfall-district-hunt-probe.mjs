#!/usr/bin/env node
/* Focused proof for the six-boss operation and intermittent wave contract. */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "output/saintfall/district-hunt-probe");
await fs.mkdir(out, { recursive: true });
const port = 56500 + (process.pid % 800);
const base = `http://127.0.0.1:${port}`;
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const failures = [];
const results = [];
function check(ok, label, detail = "") {
  const entry = { ok: !!ok, label, detail };
  results.push(entry);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures.push(label);
}

let browser;
try {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/jsdelivr|unpkg|gstatic|googleapis/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=low&intro=skip&seed=district-hunt`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const initial = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(true);
    const mission = T.ctx.mission;
    const hunt = T.ctx.districtBosses;
    const byKey = Object.fromEntries(T.ctx.enemies.live.map((inst) => [inst.eventId, inst]));
    return {
      phase: mission.state.phase,
      bossesDone: mission.state.bossesDone,
      sites: mission.bosses.map((boss) => ({ key: boss.key, done: boss.done })),
      waves: T.ctx.breaches.waves.map((wave) => ({
        bossKey: wave.bossKey || null,
        roster: wave.roster.map((entry) => entry.key),
      })),
      generic: hunt.status(),
      scales: {
        coulter: byKey["district-boss:ossuary"]?.root?.scale?.x || 0,
        precentor: byKey["district-boss:choir"]?.root?.scale?.x || 0,
        ordinaryThresher: T.ctx.enemies.species.get("thresher")?.spec?.scale || 0,
      },
      dedicated: {
        scar: T.ctx.distaff.instance()?.eventId,
        censer: T.ctx.winnower.instance()?.eventId,
      },
      objective: mission.objective(),
    };
  });

  console.log("\n=== OPERATION CONTRACT ===");
  check(initial.phase === "districtBosses", "a new operation starts in the district-boss phase",
    `phase=${initial.phase}`);
  check(initial.sites.length === 6 && initial.sites.every((boss) => !boss.done),
    "all six district guardians begin undefeated", initial.sites.map((boss) => boss.key).join(", "));
  check(initial.bossesDone === 0, "the hunt counter starts at 0 / 6");
  check(initial.objective?.bossKey && initial.sites.some((boss) => boss.key === initial.objective.bossKey),
    "field orders point to an undefeated district boss", initial.objective?.name || "no objective");

  console.log("\n=== BOSS ROSTER ===");
  check(initial.generic.length === 4,
    "four shared-simulation guardians join the Distaff and Winnower",
    initial.generic.map((boss) => `${boss.key}:${boss.enemyKey}`).join(" · "));
  check(initial.generic.every((boss) => boss.phase === "dormant" && boss.hidden && boss.locked),
    "shared district bosses are hidden and damage-locked before arena entry");
  check(initial.dedicated.scar === "district-boss:scar"
    && initial.dedicated.censer === "district-boss:censer",
  "bespoke Glass Scar and Censer bosses carry durable district identities");
  check(initial.scales.coulter >= 1.15,
    "the Ossuary Coulter is larger than its former wave silhouette",
    `root scale ${initial.scales.coulter.toFixed(2)}`);
  check(initial.scales.precentor / initial.scales.ordinaryThresher >= 2.45,
    "the Choir mantis is at least 2.45x an ordinary Thresher",
    `${initial.scales.precentor.toFixed(2)} vs ${initial.scales.ordinaryThresher.toFixed(2)}`);

  console.log("\n=== INTERMITTENT WAVES ===");
  const waveBosses = initial.waves.flatMap((wave) => [wave.bossKey, ...wave.roster])
    .filter((key) => key === "matriarch" || key === "coulter");
  check(waveBosses.length === 0,
    "roaming wave cycles no longer spawn district bosses");
  const arenaBlocks = await page.evaluate(() => {
    const T = window.__SF;
    const out = [];
    const ps = T.ctx.player.state;
    const before = { x: ps.x, z: ps.z };
    for (const site of T.ctx.mission.bosses) {
      ps.x = site.x;
      ps.z = site.z;
      T.ctx.breaches.update(0.02);
      out.push({ key: site.key, blocked: T.ctx.breaches.status().blockedByBoss });
    }
    ps.x = before.x;
    ps.z = before.z;
    return out;
  });
  check(arenaBlocks.every((entry) => entry.blocked === entry.key),
    "waves hold outside all six undefeated district arenas",
    arenaBlocks.map((entry) => `${entry.key}:${entry.blocked}`).join(" · "));

  const engagement = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const choir = T.ctx.mission.bosses.find((boss) => boss.key === "choir");
    T.teleport(choir.x, choir.z, 0);
    H.update(0.05);
    const alert = H.status("choir");
    for (let i = 0; i < 30; i += 1) H.update(0.1);
    const active = H.status("choir");
    return { alert, active };
  });
  await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    T.lookAt([inst.x, inst.y + 34, inst.z],
      [inst.x, inst.y + 1.2, inst.z], 38);
  });
  await page.screenshot({ path: path.join(out, "choir-active.png"), fullPage: false });
  await page.evaluate(() => window.__SF.releaseCamera());
  const defeat = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const dealt = T.ctx.combat.damageEnemy(inst, inst.maxHealth + 1, { source: "qa-hunt" });
    H.update(0.05);
    T.ctx.mission.update(0.05);
    return {
      dealt,
      after: H.status("choir"),
      mission: T.ctx.mission.snapshot(),
    };
  });
  console.log("\n=== ARENA HANDOFF ===");
  check(engagement.alert.phase === "alert" && !engagement.alert.hidden && engagement.alert.locked,
    "arena entry reveals the giant mantis while retaining the damage lock");
  check(engagement.active.phase === "active" && !engagement.active.locked,
    "the reveal hands off to a targetable boss fight");
  check(defeat.dealt > 0 && defeat.after.defeated,
    "killing the promoted mantis records a district victory");
  check(defeat.mission.bossesDone === 1
    && defeat.mission.bosses.find((boss) => boss.key === "choir")?.done,
  "the authoritative mission counter advances to 1 / 6");

  await page.screenshot({ path: path.join(out, "choir-defeated.png"), fullPage: false });

  const persistence = await page.evaluate(() => {
    const T = window.__SF;
    const snapshot = T.saves.capture();
    if (!snapshot) return { captured: false, accepted: false };
    T.ctx.mission.state.bossesDone = 0;
    for (const boss of T.ctx.mission.bosses) boss.done = false;
    const accepted = T.saves.apply(snapshot);
    return {
      captured: true,
      accepted,
      phase: T.ctx.mission.state.phase,
      bossesDone: T.ctx.mission.state.bossesDone,
      choirDone: T.ctx.mission.bosses.find((boss) => boss.key === "choir")?.done,
      choir: T.ctx.districtBosses.status("choir"),
    };
  });
  console.log("\n=== SAVE AND FINAL GATE ===");
  check(persistence.captured && persistence.accepted,
    "a mid-hunt field snapshot validates and reloads");
  check(persistence.bossesDone === 1 && persistence.choirDone && persistence.choir?.defeated,
    "district victory and boss lifecycle survive reload");

  const finalGate = await page.evaluate(() => {
    const T = window.__SF;
    const M = T.ctx.mission;
    const remaining = M.bosses.filter((boss) => !boss.done).map((boss) => boss.key);
    const before = [];
    for (const key of remaining) {
      before.push({ key, accepted: M.completeDistrictBoss(key), phase: M.state.phase });
    }
    return {
      before,
      phase: M.state.phase,
      done: M.state.bossesDone,
      apostate: T.ctx.apostate.status(),
      objective: M.objective(),
    };
  });
  check(finalGate.before.slice(0, -1).every((step) => step.phase === "districtBosses"),
    "the Apostate remains gated while any district boss survives");
  check(finalGate.phase === "cathedralBoss" && finalGate.done === 6,
    "the sixth victory unlocks the Cathedral and Apostate", `${finalGate.done}/6 · ${finalGate.phase}`);
  check(finalGate.objective?.name?.includes("CATHEDRAL") || finalGate.objective?.name?.includes("APOSTATE"),
    "field orders switch from district hunt to the Cathedral finale",
    finalGate.objective?.name || "no objective");

  check(errors.length === 0, "the focused browser run has no page or console errors",
    errors.join(" | "));
  const report = { checks: results.length, passed: results.filter((r) => r.ok).length, failures, results };
  await fs.writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.passed}/${report.checks} checks passed`);
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}

if (failures.length) process.exitCode = 1;
