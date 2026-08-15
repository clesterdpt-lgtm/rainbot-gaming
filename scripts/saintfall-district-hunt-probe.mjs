#!/usr/bin/env node
/* Focused proof for the seven-boss operation, arena boundaries, and wave contract. */
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
    const byEvent = Object.fromEntries(T.ctx.enemies.live.map((inst) => [inst.eventId, inst]));
    const saint = mission.bosses.find((boss) => boss.key === "saint");
    const previous = mission.bosses.filter((boss) => boss.stage !== "penultimate");
    const isolation = previous.map((boss) => ({
      key: boss.key,
      gap: Math.hypot(saint.x - boss.x, saint.z - boss.z)
        - saint.arenaRadius - boss.arenaRadius,
    }));
    const worm = byEvent["district-boss:saint"];
    return {
      phase: mission.state.phase,
      bossesDone: mission.state.bossesDone,
      sites: mission.bosses.map((boss) => ({
        key: boss.key,
        stage: boss.stage || "district",
        done: boss.done,
        arenaRadius: boss.arenaRadius,
      })),
      waves: T.ctx.breaches.waves.map((wave) => ({
        bossKey: wave.bossKey || null,
        roster: wave.roster.map((entry) => entry.key),
      })),
      generic: hunt.status(),
      scales: {
        coulter: worm?.root?.scale?.x || 0,
        coulterSpan: worm?.spineLength || 0,
        coulterHitScale: worm?.spec?.bodyHitScale || 0,
        precentor: byEvent["district-boss:choir"]?.root?.scale?.x || 0,
        ordinaryThresher: T.ctx.enemies.species.get("thresher")?.spec?.scale || 0,
      },
      dedicated: {
        scar: T.ctx.distaff.instance()?.eventId,
        censer: T.ctx.winnower.instance()?.eventId,
      },
      isolation,
      saintStatus: hunt.status("saint"),
      objective: mission.objective(),
    };
  });

  console.log("\n=== OPERATION CONTRACT ===");
  check(initial.phase === "districtBosses", "a new operation starts in the six-district phase",
    `phase=${initial.phase}`);
  check(initial.sites.length === 7
    && initial.sites.filter((boss) => boss.stage === "district").length === 6
    && initial.sites.filter((boss) => boss.stage === "penultimate").length === 1
    && initial.sites.every((boss) => !boss.done),
  "six district bosses and the penultimate Fallen Saint boss begin undefeated",
  initial.sites.map((boss) => `${boss.key}:${boss.stage}`).join(" · "));
  check(initial.bossesDone === 0, "the complete hunt counter starts at 0 / 7");
  check(initial.objective?.bossKey !== "saint"
    && initial.sites.some((boss) => boss.key === initial.objective?.bossKey),
  "field orders point to an available district boss", initial.objective?.name || "no objective");

  console.log("\n=== BOSS ROSTER ===");
  const ossuary = initial.generic.find((boss) => boss.key === "ossuary");
  const bloom = initial.generic.find((boss) => boss.key === "bloom");
  const saint = initial.generic.find((boss) => boss.key === "saint");
  check(initial.generic.length === 3,
    "three shared-simulation bosses join the four bespoke encounters",
    initial.generic.map((boss) => `${boss.key}:${boss.enemyKey}`).join(" · "));
  /* The Ossuary left the shared roster when its placeholder became a
     real encounter - it is `domain: "garner"` now, driven by its own
     module, so it must NOT be in the generic set. Its own promises are
     covered by scripts/saintfall-garner-fight.mjs. */
  check(!ossuary && initial.sites.some((boss) => boss.key === "ossuary"),
    "the Ossuary is a bespoke encounter rather than a shared-simulation one",
    `still a mission objective, no longer in the generic roster (generic=${!!ossuary})`);
  /* The Bloom left the shared roster when the Abbess replaced the
     Matriarch. The Matriarch is still in the bestiary - the queen lays
     one under a third health - it is simply no longer a district boss
     in its own right. */
  check(!bloom && initial.sites.some((boss) => boss.key === "bloom"),
    "the Bloom is a bespoke encounter rather than a shared-simulation one",
    `generic=${!!bloom}`);
  check(saint?.enemyKey === "coulter" && saint.stage === "penultimate"
    && saint.arenaRadius === 285 && !saint.available,
  "the Coulter moved to a locked 285m Fallen Saint arena",
  `${saint?.stage} · radius ${saint?.arenaRadius}m · available=${saint?.available}`);
  check(initial.generic.every((boss) => boss.phase === "dormant" && boss.hidden && boss.locked),
    "shared bosses are hidden and damage-locked before their arena entry");
  check(initial.dedicated.scar === "district-boss:scar"
    && initial.dedicated.censer === "district-boss:censer",
  "bespoke Glass Scar and Censer bosses retain durable district identities");
  check(initial.scales.coulter >= 4.6 && initial.scales.coulterSpan >= 80
    && initial.scales.coulterHitScale === 4,
  "the Fallen Saint Coulter is roughly four times wider and longer",
  `scale ${initial.scales.coulter.toFixed(2)} · span ${initial.scales.coulterSpan.toFixed(1)}m · hit scale ${initial.scales.coulterHitScale}`);
  check(initial.scales.precentor / initial.scales.ordinaryThresher >= 2.45,
    "the Choir mantis remains at least 2.45x an ordinary Thresher",
    `${initial.scales.precentor.toFixed(2)} vs ${initial.scales.ordinaryThresher.toFixed(2)}`);
  check(initial.isolation.every((entry) => entry.gap > 300),
    "the giant sand arena is isolated from every previous boss area",
    initial.isolation.map((entry) => `${entry.key}:${entry.gap.toFixed(0)}m`).join(" · "));

  console.log("\n=== INTERMITTENT WAVES AND LOCKED SAINT ===");
  const waveBosses = initial.waves.flatMap((wave) => [wave.bossKey, ...wave.roster])
    .filter((key) => key === "matriarch" || key === "coulter");
  check(waveBosses.length === 0, "roaming wave cycles no longer spawn encounter bosses");
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
    "waves hold outside all seven undefeated boss arenas",
    arenaBlocks.map((entry) => `${entry.key}:${entry.blocked}`).join(" · "));

  const lockedSaint = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const site = T.ctx.mission.bosses.find((boss) => boss.key === "saint");
    let approaches = 0;
    const off = H.bus.on("approach", (event) => { if (event.key === "saint") approaches += 1; });
    T.ctx.player.state.x = site.x;
    T.ctx.player.state.z = site.z;
    H.update(0.05);
    off?.();
    return { status: H.status("saint"), approaches, phase: T.ctx.mission.state.phase };
  });
  check(lockedSaint.phase === "districtBosses" && lockedSaint.approaches === 0
    && !lockedSaint.status.available && lockedSaint.status.phase === "dormant"
    && lockedSaint.status.hidden && lockedSaint.status.locked,
  "the Coulter cannot reveal or warn before the six districts are secured",
  `${lockedSaint.phase} · approaches=${lockedSaint.approaches}`);

  console.log("\n=== BOUNDARY WARNINGS AND RESET ===");
  /* Measured on the CHOIR. This block is about the shared boundary
     machinery in district-bosses.js, and the roster of encounters still
     using it keeps shrinking: the Ossuary left when the Garner replaced
     its placeholder, and the Bloom left when the Abbess replaced the
     Matriarch. `H.status()` correctly returns null for both. The
     Precentor is the same shared lifecycle, still on it. */
  const boundary = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const site = T.ctx.mission.bosses.find((boss) => boss.key === "choir");
    const events = [];
    const offs = [
      H.bus.on("approach", (event) => events.push(`approach:${event.key}`)),
      H.bus.on("exitWarning", (event) => events.push(`exit:${event.key}`)),
      H.bus.on("arenaReset", (event) => events.push(`reset:${event.key}`)),
    ];
    const ps = T.ctx.player.state;
    ps.x = site.x + site.arenaRadius + 20;
    ps.z = site.z;
    H.update(0.05);
    const boss = H.status("choir");
    ps.x = boss.x + 8;
    ps.z = boss.z;
    H.update(0.05);
    for (let i = 0; i < 30; i += 1) H.update(0.1);
    const active = H.status("choir");
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    T.ctx.combat.damageEnemy(inst, 500, { source: "qa-boundary" });
    const damaged = H.status("choir");
    ps.x = site.x + site.arenaRadius - 10;
    ps.z = site.z;
    H.update(0.05);
    ps.x = site.x + site.arenaRadius + 2;
    H.update(0.05);
    const reset = H.status("choir");
    for (const off of offs) off?.();
    return { events, active, damaged, reset, missionDone: site.done };
  });
  check(boundary.events.includes("approach:choir"),
    "approaching a boss area emits an advance warning", boundary.events.join(" · "));
  check(boundary.active.phase === "active" && !boundary.active.locked
    && boundary.damaged.health < boundary.damaged.maxHealth,
  "entering the area begins a targetable fight whose damage is tracked");
  check(boundary.events.includes("exit:choir"),
    "the inner boundary warns that leaving will reset the fight", boundary.events.join(" · "));
  check(boundary.events.includes("reset:choir") && boundary.reset.phase === "dormant"
    && boundary.reset.hidden && boundary.reset.locked
    && boundary.reset.health === boundary.reset.maxHealth && !boundary.missionDone,
  "crossing the boundary restores and re-hides the undefeated boss",
  `${boundary.reset.health}/${boundary.reset.maxHealth} HP · ${boundary.events.join(" · ")}`);

  console.log("\n=== SIX-DISTRICT GATE ===");
  const districtGate = await page.evaluate(() => {
    const T = window.__SF;
    const M = T.ctx.mission;
    const districtKeys = M.bosses.filter((boss) => boss.stage !== "penultimate")
      .map((boss) => boss.key);
    const prematureSaint = M.completeDistrictBoss("saint");
    const steps = [];
    for (const key of districtKeys) {
      steps.push({ key, accepted: M.completeDistrictBoss(key), phase: M.state.phase,
        done: M.state.bossesDone });
    }
    T.ctx.districtBosses.update(0.05);
    return {
      prematureSaint,
      steps,
      phase: M.state.phase,
      done: M.state.bossesDone,
      saint: T.ctx.districtBosses.status("saint"),
      apostate: T.ctx.apostate.status(),
      objective: M.objective(),
    };
  });
  check(!districtGate.prematureSaint
    && districtGate.steps.slice(0, -1).every((step) => step.phase === "districtBosses")
    && districtGate.steps.every((step) => step.accepted),
  "the Fallen Saint victory cannot be recorded before every district boss falls");
  check(districtGate.phase === "saintBoss" && districtGate.done === 6
    && districtGate.saint.available,
  "the sixth district victory awakens the penultimate Coulter",
  `${districtGate.done}/7 · ${districtGate.phase}`);
  check(districtGate.apostate?.phase === "dormant"
    && districtGate.objective?.bossKey === "saint",
  "the Apostate remains locked while orders redirect to the Fallen Saint",
  districtGate.objective?.name || "no objective");

  const persistence = await page.evaluate(() => {
    const T = window.__SF;
    T.releaseCamera();
    T.ctx.player.state.grounded = true;
    T.ctx.player.state.free = false;
    T.ctx.player.action = null;
    T.ctx.jetpack.state.inFlight = false;
    T.ctx.boost.state.active = false;
    T.ctx.slam.state.active = false;
    T.ctx.shield.state.active = false;
    const reason = T.saves.saveReason();
    const snapshot = T.saves.capture();
    if (!snapshot) return { captured: false, accepted: false, reason };
    const legacy = structuredClone(snapshot);
    legacy.mission.phase = "cathedralBoss";
    legacy.mission.bosses = legacy.mission.bosses.filter((boss) => boss.key !== "saint");
    legacy.mission.bossesDone = legacy.mission.bosses.filter((boss) => boss.done).length;
    legacy.districtBosses.bosses = legacy.districtBosses.bosses
      .filter((boss) => boss.key !== "saint");
    legacy.enemies.live = legacy.enemies.live
      .filter((enemy) => enemy.eventId !== "district-boss:saint");
    window.__SF_LEGACY_SIX_BOSS_SAVE = legacy;
    T.ctx.mission.state.phase = "districtBosses";
    T.ctx.mission.state.bossesDone = 0;
    for (const boss of T.ctx.mission.bosses) boss.done = false;
    const accepted = T.saves.apply(snapshot);
    return {
      captured: true,
      accepted,
      reason,
      phase: T.ctx.mission.state.phase,
      bossesDone: T.ctx.mission.state.bossesDone,
      saintDone: T.ctx.mission.bosses.find((boss) => boss.key === "saint")?.done,
      saint: T.ctx.districtBosses.status("saint"),
    };
  });
  check(persistence.captured && persistence.accepted,
    "a pre-Coulter field snapshot validates and reloads", persistence.reason || "save allowed");
  check(persistence.phase === "saintBoss" && persistence.bossesDone === 6
    && !persistence.saintDone && persistence.saint?.available,
  "the six-district gate and undefeated Coulter survive reload",
  `${persistence.bossesDone}/7 · ${persistence.phase}`);

  console.log("\n=== GIANT COULTER ARENA ===");
  const saintFight = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const site = T.ctx.mission.bosses.find((boss) => boss.key === "saint");
    const events = [];
    const offs = [
      H.bus.on("approach", (event) => events.push(`approach:${event.key}`)),
      H.bus.on("exitWarning", (event) => events.push(`exit:${event.key}`)),
      H.bus.on("arenaReset", (event) => events.push(`reset:${event.key}`)),
    ];
    const ps = T.ctx.player.state;
    ps.x = site.x + site.arenaRadius + 25;
    ps.z = site.z;
    H.update(0.05);
    let boss = H.status("saint");
    ps.x = boss.x + 18;
    ps.z = boss.z;
    H.update(0.05);
    for (let i = 0; i < 30; i += 1) H.update(0.1);
    T.setCoulterPhase("crest", 9);
    T.advanceTime(0.8, 1 / 60);
    boss = H.status("saint");
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    const body = T.coulterBodies().find((entry) => entry.id === inst.id)
      || T.coulterBodies()[0];
    T.ctx.combat.damageEnemy(inst, 700, { source: "qa-saint-boundary" });
    const damaged = H.status("saint");
    ps.x = site.x + site.arenaRadius - 10;
    ps.z = site.z;
    H.update(0.05);
    ps.x = site.x + site.arenaRadius + 2;
    H.update(0.05);
    const reset = H.status("saint");
    for (const off of offs) off?.();
    return { events, boss, damaged, reset, body };
  });
  check(saintFight.events.includes("approach:saint")
    && saintFight.events.includes("exit:saint")
    && saintFight.events.includes("reset:saint"),
  "the large sand arena uses the same approach, exit, and reset contract",
  saintFight.events.join(" · "));
  check(saintFight.damaged.health < saintFight.damaged.maxHealth
    && saintFight.reset.phase === "dormant"
    && saintFight.reset.health === saintFight.reset.maxHealth,
  "leaving the Fallen Saint fully restarts the Coulter fight",
  `${saintFight.damaged.health} damaged -> ${saintFight.reset.health} reset`);
  check(saintFight.body?.joints?.length === 13,
    "the enlarged worm still exposes its complete articulated body",
    `${saintFight.body?.joints?.length || 0} visible joints`);

  const capture = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const boss = H.status("saint");
    T.ctx.player.state.x = boss.x + 24;
    T.ctx.player.state.z = boss.z + 8;
    H.update(0.05);
    for (let i = 0; i < 30; i += 1) H.update(0.1);
    T.setCoulterPhase("crest", 9);
    T.advanceTime(1.1, 1 / 60);
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    const body = T.coulterBodies().find((entry) => entry.id === inst.id)
      || T.coulterBodies()[0];
    return { head: body?.head || [inst.x, inst.y + 8, inst.z], span: inst.spineLength };
  });
  await page.evaluate(({ head }) => {
    const T = window.__SF;
    T.lookAt([head[0] + 135, head[1] + 54, head[2] + 135],
      [head[0], head[1] + 8, head[2]], 55);
  }, capture);
  await page.screenshot({ path: path.join(out, "fallen-saint-coulter.png"), fullPage: false });
  await page.evaluate(() => window.__SF.releaseCamera());

  const finalGate = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const M = T.ctx.mission;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    inst.body.hidden = false;
    inst.encounterHidden = false;
    inst.encounterLocked = false;
    const dealt = T.ctx.combat.damageEnemy(inst, inst.maxHealth + 1, { source: "qa-hunt" });
    H.update(0.05);
    M.update(0.05);
    return {
      dealt,
      phase: M.state.phase,
      done: M.state.bossesDone,
      saintDone: M.bosses.find((boss) => boss.key === "saint")?.done,
      objective: M.objective(),
    };
  });
  check(finalGate.dealt > 0 && finalGate.saintDone
    && finalGate.phase === "cathedralBoss" && finalGate.done === 7,
  "defeating the Coulter records victory seven and opens the Cathedral",
  `${finalGate.done}/7 · ${finalGate.phase}`);
  check(finalGate.objective?.name?.includes("CATHEDRAL")
    || finalGate.objective?.name?.includes("APOSTATE"),
  "field orders switch from the hunt to the Apostate finale",
  finalGate.objective?.name || "no objective");

  const legacyMigration = await page.evaluate(() => {
    const T = window.__SF;
    const accepted = T.saves.apply(window.__SF_LEGACY_SIX_BOSS_SAVE);
    return {
      accepted,
      phase: T.ctx.mission.state.phase,
      done: T.ctx.mission.state.bossesDone,
      saintDone: T.ctx.mission.bosses.find((boss) => boss.key === "saint")?.done,
    };
  });
  check(legacyMigration.accepted && legacyMigration.phase === "cathedralBoss"
    && legacyMigration.done === 7 && legacyMigration.saintDone,
  "a live six-boss Cathedral save migrates without losing final access",
  `${legacyMigration.done}/7 · ${legacyMigration.phase}`);

  check(errors.length === 0, "the focused browser run has no page or console errors",
    errors.join(" | "));
  const report = { checks: results.length, passed: results.filter((r) => r.ok).length,
    failures, capture, results };
  await fs.writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.passed}/${report.checks} checks passed`);
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}

if (failures.length) process.exitCode = 1;
