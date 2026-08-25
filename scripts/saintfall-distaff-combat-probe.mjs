#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Distaff Web-Bite and Continuous Leg Combat Probe

   What this file is FOR: the Distaff's legs do not break. They take
   damage for ever, each hit spends a fraction of itself on the body
   (`legDamageToBody`) and the rest on the FOOTING pool, and emptying
   that pool is what puts the animal on the ground. Those are three
   separate numbers and this probe proves each of them moves.

   It used to assert them as literals - `health === initial - 60`, a
   340-point stance - which was true only while the stance pool and one
   leg's own pool happened to be the same number and while a leg hit
   conducted at 1:1. Both of those were the bug: a rifle emptied the
   stance in about a second and the boss spent 72% of a ranged fight
   lying down, and the legs were a second, easier health bar the body
   never had to be reached through. Everything below is read off the
   live config now, so a retune moves the expectation with it.
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, "output/saintfall/distaff-combat");
const port = 52100 + (process.pid % 5000);
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
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 120000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
  });

  console.log("=== DISTAFF WEB AND LEG COMBAT VERIFICATION ===");

  // 1. Teleport to Glass Scar and awaken Distaff
  await page.evaluate(() => {
    const T = window.__SF;
    T.distaff.resetToLair();
    T.teleportToDistaff(25);
    T.advanceToDistaffPhase("standing", 10);
  });

  // 2. Test Continuous Leg Damage & Footing Collapse
  const legCombat = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const C = T.distaff.config;
    const shot = (leg, dmg) => T.combat.damageLeg(inst, leg, dmg,
      { x: inst.x, y: inst.y, z: inst.z, source: "shot" });
    const initialHealth = inst.health;
    const legFull = inst.legHp[0];
    const footingFull = T.distaffState().footingMax;

    // One hit on leg 0: the limb pool takes all of it, the body a share.
    const footing0 = T.distaffState().footingHp;
    shot(0, 60);
    const after0 = {
      leg0: inst.legHp[0], health: inst.health, broken0: inst.legBroken[0],
      bodyLost: initialHealth - inst.health,
      footingLost: footing0 - T.distaffState().footingHp,
    };

    // Damage leg 1 (should NOT reset leg 0!)
    shot(1, 70);
    // Damage leg 2
    shot(2, 80);
    const after2 = { leg0: inst.legHp[0], leg1: inst.legHp[1], leg2: inst.legHp[2] };

    /* A LANCE BUCKLES A STANCE HARDER THAN A BULLET (footingMeleeWeight)
       - the same blow through the same function, told apart only by its
       source. */
    const meleeBefore = T.distaffState().footingHp;
    T.combat.damageLeg(inst, 4, 100, { x: inst.x, y: inst.y, z: inst.z, source: "melee" });
    const meleeDrain = meleeBefore - T.distaffState().footingHp;

    // Empty what is left of the stance and watch it go over.
    const footingBefore = T.distaffState().footingHp;
    shot(3, footingBefore + 1);
    for (let f = 0; f < 30; f += 1) T.renderOnce(1 / 60);
    const afterCollapse = T.distaffState();

    return {
      initialHealth, legFull, footingFull,
      conduction: C.legConduction,
      meleeWeight: C.footingMeleeWeight,
      after0, after2, meleeDrain, footingBefore,
      afterCollapsePhase: afterCollapse.phase,
      afterCollapseCollapsed: afterCollapse.collapsed,
      legsBroken: afterCollapse.legsBroken,
      allLegsHittable: !inst.legBroken.some(Boolean),
    };
  });

  check("a leg hit conducts a fraction of itself into the body and keeps the leg active",
    Math.abs(legCombat.after0.bodyLost - 60 * legCombat.conduction) < 1
      && !legCombat.after0.broken0,
    `${60} to the leg -> ${legCombat.after0.bodyLost} off the body `
      + `(x${legCombat.conduction}); boss ${legCombat.initialHealth} -> ${legCombat.after0.health}`);

  check("the rest of a leg hit is spent on the footing pool",
    Math.abs(legCombat.after0.footingLost - 60) < 1
      && legCombat.footingFull > legCombat.legFull,
    `footing -${legCombat.after0.footingLost} of ${legCombat.footingFull} `
      + `(one leg's own pool is ${legCombat.legFull})`);

  check("a swing buckles the stance harder than a shot does",
    Math.abs(legCombat.meleeDrain - 100 * legCombat.meleeWeight) < 1,
    `100 melee drained ${legCombat.meleeDrain} footing (x${legCombat.meleeWeight})`);

  check("damaging multiple legs preserves damage across all legs without target-switch resets",
    legCombat.after2.leg0 === legCombat.legFull - 60
      && legCombat.after2.leg1 === legCombat.legFull - 70
      && legCombat.after2.leg2 === legCombat.legFull - 80,
    `leg0=${legCombat.after2.leg0}, leg1=${legCombat.after2.leg1}, leg2=${legCombat.after2.leg2}`);

  check("cumulative leg damage causes Distaff to lose footing and enter collapsed state",
    legCombat.afterCollapsePhase === "collapsed" && legCombat.afterCollapseCollapsed,
    `phase=${legCombat.afterCollapsePhase}, collapsed=${legCombat.afterCollapseCollapsed}`);

  check("legs are never killed/disabled and remain live targets",
    legCombat.allLegsHittable, "all 8 legs remain unbroken");

  // 3. Test Web Reel -> Bite Attack Sequence
  const webReelBite = await page.evaluate(() => {
    const T = window.__SF;
    T.distaff.resetToLair();
    T.teleportToDistaff(18);
    T.advanceToDistaffPhase("standing", 10);

    const ev = { biteTelegraph: 0, bite: 0, biteMiss: 0, reelHit: 0, reelEnd: 0,
      slamTelegraph: 0 };
    const offs = Object.keys(ev).map((k) => T.distaff.bus.on(k, () => { ev[k] += 1; }));

    // Prime and launch web reel
    T.distaff.primeAttack("reel");
    for (let f = 0; f < 300; f += 1) T.renderOnce(1 / 60);

    offs.forEach((f) => f());
    return { events: ev, state: T.distaffState() };
  });

  /* THE HAUL CASHES INTO WHATEVER THE ANIMAL CAN ACTUALLY REACH. A
     bite is 42 with a 0.45s contact and the line puts the trooper at
     `reelStop`, which is further out than `biteReach` measured from
     the head - so thrown there it was not an attack with an answer, it
     was a toll (three hooks in four throws, 126 of a 150-point
     trooper). The mouth takes it if the mouth is genuinely over them;
     otherwise the stamp does, which has a 0.9s tell and a ring to
     sprint out of. Either is a pass; nothing is not. */
  check("web reel pulls the player in and cashes into an attack",
    webReelBite.events.reelHit > 0
      && (webReelBite.events.biteTelegraph > 0 || webReelBite.events.bite > 0
        || webReelBite.events.biteMiss > 0 || webReelBite.events.slamTelegraph > 0),
    JSON.stringify(webReelBite.events));

  // 4. Test Web Pin (Web Bolt) -> Bite Reaction
  const webPinBite = await page.evaluate(() => {
    const T = window.__SF;
    T.distaff.resetToLair();
    T.teleportToDistaff(7);
    T.advanceToDistaffPhase("standing", 10);

    const ev = { biteTelegraph: 0, bite: 0, biteMiss: 0, webHit: 0 };
    const offs = Object.keys(ev).map((k) => T.distaff.bus.on(k, () => { ev[k] += 1; }));

    // Apply web root to simulate web hit
    T.player.applyRoot(3.5);
    for (let f = 0; f < 120; f += 1) T.renderOnce(1 / 60);

    offs.forEach((f) => f());
    return { events: ev, state: T.distaffState() };
  });

  check("webbed/pinned player is targeted with bite attack",
    webPinBite.events.biteTelegraph > 0 || webPinBite.events.bite > 0 || webPinBite.events.biteMiss > 0,
    JSON.stringify(webPinBite.events));

  // 5. Test Recovery and Re-knocking Down
  const recoveryReKnockdown = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const C = T.distaff.config;
    /* MEASURED OFF A RISE, not off "it is standing". The brace is a
       few seconds long and this probe reaches here with the animal
       already up from an earlier section, by which time it has
       expired - which reads as "no brace" when the brace simply
       happened several tests ago. Put it down, let it get up, test. */
    T.forceDistaffPhase("collapsed", 0.2);
    T.advanceToDistaffPhase("standing", 20);
    const stateStanding = T.distaffState();

    /* THE BRACE. Straight off a rise, the stance cannot be emptied at
       all - it re-plants at full every frame until `recollapseGuard`
       runs out. This is the rule that ended the chain-collapse: seven
       knockdowns in sixty-eight seconds, 72% of a ranged fight spent
       shooting a prone animal. */
    const drained = T.distaffState().footingHp;
    T.combat.damageLeg(inst, 0, C.footingPool * 2, {
      x: inst.x, y: inst.y, z: inst.z, source: "shot" });
    for (let f = 0; f < 6; f += 1) T.renderOnce(1 / 60);
    const bracedState = T.distaffState();

    // Wait the brace out, then the same damage puts it back down.
    let waited = 0;
    while (T.distaffState().braced && waited < 60 * 15) { T.renderOnce(1 / 60); waited += 1; }
    T.combat.damageLeg(inst, 4, C.footingPool * 2, {
      x: inst.x, y: inst.y, z: inst.z, source: "shot" });
    for (let f = 0; f < 30; f += 1) T.renderOnce(1 / 60);
    const stateCollapsed2 = T.distaffState();

    return {
      standingPhase: stateStanding.phase,
      standingFooting: stateStanding.footingHp,
      standingFootingMax: stateStanding.footingMax,
      drained,
      bracedPhase: bracedState.phase,
      bracedFooting: bracedState.footingHp,
      guard: C.recollapseGuard,
      braceSeconds: Number((waited / 60).toFixed(2)),
      collapsed2Phase: stateCollapsed2.phase,
      collapsed2Collapsed: stateCollapsed2.collapsed,
    };
  });

  check("Distaff recovers with a full stance and cannot be knocked straight back down",
    recoveryReKnockdown.standingPhase === "standing"
      && recoveryReKnockdown.standingFooting === recoveryReKnockdown.standingFootingMax
      && recoveryReKnockdown.bracedPhase === "standing"
      && recoveryReKnockdown.bracedFooting === recoveryReKnockdown.standingFootingMax,
    `braced for ${recoveryReKnockdown.braceSeconds}s of ${recoveryReKnockdown.guard}s; `
      + `stance held at ${recoveryReKnockdown.bracedFooting}`);

  check("...and once the brace is spent, the legs put it back down",
    recoveryReKnockdown.collapsed2Phase === "collapsed"
      && recoveryReKnockdown.collapsed2Collapsed,
    JSON.stringify({ phase: recoveryReKnockdown.collapsed2Phase }));

  await page.screenshot({ path: path.join(outDir, "distaff-combat.png") });

  await browser.close();
  server.kill();

  console.log(`\nResults: ${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error("Probe error:", err);
  server.kill();
  process.exit(1);
}
