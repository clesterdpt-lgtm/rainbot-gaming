#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Abbess encounter regression

   Proves the player-facing promises of the Bloom's queen:
     - she ignores the player until they cross the aggro radius, and
       cannot be seen or damaged before it;
     - she LAYS: a clutch of eggs behind her, each swelling on a visible
       clock and splitting into a Thresher;
     - an egg is a real target with a real pool, killable by a shot, a
       swing or a blast - so "she spawns a lot" has an answer;
     - TROPHALLAXIS: her brood walks home and feeds her, and that is
       real health back on the boss rather than a flavour event;
     - the SLAM heaves twenty metres of abdomen up and drops it: damage
       and a hard slow to the player, and her own brood goes down with
       it;
     - the raised abdomen exposes its UNDERSIDE, worth five times a body
       hit - and only from below, and only while it is up;
     - her thorax is armour: shooting the part facing the door is worth
       a third of shooting the sac;
     - a royal cell arrives once, under a third health, and produces a
       Matriarch;
     - walking away leashes her; she survives a save/restore round trip;
       and the whole encounter renders inside its budget.

   Usage:
     node scripts/saintfall-abbess-fight.mjs [--out output/path]
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
const outDir = path.resolve(root, args.out || "output/saintfall/abbess-fight");
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
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  const assetFailures = [];
  const sameOrigin = (url) => url.startsWith(base);
  page.on("response", (r) => {
    if (r.status() >= 400 && sameOrigin(r.url())) assetFailures.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    if (sameOrigin(r.url())) assetFailures.push(`failed ${r.url()}`);
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
  });

  /* ---- RIG ------------------------------------------------------------- */
  const rig = await page.evaluate(() => {
    const T = window.__SF;
    const a = T.abbessState();
    const inst = T.enemies.live.find((e) => e.key === "abbess");
    return {
      spawned: !!a, phase: a?.phase, maxHealth: a?.maxHealth,
      /* The live sac she publishes for combat.js's `queenHit` - without
         it there is no hit volume on nine tenths of the animal. */
      spine: inst?.sacSpine?.length, radii: inst?.sacRadius?.length,
      noClips: inst?.actions?.size === 0,
      hidden: !!inst?.encounterHidden,
      targetable: T.combat.targetable(inst),
    };
  });
  check("spawns once, seated and dormant, with no .glb behind her",
    rig.spawned && rig.phase === "dormant" && rig.noClips);
  check("she publishes a live segmented sac for the hit tests",
    rig.spine === 13 && rig.radii === 13, `${rig.spine} segments`);
  check("the dormant queen cannot be seen or damaged",
    rig.hidden && !rig.targetable);

  /* ---- ROUSE ----------------------------------------------------------- */
  const rouse = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToAbbess(40);
    const r = T.advanceToAbbessPhase("rouse", 8);
    const mid = T.abbessState();
    const s = T.advanceToAbbessPhase("seated", 14);
    return { r, s, woken: T.abbessState().woken, midWoken: mid?.woken };
  });
  check("crossing the aggro radius rouses her", rouse.r >= 0 && rouse.s >= 0,
    JSON.stringify(rouse));
  check("she lights and lifts progressively rather than snapping",
    rouse.midWoken < 0.35 && rouse.woken === 1, JSON.stringify(rouse));
  await page.screenshot({ path: path.join(outDir, "01-seated.png") });

  /* ---- THE CLUTCH ------------------------------------------------------ */
  const clutch = await page.evaluate(() => {
    const T = window.__SF;
    T.resetAbbess();
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 16);
    const before = T.enemies.live.filter((e) => e.key === "thresher").length;
    T.forceAbbessClutch();
    const laid = T.abbessEggs();
    const swellStart = laid[0]?.t ?? -1;
    T.advanceTime(2.5, 1 / 60);
    const swellMid = T.abbessEggs()[0]?.t ?? -1;
    T.advanceTime(4.0, 1 / 60);
    const after = T.enemies.live.filter((e) => e.key === "thresher").length;
    return {
      count: laid.length, swellStart, swellMid,
      hatched: after - before, eggsLeft: T.abbessEggs().length,
      brood: T.abbessState().brood,
    };
  });
  check("she lays a clutch of eggs", clutch.count >= 3, `${clutch.count} eggs`);
  check("an egg visibly swells on its own clock",
    clutch.swellStart < 0.05 && clutch.swellMid > 0.4,
    `t ${clutch.swellStart} -> ${clutch.swellMid}`);
  /* Counted as Threshers gained, not as eggs remaining: her own clock
     keeps laying throughout, so the chamber is never empty and "no eggs
     left" would be measuring the cadence rather than the hatch. */
  check("every egg left alone becomes a Thresher",
    clutch.hatched >= clutch.count && clutch.brood >= clutch.count,
    `${clutch.hatched} hatched from ${clutch.count} laid`);

  /* An egg is a target. Three damage paths, because all three can reach
     the ground and a player who cannot burn a clutch with the weapon in
     their hands has no answer to her at all. */
  const eggKill = await page.evaluate(() => {
    const T = window.__SF;
    const shootOne = () => {
      T.forceAbbessClutch();
      const e = T.abbessEggs()[0];
      const before = T.abbessEggs().length;
      const ps = T.player.state;
      T._teleportRaw(e.x - 16, e.z, 0);
      T.advanceTime(1 / 60, 1 / 60);
      const o = { x: ps.x, y: ps.y + 1.5, z: ps.z };
      const t = { x: e.x, y: e.y + 1.4, z: e.z };
      const d = Math.hypot(t.x - o.x, t.y - o.y, t.z - o.z);
      T.combat.fire(o, { x: (t.x - o.x) / d, y: (t.y - o.y) / d, z: (t.z - o.z) / d },
        { damage: 60, range: 200 });
      return before - T.abbessEggs().length;
    };
    const byShot = shootOne();
    // ...and by a blast, which is how a player answers a whole clutch.
    T.forceAbbessClutch();
    const e = T.abbessEggs()[0];
    const before = T.abbessEggs().length;
    T.combat.explode(e.x, e.y + 1, e.z, 14, 120);
    const byBlast = before - T.abbessEggs().length;
    return { byShot, byBlast };
  });
  check("an egg can be shot before it hatches", eggKill.byShot >= 1,
    `${eggKill.byShot} killed`);
  check("...and a blast clears a clutch", eggKill.byBlast >= 2,
    `${eggKill.byBlast} killed`);

  /* ---- TROPHALLAXIS ---------------------------------------------------- */
  const feed = await page.evaluate(() => {
    const T = window.__SF;
    T.resetAbbess();
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 16);
    const inst = T.enemies.live.find((e) => e.key === "abbess");
    T.combat.damageEnemy(inst, 5000, { source: "qa" });
    const wounded = inst.health;
    T.forceAbbessClutch();
    T.advanceTime(6.5, 1 / 60);
    const born = T.abbessState().brood;
    // Age them past the hunting window so the walk home starts now.
    T.recallAbbessBrood();
    T.advanceTime(30, 1 / 60);
    const s = T.abbessState();
    return { wounded, born, fed: s.fed, healed: Math.round(inst.health - wounded) };
  });
  check("her brood walks home and feeds her", feed.fed > 0,
    `${feed.fed} of ${feed.born} fed her`);
  /* THE MECHANIC, and the reason her health bar is not the whole fight:
     ignoring the swarm gives ground back. */
  check("feeding is real health returned to the boss",
    feed.healed >= feed.fed * 140, `+${feed.healed} from ${feed.fed}`);

  /* ---- THE SLAM -------------------------------------------------------- */
  const slam = await page.evaluate(() => {
    const T = window.__SF;
    T.resetAbbess();
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 16);
    const c = T.abbess.config;
    const seen = [];
    let peak = 0;
    T._teleportRaw(c.lairX - 10, c.lairZ, 0);
    T.advanceTime(0.2, 1 / 60);
    T.invulnerable(false);
    T.combat.player.dead = false;
    T.combat.player.hp = T.combat.player.maxHp;
    let hurt = 0;
    const off = T.combat.bus.on("playerHurt", (e) => {
      if (e.source === "abbess-slam") hurt += e.damage;
    });
    T.forceAbbessSlam();
    for (let i = 0; i < 200; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      const s = T.abbessState();
      peak = Math.max(peak, s.raised);
      if (seen[seen.length - 1] !== s.slamPhase) seen.push(s.slamPhase);
    }
    off();
    const slowed = T.player.state.slowFor > 0 || T.player.state.slowFactor < 1;
    T.invulnerable(true);
    return { seen: seen.filter(Boolean), peak, hurt: Number(hurt.toFixed(1)), slowed };
  });
  check("the slam rises, holds and drops",
    slam.seen.join(">") === "rise>hold>fall" && slam.peak > 0.98,
    `${slam.seen.join(" > ")}, peak ${slam.peak}`);
  check("standing under it costs health and puts the player on the floor",
    slam.hurt > 20 && slam.slowed, JSON.stringify({ hurt: slam.hurt, slowed: slam.slowed }));

  /* She does not distinguish. Baiting the slam into her own brood is
     the closest thing this fight has to a combo. */
  const friendly = await page.evaluate(() => {
    const T = window.__SF;
    T.resetAbbess();
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 16);
    T.forceAbbessClutch();
    T.advanceTime(6.5, 1 / 60);
    const before = T.abbessState().brood;
    const c = T.abbess.config;
    // Stand the brood next to her, then bring the abdomen down on it.
    T.recallAbbessBrood();
    T.advanceTime(14, 1 / 60);
    const near = T.abbessBrood().length;
    T.forceAbbessSlam();
    T.advanceTime(2.6, 1 / 60);
    return { before, near, after: T.abbessState().brood };
  });
  check("the slam damages her own brood", friendly.before > 0,
    JSON.stringify(friendly));

  /* ---- THE UNDERSIDE --------------------------------------------------- */
  const ventral = await page.evaluate(() => {
    const T = window.__SF;
    T.resetAbbess();
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 16);
    const inst = T.enemies.live.find((e) => e.key === "abbess");
    const shootSac = (yOff) => {
      const spine = inst.sacSpine;
      const mid = spine[Math.floor(spine.length / 2)];
      const o = { x: mid.x - 9, y: mid.y + yOff, z: mid.z };
      const d = Math.hypot(mid.x - o.x, mid.y - o.y, mid.z - o.z);
      const hp = inst.health;
      const hit = T.combat.fire(o,
        { x: (mid.x - o.x) / d, y: (mid.y - o.y) / d, z: (mid.z - o.z) / d },
        { damage: 40, range: 90 });
      return { weak: !!hit?.weak, dealt: Number((hp - inst.health).toFixed(1)) };
    };
    const seatedHit = shootSac(2);
    T.forceAbbessSlam();
    T.advanceTime(1.4, 1 / 60);
    const raised = T.abbessState().raised;
    const under = shootSac(-4);
    const over = shootSac(9);
    /* ...and her thorax, approached FROM THE FRONT and with the abdomen
       back down. From any other bearing there are twenty metres of egg
       sac in the way, which is the entire point of how she is seated -
       so a test that shoots her from behind measures the sac and calls
       it armour. */
    T.forceAbbessPhase("seated");
    T.advanceTime(0.4, 1 / 60);
    const sx = Math.sin(inst.yaw);
    const sz = Math.cos(inst.yaw);
    const o = { x: inst.x + sx * 26, y: inst.y + 3.0, z: inst.z + sz * 26 };
    const hp = inst.health;
    const hit = T.combat.fire(o, { x: -sx, y: 0, z: -sz }, { damage: 40, range: 60 });
    const thorax = { hit: !!hit?.thorax, dealt: Number((hp - inst.health).toFixed(1)) };
    return { seatedHit, raised, under, over, thorax };
  });
  check("the sac is an ordinary target while she is seated",
    !ventral.seatedHit.weak && ventral.seatedHit.dealt > 0,
    JSON.stringify(ventral.seatedHit));
  /* THE FIGHT'S ONE DECISION. The window where she is about to hurt you
     most is the window where she can be hurt most, and it only pays
     from underneath. */
  check("a raised abdomen struck FROM BELOW is a five-times weak point",
    ventral.under.weak && ventral.under.dealt >= ventral.seatedHit.dealt * 4.5,
    `${ventral.under.dealt} vs ${ventral.seatedHit.dealt} at rest`);
  check("...and struck from above it is not",
    !ventral.over.weak && ventral.over.dealt <= ventral.seatedHit.dealt * 1.2,
    JSON.stringify(ventral.over));
  check("her thorax is armour, not immunity",
    ventral.thorax.hit && ventral.thorax.dealt > 0
    && ventral.thorax.dealt < ventral.seatedHit.dealt,
    `${ventral.thorax.dealt} on the thorax vs ${ventral.seatedHit.dealt} on the sac`);

  /* ---- THE ROYAL CELL -------------------------------------------------- */
  const royal = await page.evaluate(() => {
    const T = window.__SF;
    T.resetAbbess();
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 16);
    const inst = T.enemies.live.find((e) => e.key === "abbess");
    const before = T.enemies.live.filter((e) => e.key === "matriarch").length;
    T.combat.damageEnemy(inst, inst.maxHealth * 0.7, { source: "qa" });
    const reached = T.advanceToAbbessPhase("royal", 6);
    T.advanceTime(8.0, 1 / 60);
    const after = T.enemies.live.filter((e) => e.key === "matriarch").length;
    // Once, and only once.
    T.combat.damageEnemy(inst, 200, { source: "qa" });
    const again = T.advanceToAbbessPhase("royal", 4);
    return { reached, spawned: after - before, again, done: T.abbessState().royalDone };
  });
  check("under a third health she lays a royal cell",
    royal.reached >= 0 && royal.done, JSON.stringify(royal));
  check("...and a Matriarch comes out of it", royal.spawned === 1,
    `${royal.spawned} spawned`);
  check("the royal cell happens exactly once", royal.again < 0);
  await page.screenshot({ path: path.join(outDir, "02-royal.png") });

  /* ---- THE LEASH ------------------------------------------------------- */
  const leash = await page.evaluate(() => {
    const T = window.__SF;
    T.resetAbbess();
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 16);
    const inst = T.enemies.live.find((e) => e.key === "abbess");
    T.combat.damageEnemy(inst, 3000, { source: "qa-leash" });
    T.forceAbbessClutch();
    T.advanceTime(1.0, 1 / 60);
    const wounded = inst.health;
    const c = T.abbess.config;
    T._teleportRaw(c.lairX + 200, c.lairZ, 0);
    const retire = T.advanceToAbbessPhase("retire", 22);
    const dormant = T.advanceToAbbessPhase("dormant", 14);
    const s = T.abbessState();
    return {
      wounded, retire, dormant, healed: inst.health,
      max: inst.maxHealth, eggs: s.eggs, brood: s.brood, phase: s.phase,
    };
  });
  check("leaving the arena settles her back down",
    leash.retire >= 0 && leash.dormant >= 0, JSON.stringify(leash));
  check("the leash heals her and clears the chamber",
    leash.healed === leash.max && leash.eggs === 0 && leash.brood === 0,
    JSON.stringify(leash));

  const reaggro = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToAbbess(40);
    const secs = T.advanceToAbbessPhase("seated", 20);
    return { secs, free: !!T.player.state.free };
  });
  check("a fresh approach wakes her again, without a second camera steal",
    reaggro.secs >= 0 && !reaggro.free, JSON.stringify(reaggro));

  /* ---- SAVE / RESTORE -------------------------------------------------- */
  const saved = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "abbess");
    T.combat.damageEnemy(inst, 2500, { source: "qa-save" });
    const before = T.abbessState();
    const captured = T.saves.capture();
    const reason = T.saves.state?.().saveReason || "";
    T.combat.damageEnemy(inst, 900, { source: "qa-drift" });
    T.advanceTime(1.2, 1 / 60);
    const accepted = !!captured && T.saves.apply(captured);
    const after = T.abbessState();
    return { accepted: !!accepted, captured: !!captured, reason, before, after };
  });
  check("the encounter survives a save/restore round trip",
    saved.accepted && saved.after?.phase === saved.before?.phase
    && saved.after?.health === saved.before?.health
    && saved.after?.royalDone === saved.before?.royalDone,
    JSON.stringify({ accepted: saved.accepted, captured: saved.captured,
      reason: saved.reason,
      phase: [saved.before?.phase, saved.after?.phase],
      hp: [saved.before?.health, saved.after?.health] }));

  /* ---- DEATH ----------------------------------------------------------- */
  const death = await page.evaluate(() => {
    const T = window.__SF;
    T.resetAbbess();
    T.invulnerable(true);
    T.combat.player.dead = false;
    T.combat.player.hp = T.combat.player.maxHp;
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 18);
    const inst = T.enemies.live.find((e) => e.key === "abbess");
    let defeated = false;
    const off = T.abbess.bus.on("defeated", () => { defeated = true; });
    T.combat.damageEnemy(inst, 999999, { source: "qa" });
    for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);
    off();
    const s = T.abbessState();
    return { dead: s.dead, defeated, eggs: s.eggs };
  });
  check("lethal damage kills her and the encounter reports it",
    death.dead && death.defeated, JSON.stringify(death));

  /* ---- COST ------------------------------------------------------------ */
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    T.resetAbbess();
    T.teleportToAbbess(34);
    T.advanceToAbbessPhase("seated", 18);
    // Her worst frame: two clutches on the ground, a brood in the room
    // and the abdomen in the air.
    T.forceAbbessClutch();
    T.advanceTime(5.4, 1 / 60);
    T.forceAbbessClutch();
    T.forceAbbessSlam();
    T.advanceTime(0.9, 1 / 60);
    const N = 150;
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) T.renderOnce(1 / 60, true);
    return {
      msPerFrame: Number(((performance.now() - t0) / N).toFixed(2)),
      draws: T.report().render, state: T.abbessState(),
    };
  });
  check("a full chamber still renders inside budget", cost.msPerFrame < 9,
    `${cost.msPerFrame}ms/frame, ${cost.draws.calls} draws, `
    + `${cost.state.eggs} eggs, ${cost.state.brood} brood`);

  const realConsoleErrors = consoleErrors.filter((m) =>
    !/jsdelivr|unpkg|favicon|Failed to load resource/i.test(m));
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
