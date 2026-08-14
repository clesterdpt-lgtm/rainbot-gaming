#!/usr/bin/env node
/* ============================================================
   SAINTFALL - The Apostate final encounter regression

   Proves the Cathedral finale as a player-facing contract:
     - the corrupted Reliquary figure does not leak before progression;
     - the nave owns an authored reveal and an authoritative damage gate;
     - every mirrored combat verb works, while Call produces a capped brood;
     - flight, Aegis direction, saves, Bloom exclusion, death cleanup and the
       delayed operation handoff all agree with the presentation.

   Usage:
     node scripts/saintfall-apostate-fight.mjs [--out output/path]
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
const outDir = path.resolve(root, args.out || "output/saintfall/apostate-fight");
const port = 53400 + (process.pid % 5000);
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
  const assetFailures = [];
  const sameOrigin = (url) => url.startsWith(base);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && sameOrigin(response.url())) {
      assetFailures.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (sameOrigin(request.url())) assetFailures.push(`failed ${request.url()}`);
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
  });

  /* ---- MODEL AND DORMANT CONTRACT ---------------------------------- */
  const rig = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(true);
    const inst = T.apostate.instance();
    /* The Cathedral garrison is not the subject of this regression. Remove
       only nearby ordinary insects so a stray Harrow cannot turn a mirrored
       ability check into a survival check. */
    for (const enemy of [...T.enemies.live]) {
      if (enemy === inst || Math.hypot(enemy.x - inst.x, enemy.z - inst.z) > 105) continue;
      T.enemies.remove(enemy);
    }
    const tags = [];
    const materialNames = new Set();
    inst.root.traverse((node) => {
      if (node.userData?.apostateFeature) tags.push(node.userData.apostateFeature);
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material?.name) materialNames.add(material.name);
      }
    });
    const status = T.apostateState();
    return {
      count: T.enemies.live.filter((enemy) => enemy.key === "apostate").length,
      id: inst.id,
      rootName: inst.root.name,
      phase: status.phase,
      hidden: status.hidden,
      locked: status.locked,
      model: status.model,
      playerAsset: T.figure.assetSource,
      abilities: status.abilities,
      tags,
      materialNames: [...materialNames],
      hasReliquaryWeapon: T.apostate.weapon?.root?.name === "apostate-censer-lance",
    };
  });
  check("spawns exactly one Cathedral final boss",
    rig.count === 1 && rig.id === "sf-enemy-apostate" && rig.rootName === "the-apostate",
    JSON.stringify({ count: rig.count, id: rig.id, root: rig.rootName }));
  check("uses the same Reliquary figure asset as the player",
    !!rig.model.asset && rig.model.asset === rig.playerAsset,
    `${rig.model.asset} / ${rig.playerAsset}`);
  check("reports the complete mirrored combat kit with Call replaced by Summon",
    JSON.stringify(rig.abilities) === JSON.stringify(
      ["lance", "melee", "boost", "jet", "slam", "aegis", "summon"]),
    JSON.stringify(rig.abilities));
  check("the player silhouette is explicitly corrupted with insect anatomy",
    rig.model.corrupted === true && rig.model.featureCount >= 9
      && rig.tags.length >= 9 && rig.hasReliquaryWeapon,
    `${rig.model.featureCount} declared / ${rig.tags.length} tagged features`);
  check("chitin, flesh and bioluminescent insect materials are present",
    ["sf-apostate-chitin", "sf-apostate-flesh", "sf-apostate-bio"]
      .every((name) => rig.materialNames.includes(name)),
    rig.materialNames.filter((name) => name.startsWith("sf-apostate")).join(", "));
  check("begins dormant, hidden and locked", rig.phase === "dormant" && rig.hidden && rig.locked);

  const dormant = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToApostate(18);
    T.advanceTime(0.8, 1 / 60);
    const inst = T.apostate.instance();
    const before = inst.health;
    const dealt = T.combat.damageEnemy(inst, 100, {
      source: "qa-dormant", x: inst.x, y: inst.y + 1, z: inst.z,
      originX: T.player.state.x, originZ: T.player.state.z,
    });
    T.renderOnce(1 / 60);
    const contacts = T.minimapState()?.contacts || [];
    return {
      mission: T.mission.state.phase,
      state: T.apostateState(),
      rootVisible: inst.root.visible,
      targetable: T.combat.targetable(inst),
      dealt,
      healthBefore: before,
      healthAfter: inst.health,
      minimapVisible: contacts.some((contact) => contact.species === "apostate"),
    };
  });
  check("proximity cannot wake it before the final mission phase",
    dormant.mission !== "cathedralBoss" && dormant.state.phase === "dormant",
    JSON.stringify({ mission: dormant.mission, phase: dormant.state.phase }));
  check("the dormant boss leaks through neither world nor minimap",
    !dormant.rootVisible && !dormant.minimapVisible,
    JSON.stringify({ world: dormant.rootVisible, minimap: dormant.minimapVisible }));
  check("every dormant damage path remains locked",
    !dormant.targetable && dormant.dealt === 0
      && dormant.healthBefore === dormant.healthAfter,
    JSON.stringify(dormant));

  const dormantAutoStow = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    T.autoStow(false);
    T.forceStow(0);
    T.autoStow(true);
    T.advanceTime(7.2, 1 / 60);
    const nearHiddenBoss = T.stowState();
    const distance = Math.hypot(T.player.state.x - inst.x, T.player.state.z - inst.z);
    const encounter = T.apostateState();
    /* Return the focused fight harness to its pinned drawn carry. */
    T.autoStow(false);
    T.forceStow(0);
    return { nearHiddenBoss, distance, encounter, restored: T.stowState() };
  });
  check("a dormant locked Apostate cannot auto-draw the player's lance",
    dormantAutoStow.distance < 42
      && dormantAutoStow.encounter.phase === "dormant"
      && dormantAutoStow.encounter.hidden && dormantAutoStow.encounter.locked
      && dormantAutoStow.nearHiddenBoss.stowed
      && dormantAutoStow.nearHiddenBoss.phase > 0.99
      && dormantAutoStow.restored.phase === 0,
    JSON.stringify(dormantAutoStow));

  /* ---- CATHEDRAL GATE AND REVEAL ----------------------------------- */
  const outsideNave = await page.evaluate(() => {
    const T = window.__SF;
    const armed = T.armApostateFight();
    const inst = T.apostate.instance();
    const C = T.apostate.config;
    /* Still within the circular reveal radius, but across the nave wall.
       This distinguishes the Cathedral trigger from a generic distance orb. */
    T._teleportRaw(inst.x + C.naveHalfWidth + 3, inst.z, 0);
    T.advanceTime(1.2, 1 / 60);
    return {
      armedPhase: armed.mission.phase,
      phase: T.apostateState().phase,
      distance: Math.hypot(T.player.state.x - inst.x, T.player.state.z - inst.z),
      revealRadius: C.revealRadius,
      lateral: Math.abs(T.player.state.x - C.arenaX),
      naveHalfWidth: C.naveHalfWidth,
    };
  });
  check("all relays arm the Cathedral boss phase", outsideNave.armedPhase === "cathedralBoss",
    `phase=${outsideNave.armedPhase}`);
  check("distance alone cannot reveal it through a Cathedral aisle wall",
    outsideNave.distance < outsideNave.revealRadius
      && outsideNave.lateral > outsideNave.naveHalfWidth
      && outsideNave.phase === "dormant",
    JSON.stringify(outsideNave));

  const deadEntry = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    const C = T.apostate.config;
    T.combat.player.dead = true;
    T.combat.player.hp = 0;
    T.combat.player.respawnIn = 10;
    T.teleportToApostate(18);
    T.advanceTime(0.5, 1 / 60);
    const whileDead = T.apostateState();
    const life = { dead: T.combat.player.dead, hp: T.combat.player.hp };
    T.combat.player.respawnIn = 0;
    T.invulnerable(true);
    T._teleportRaw(inst.x + C.naveHalfWidth + 3, inst.z, 0);
    return { whileDead, life, revivedPhase: T.apostateState().phase };
  });
  check("a dead player crossing the Cathedral nave cannot consume the reveal",
    deadEntry.life.dead && deadEntry.life.hp === 0
      && deadEntry.whileDead.phase === "dormant"
      && deadEntry.revivedPhase === "dormant",
    JSON.stringify(deadEntry));

  const revealStart = await page.evaluate(() => {
    const T = window.__SF;
    const programsBefore = T.render.renderer.info.programs?.length || 0;
    const transitionStarted = performance.now();
    T.teleportToApostate(18);
    const transitionMs = performance.now() - transitionStarted;
    const programsAfter = T.render.renderer.info.programs?.length || 0;
    const secs = T.advanceToApostatePhase("reveal", 2);
    const inst = T.apostate.instance();
    const before = inst.health;
    const dealt = T.combat.damageEnemy(inst, 100, {
      source: "qa-reveal", x: inst.x, y: inst.y + 1, z: inst.z,
      originX: T.player.state.x, originZ: T.player.state.z,
    });
    T.renderStill();
    return {
      secs,
      state: T.apostateState(),
      visible: inst.root.visible,
      targetable: T.combat.targetable(inst),
      dealt,
      healthBefore: before,
      healthAfter: inst.health,
      free: T.player.state.free,
      revealBudget: T.apostate.config.revealSeconds,
      transitionMs: Number(transitionMs.toFixed(2)),
      programsBefore,
      programsAfter,
    };
  });
  await page.screenshot({ path: path.join(outDir, "apostate-reveal.png") });
  check("entering the nave begins the authored reveal", revealStart.secs >= 0
    && revealStart.state.phase === "reveal" && revealStart.visible,
  `${revealStart.secs}s to reveal`);
  check("the reveal shows the boss but keeps every damage route locked",
    revealStart.state.locked && !revealStart.targetable && revealStart.dealt === 0
      && revealStart.healthBefore === revealStart.healthAfter,
    JSON.stringify(revealStart));

  const revealDeathRearm = await page.evaluate(() => {
    const T = window.__SF;
    T.advanceTime(0.6, 1 / 60);
    T.combat.player.dead = true;
    T.combat.player.hp = 0;
    T.combat.player.respawnIn = 10;
    T.renderOnce(1 / 60);
    const aborted = {
      state: T.apostateState(),
      free: T.player.state.free,
      visible: T.apostate.instance().root.visible,
    };
    T.combat.player.respawnIn = 0;
    T.invulnerable(true);
    T.teleportToApostate(18);
    const restartedIn = T.advanceToApostatePhase("reveal", 1);
    return {
      aborted,
      restartedIn,
      restarted: T.apostateState(),
      free: T.player.state.free,
    };
  });
  check("dying mid-reveal hides and re-arms the Cathedral encounter",
    revealDeathRearm.aborted.state.phase === "dormant"
      && revealDeathRearm.aborted.state.hidden
      && revealDeathRearm.aborted.state.locked
      && !revealDeathRearm.aborted.free
      && !revealDeathRearm.aborted.visible
      && revealDeathRearm.restartedIn >= 0
      && revealDeathRearm.restarted.phase === "reveal"
      && !revealDeathRearm.restarted.hidden
      && revealDeathRearm.restarted.locked
      && revealDeathRearm.free,
    JSON.stringify(revealDeathRearm));

  const revealEnd = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    let elapsed = 0;
    let cameraSeconds = 0;
    let held = true;
    const frameMs = [];
    while (T.apostateState().phase === "reveal" && elapsed < 10) {
      if (T.player.state.free) cameraSeconds += 1 / 60;
      else held = false;
      const t0 = performance.now();
      T.renderOnce(1 / 60);
      frameMs.push(performance.now() - t0);
      elapsed += 1 / 60;
    }
    const state = T.apostateState();
    /* Keep the duel still while a readable, deterministic review camera is
       composed for the second artifact. */
    Object.assign(T.apostate.state, {
      summonTimer: 120, shotTimer: 120, meleeTimer: 120,
      boostTimer: 120, shieldTimer: 120, jetTimer: 120,
    });
    T.lookAt([inst.x + 7.8, inst.y + 3.7, inst.z + 9.4],
      [inst.x, inst.y + 1.2, inst.z], 43);
    T.renderStill();
    return {
      elapsed: Number(elapsed.toFixed(2)),
      cameraSeconds: Number(cameraSeconds.toFixed(2)),
      held,
      state,
      freeForReview: T.player.state.free,
      targetable: T.combat.targetable(inst),
      visible: inst.root.visible,
      frameMedian: Number(frameMs.slice().sort((a, b) => a - b)
        [Math.floor(frameMs.length / 2)].toFixed(2)),
      frameMax: Number(Math.max(...frameMs).toFixed(2)),
      programsAfterHandoff: T.render.renderer.info.programs?.length || 0,
    };
  });
  await page.screenshot({ path: path.join(outDir, "apostate-duel.png") });
  await page.evaluate(() => window.__SF.releaseCamera());
  check("the reveal holds a free camera for its full four-plus-second beat",
    revealStart.revealBudget >= 4 && revealEnd.held && revealEnd.cameraSeconds > 0,
    `${revealStart.revealBudget}s authored; camera held through the remaining `
      + `${revealEnd.cameraSeconds}s after capture`);
  check("the cinematic hands back a visible, targetable duel",
    revealEnd.state.phase === "duel" && revealEnd.targetable && revealEnd.visible,
    JSON.stringify(revealEnd));
  check("revealing the corrupted figure and its child lights has no visible compile hitch",
    revealStart.transitionMs < 60 && revealEnd.frameMax < 60,
    `${revealStart.transitionMs}ms transition, ${revealEnd.frameMedian}ms median, `
      + `${revealEnd.frameMax}ms max, programs ${revealStart.programsBefore}`
      + `->${revealEnd.programsAfterHandoff}`);

  const bloomGate = await page.evaluate(() => {
    const T = window.__SF;
    T.renderOnce(1 / 60);
    return T.breachState();
  });
  check("Bloom waves recognise the undefeated Cathedral boss boundary",
    bloomGate?.blockedByBoss === "apostate", JSON.stringify(bloomGate));

  /* ---- MIRRORED ABILITIES ------------------------------------------ */
  const ranged = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    Object.assign(T.apostate.state, {
      summonTimer: 120, shotTimer: 120, meleeTimer: 120,
      boostTimer: 120, shieldTimer: 120, jetTimer: 120,
      heat: 0, overheated: false,
    });
    T._teleportRaw(inst.x, inst.z + 18, Math.PI);
    inst.yaw = 0;
    let telegraphs = 0;
    const shots = [];
    const offTelegraph = T.apostate.bus.on("rangedTelegraph", () => { telegraphs += 1; });
    const offShot = T.apostate.bus.on("shot", (event) => shots.push(event));
    const before = T.combat.projectileState();
    const forced = T.forceApostateAction("ranged");
    T.advanceTime(1.25, 1 / 120);
    const after = T.combat.projectileState();
    offTelegraph();
    offShot();
    return {
      forced, telegraphs, shots: shots.length,
      projectileDelta: after.launched - before.launched,
      ids: shots.map((event) => event.projectileId),
      heat: T.apostateState().heat,
    };
  });
  check("mirrors the Censer-Lance as a six-shot projectile burst",
    ranged.forced && ranged.telegraphs === 1 && ranged.shots === 6
      && ranged.projectileDelta === 6 && ranged.ids.every(Boolean),
    JSON.stringify(ranged));
  check("the mirrored lance builds heat", ranged.heat > 0, `heat=${ranged.heat}`);
  await page.waitForTimeout(50);
  const rangedShaderErrors = consoleErrors.filter((message) =>
    /shader|glsl|webglprogram|program not valid|validate_status/i.test(message));
  check("forcing Bloom-coloured lance fire produces no GLSL errors",
    rangedShaderErrors.length === 0, rangedShaderErrors.slice(0, 5).join(" | "));

  const melee = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    Object.assign(T.apostate.state, {
      summonTimer: 120, shotTimer: 120, meleeTimer: 120,
      boostTimer: 120, shieldTimer: 120, jetTimer: 120,
    });
    T._teleportRaw(inst.x, inst.z + 2.3, Math.PI);
    inst.yaw = 0;
    T.invulnerable(false);
    T.combat.player.hp = T.combat.player.maxHp;
    const events = [];
    const telegraphs = [];
    const offHit = T.apostate.bus.on("melee", (event) => events.push(event));
    const offTell = T.apostate.bus.on("meleeTelegraph", (event) => telegraphs.push(event.step));
    const hpBefore = T.combat.player.hp;
    const forced = T.forceApostateAction("melee1");
    T.advanceTime(2.65, 1 / 120);
    const hpAfter = T.combat.player.hp;
    offHit();
    offTell();
    T.invulnerable(true);
    return {
      forced,
      steps: events.map((event) => event.step),
      telegraphs,
      hitSteps: events.filter((event) => event.hit).map((event) => event.step),
      reportedDamage: events.reduce((sum, event) => sum + event.damage, 0),
      hpLost: hpBefore - hpAfter,
    };
  });
  check("mirrors the complete three-step lance melee combo",
    melee.forced && JSON.stringify(melee.steps) === "[1,2,3]"
      && JSON.stringify(melee.telegraphs) === "[1,2,3]",
    JSON.stringify(melee));
  check("the mirrored melee can damage a player in its committed arc",
    melee.hitSteps.length > 0 && melee.reportedDamage > 0 && melee.hpLost > 0,
    JSON.stringify(melee));

  const boost = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    Object.assign(T.apostate.state, {
      summonTimer: 120, shotTimer: 120, meleeTimer: 120,
      boostTimer: 120, shieldTimer: 120, jetTimer: 120,
    });
    T._teleportRaw(inst.x, inst.z + 6.2, Math.PI);
    inst.yaw = 0;
    T.invulnerable(false);
    T.combat.player.hp = T.combat.player.maxHp;
    let started = 0;
    let hit = null;
    const offStart = T.apostate.bus.on("boost", () => { started += 1; });
    const offHit = T.apostate.bus.on("boostHit", (event) => { hit = event; });
    const start = { x: inst.x, z: inst.z };
    const hpBefore = T.combat.player.hp;
    const forced = T.forceApostateAction("boost");
    T.advanceTime(0.72, 1 / 120);
    const hpLost = hpBefore - T.combat.player.hp;
    const travelled = Math.hypot(inst.x - start.x, inst.z - start.z);
    offStart();
    offHit();
    T.invulnerable(true);
    return { forced, started, hit, travelled: Number(travelled.toFixed(2)), hpLost };
  });
  check("mirrors the committed reliquary boost and contact hit",
    boost.forced && boost.started === 1 && boost.travelled > 2
      && boost.hit?.damage > 0 && boost.hpLost > 0,
    JSON.stringify(boost));

  const jetRise = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    Object.assign(T.apostate.state, {
      summonTimer: 120, shotTimer: 120, meleeTimer: 120,
      boostTimer: 120, shieldTimer: 120, jetTimer: 120,
      heat: 0, overheated: false,
    });
    T._teleportRaw(inst.x, inst.z + 4, Math.PI);
    inst.yaw = 0;
    let jets = 0;
    let slams = 0;
    const offJet = T.apostate.bus.on("jet", () => { jets += 1; });
    const offSlam = T.apostate.bus.on("slam", () => { slams += 1; });
    const forced = T.forceApostateAction("jet");
    T.advanceTime(0.84, 1 / 120);
    const high = T.apostateState();
    const healthBefore = inst.health;
    /* Exercise the real ground-melee and slam paths. Direct damageEnemy is
       intentionally not used: it represents an arbitrary damage source and
       therefore has no reason to know whether it began on the ground. */
    T.pressMelee();
    T.advanceTime(0.62, 1 / 120);
    const afterMelee = inst.health;
    const shock = T.combat.shockwave(inst.x, T.collide.groundHeight(inst.x, inst.z), inst.z, {
      radius: 6, innerRadius: 2, damage: 120, source: "slam",
    });
    const afterShock = inst.health;
    T.lookAt([inst.x + 4.8, inst.y + 2.2, inst.z + 4.8],
      [inst.x, inst.y + 1.0, inst.z], 48);
    T.renderStill();
    offJet();
    offSlam();
    return {
      forced, jets, slams, high,
      healthBefore, afterMelee, afterShock, shock,
    };
  });
  await page.screenshot({ path: path.join(outDir, "apostate-jet.png") });
  const jetEnd = await page.evaluate(() => {
    const T = window.__SF;
    T.releaseCamera();
    /* Finish the same flight after its inspection frame. */
    let slams = 0;
    const off = T.apostate.bus.on("slam", () => { slams += 1; });
    T.advanceTime(2.0, 1 / 120);
    off();
    return { state: T.apostateState(), slams };
  });
  check("mirrors the jet rise and reaches a clearly airborne altitude",
    jetRise.forced && jetRise.jets === 1 && jetRise.high.airborne && jetRise.high.altitude > 6,
    JSON.stringify(jetRise.high));
  check("ground melee and a ground slam cannot damage the airborne mirror",
    jetRise.afterMelee === jetRise.healthBefore
      && jetRise.afterShock === jetRise.healthBefore && jetRise.shock.hits === 0,
    JSON.stringify({ before: jetRise.healthBefore, melee: jetRise.afterMelee,
      shock: jetRise.afterShock, shockResult: jetRise.shock }));
  check("the mirrored jet resolves into one landing slam",
    jetEnd.slams === 1 && !jetEnd.state.airborne && jetEnd.state.altitude === 0,
    JSON.stringify(jetEnd));

  const coronaLanding = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    const C = T.apostate.config;
    /* The fallen corona is centred at cathedral (-10, -51) relative to the
       district centre. Sample its eastern hoop rather than its hollow hub. */
    const wreckX = C.arenaX - 5.8;
    const wreckZ = C.arenaZ - 28;
    inst.x = wreckX;
    inst.z = wreckZ;
    const ground = T.collide.groundHeight(wreckX, wreckZ);
    const supportSweep = T.collide.sweepFlightCapsule(
      wreckX, ground + C.jetAltitude, wreckZ,
      wreckX, ground, wreckZ, inst.spec.collisionRadius, 2.12, 0.14, false
    );
    const supportAltitude = supportSweep.y - ground;
    T.forceApostateAction("jet");
    const plungeStart = C.jetRiseSeconds + C.jetHoverSeconds;
    const total = plungeStart + C.jetPlungeSeconds + C.jetRecoverSeconds;
    T.apostate.state.actionElapsed = plungeStart;
    T.apostate.state.actionFor = total - plungeStart;
    T.apostate.state.altitude = C.jetAltitude;
    T.apostate.state.jetImpacted = false;
    inst.grounded = false;
    inst.y = ground + C.jetAltitude;
    inst.root.position.set(inst.x, inst.y, inst.z);
    let impact = null;
    let impactY = null;
    const off = T.apostate.bus.on("slam", () => {
      impact = T.apostateState();
      impactY = ground + impact.altitude;
    });
    for (let i = 0; i < 90 && !impact; i += 1) T.renderOnce(1 / 120);
    const atImpact = impact || T.apostateState();
    T.advanceTime(0.75, 1 / 120);
    const after = T.apostateState();
    const afterY = inst.y;
    off();
    /* Return the actor to its authored duel pocket for later checks. */
    inst.x = C.arenaX;
    inst.z = C.arenaZ;
    T.apostate.state.altitude = 0;
    inst.grounded = true;
    T.renderStill();
    return {
      supportAltitude: Number(supportAltitude.toFixed(3)),
      supportBlocked: supportSweep.hitY,
      atImpact,
      impactY: Number((impactY ?? afterY).toFixed(3)),
      after,
      afterY: Number(afterY.toFixed(3)),
      snapped: Number(((impactY ?? afterY) - afterY).toFixed(3)),
    };
  });
  check("jet plunge honours the fallen-corona collision support",
    coronaLanding.supportBlocked && coronaLanding.supportAltitude > 0.12
      && Math.abs(coronaLanding.atImpact.altitude - coronaLanding.supportAltitude) < 0.35
      && coronaLanding.after.altitude > 0.12 && coronaLanding.snapped < 0.35,
    JSON.stringify(coronaLanding));

  const shield = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    inst.yaw = 0;
    let blocks = 0;
    const off = T.apostate.bus.on("shieldBlock", () => { blocks += 1; });
    const forced = T.forceApostateAction("shield");
    const before = inst.health;
    const front = T.combat.damageEnemy(inst, 100, {
      source: "qa-aegis-front",
      x: inst.x, y: inst.y + 1, z: inst.z,
      originX: inst.x, originZ: inst.z + 8,
    });
    const afterFront = inst.health;
    const back = T.combat.damageEnemy(inst, 100, {
      source: "qa-aegis-back",
      x: inst.x, y: inst.y + 1, z: inst.z,
      originX: inst.x, originZ: inst.z - 8,
    });
    const afterBack = inst.health;
    off();
    return {
      forced, active: T.apostateState().shieldActive, blocks,
      before, front, back, afterFront, afterBack,
    };
  });
  check("the mirrored Aegis blocks attacks from its presented front",
    shield.forced && shield.active && shield.front === 0
      && shield.afterFront === shield.before && shield.blocks >= 1,
    JSON.stringify(shield));
  check("the mirrored Aegis leaves its back damageable",
    shield.back > 0 && shield.afterBack < shield.afterFront,
    JSON.stringify(shield));

  const boostVsShield = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    const strike = (side) => {
      T.resetBoost(true);
      const front = side === "front";
      const camYaw = front ? Math.PI : 0;
      T._teleportRaw(inst.x, inst.z + (front ? 5.2 : -5.2), camYaw);
      T.player.state.camYaw = camYaw;
      T.setBodyHeading(camYaw);
      inst.yaw = 0;
      T.forceApostateAction("shield");
      const healthBefore = inst.health;
      const blocksBefore = T.apostateState().shieldBlocks;
      const trigger = T.triggerBoost(0, -1);
      const fromX = inst.x;
      const fromZ = inst.z + (front ? 5.2 : -5.2);
      const toZ = inst.z + (front ? 1.25 : -1.25);
      const contactHits = T.boost.noteMotion(fromX, fromZ, fromX, toZ, 0.1);
      return {
        triggered: trigger.triggered,
        dealt: healthBefore - inst.health,
        blocks: T.apostateState().shieldBlocks - blocksBefore,
        contactHits,
        boost: T.boostState(),
      };
    };
    const front = strike("front");
    const back = strike("back");
    T.resetBoost(true);
    return { front, back };
  });
  check("player boost carries its contact origin through the Aegis front/back rule",
    boostVsShield.front.triggered && boostVsShield.front.dealt === 0
      && boostVsShield.front.blocks >= 1 && boostVsShield.back.triggered
      && boostVsShield.back.dealt > 0 && boostVsShield.back.blocks === 0,
    JSON.stringify(boostVsShield));

  const vent = await page.evaluate(() => {
    const T = window.__SF;
    T.apostate.state.heat = 1;
    T.apostate.state.overheated = true;
    let vents = 0;
    let vented = 0;
    const offStart = T.apostate.bus.on("vent", () => { vents += 1; });
    const offEnd = T.apostate.bus.on("vented", () => { vented += 1; });
    const forced = T.forceApostateAction("vent");
    const during = T.apostateState();
    T.advanceTime(T.apostate.config.ventSeconds + 0.12, 1 / 120);
    const after = T.apostateState();
    offStart();
    offEnd();
    return { forced, vents, vented, during, after };
  });
  check("overheating forces the mirrored vulnerable vent cycle",
    vent.forced && vent.vents === 1 && vent.during.action === "vent"
      && vent.vented === 1 && !vent.after.overheated && vent.after.heat <= 0.25,
    JSON.stringify(vent));

  /* ---- CALL REPLACEMENT, OWNERSHIP AND SAVE ------------------------ */
  const summons = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    Object.assign(T.apostate.state, {
      summonTimer: 120, shotTimer: 120, meleeTimer: 120,
      boostTimer: 120, shieldTimer: 120, jetTimer: 120,
    });
    T._teleportRaw(inst.x, inst.z + 18, Math.PI);
    let calls = 0;
    const summonedEvents = [];
    const offCall = T.apostate.bus.on("call", () => { calls += 1; });
    const offSummon = T.apostate.bus.on("summoned", (event) => summonedEvents.push(event));
    const forced = T.forceApostateAction("summon");
    T.advanceTime(T.apostate.config.summonWindup + 1.0, 1 / 120);
    const afterCall = inst.broodKids.filter((kid) => kid.state !== "death" && kid.health > 0);
    const animatedEventCount = summonedEvents.length;
    const second = T.forceApostateSummon();
    const third = T.forceApostateSummon();
    const kids = inst.broodKids.filter((kid) => kid.state !== "death" && kid.health > 0);
    offCall();
    offSummon();
    return {
      forced, calls, summonedEvents,
      animatedEventCount,
      firstCount: afterCall.length, second, third,
      count: kids.length,
      cap: T.apostate.config.summonCap,
      summonCount: T.apostate.config.summonCount,
      ids: kids.map((kid) => kid.id),
      keys: kids.map((kid) => kid.key),
      owned: kids.every((kid) => kid.eventId === inst.id),
      inArena: kids.every((kid) => Math.hypot(
        kid.x - T.apostate.config.arenaX, kid.z - T.apostate.config.arenaZ
      ) <= T.apostate.config.arenaRadius),
    };
  });
  check("Call is replaced by an authored insect-summon windup",
    summons.forced && summons.calls === 1 && summons.animatedEventCount === 1
      && summons.firstCount === summons.summonCount,
    JSON.stringify(summons));
  check("summoned enemies are ordinary insect castes owned by the boss",
    summons.owned && summons.inArena
      && summons.keys.every((key) => ["thresher", "gleaner", "harrow"].includes(key)),
    JSON.stringify({ keys: summons.keys, owned: summons.owned, inArena: summons.inArena }));
  check("repeated calls respect the eight-insect brood cap",
    summons.count === summons.cap
      && summons.second === Math.min(summons.summonCount, summons.cap - summons.firstCount)
      && summons.third === 0
      && new Set(summons.ids).size === summons.ids.length,
    JSON.stringify(summons));

  const saveRestore = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    T.invulnerable(true);
    Object.assign(T.apostate.state, {
      summonTimer: 120, shotTimer: 120, meleeTimer: 120,
      boostTimer: 120, shieldTimer: 120, jetTimer: 120,
      heat: 0, overheated: false,
    });
    T._teleportRaw(inst.x, inst.z + 14, Math.PI);
    T.forceApostateAction("jet");
    /* Past impact (2.71s), still inside the 3.23s action recovery. */
    T.advanceTime(2.84, 1 / 120);
    const before = T.apostate.snapshot();
    const saved = T.saves.capture();
    const savedIds = before.summonIds.slice().sort();
    /* Advance away from the saved point so successful restore is observable. */
    T.advanceTime(0.7, 1 / 120);
    let replayedSlams = 0;
    const off = T.apostate.bus.on("slam", () => { replayedSlams += 1; });
    Object.assign(inst, {
      speed: 9,
      stride: 7,
      stunTime: 3,
      knockbackX: 4,
      knockbackZ: -5,
      knockbackTime: 2,
      bodyDrop: 0.8,
    });
    const accepted = !!saved && T.saves.apply(saved);
    T.invulnerable(true);
    const restored = T.apostate.snapshot();
    const restoredInst = T.apostate.instance();
    const restoredTransient = {
      speed: restoredInst.speed,
      stride: restoredInst.stride,
      stunTime: restoredInst.stunTime,
      knockbackX: restoredInst.knockbackX,
      knockbackZ: restoredInst.knockbackZ,
      knockbackTime: restoredInst.knockbackTime,
      bodyDrop: restoredInst.bodyDrop,
    };
    const bossCount = T.enemies.live.filter((enemy) => enemy.key === "apostate").length;
    const restoredKids = T.apostate.instance().broodKids
      .filter((kid) => kid.state !== "death" && kid.health > 0);
    T.advanceTime(0.7, 1 / 120);
    off();
    return {
      captured: !!saved,
      accepted,
      savedAction: before.action,
      savedTimer: before.timer,
      savedImpacted: before.jetImpacted,
      restoredAction: restored.action,
      restoredImpacted: restored.jetImpacted,
      savedIds,
      restoredIds: restoredKids.map((kid) => kid.id).sort(),
      ownedAfter: restoredKids.every((kid) => kid.eventId === inst.id),
      bossCount,
      replayedSlams,
      mission: T.mission.state.phase,
      restoredTransient,
    };
  });
  check("a post-impact jet recovery is field-saveable and restores in place",
    saveRestore.captured && saveRestore.accepted
      && saveRestore.savedAction === "jet" && saveRestore.savedImpacted
      && saveRestore.restoredAction === "jet" && saveRestore.restoredImpacted,
    JSON.stringify(saveRestore));
  check("restore keeps one boss and rebinds its owned brood by stable ID",
    saveRestore.bossCount === 1 && saveRestore.ownedAfter
      && JSON.stringify(saveRestore.restoredIds) === JSON.stringify(saveRestore.savedIds),
    JSON.stringify(saveRestore));
  check("restoring after jet impact never replays the landing slam",
    saveRestore.replayedSlams === 0 && saveRestore.mission === "cathedralBoss",
    JSON.stringify(saveRestore));
  check("same-session restore clears stale boss motion and hit reactions",
    Object.values(saveRestore.restoredTransient).every((value) => value === 0),
    JSON.stringify(saveRestore.restoredTransient));

  const zeroHealthRestore = await page.evaluate(() => {
    const T = window.__SF;
    const baseline = T.saves.capture();
    const synthetic = structuredClone(baseline);
    const summonIds = synthetic.apostate.summonIds.slice();
    synthetic.apostate.health = 0;
    synthetic.apostate.phase = "duel";
    synthetic.apostate.defeated = false;
    synthetic.apostate.victoryReported = false;
    const accepted = T.saves.apply(synthetic);
    const immediate = T.apostateState();
    const inst = T.apostate.instance();
    const ownedBossKids = inst.broodKids.length;
    const ownedRoster = T.enemies.live.filter((enemy) =>
      enemy.eventId === inst.id && enemy.state !== "death" && enemy.health > 0).length;
    const baselineRestored = T.saves.apply(baseline);
    T.invulnerable(true);
    T.teleportToApostate(14);
    return {
      accepted,
      summonIds,
      immediate,
      ownedBossKids,
      ownedRoster,
      baselineRestored,
    };
  });
  check("a zero-health duel save canonicalizes death and brood cleanup synchronously",
    zeroHealthRestore.accepted && zeroHealthRestore.summonIds.length > 0
      && zeroHealthRestore.immediate.phase === "dead"
      && zeroHealthRestore.immediate.defeated
      && zeroHealthRestore.ownedBossKids === 0
      && zeroHealthRestore.ownedRoster === 0
      && zeroHealthRestore.baselineRestored,
    JSON.stringify(zeroHealthRestore));

  const longDisengageSave = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    T.invulnerable(true);
    const baseline = T.saves.capture();

    T._teleportRaw(inst.x, inst.z + 14, Math.PI);
    T.forceApostateAction("jet");
    T.advanceTime(0.84, 1 / 120);
    const leashBefore = T.apostateState();
    T._teleportRaw(inst.x + T.apostate.config.disengageRadius + 45, inst.z, 0);
    T.renderOnce(1 / 120);
    const leashAfter = T.apostateState();
    const leashGrounded = inst.grounded;
    T.advanceTime(0.25, 1 / 120);
    const leashSwept = T.apostateState();
    inst.speed = 7;
    inst.stride = 3;
    inst.stunTime = 2;
    inst.knockbackX = 4;
    inst.knockbackZ = -3;
    inst.knockbackTime = 1;
    inst.bodyDrop = 0.5;
    const reset = T.apostate.reset();
    const resetInst = T.apostate.instance();
    const resetTransient = {
      speed: resetInst.speed,
      stride: resetInst.stride,
      stunTime: resetInst.stunTime,
      knockbackX: resetInst.knockbackX,
      knockbackZ: resetInst.knockbackZ,
      knockbackTime: resetInst.knockbackTime,
      bodyDrop: resetInst.bodyDrop,
      actionSerial: T.apostate.state.actionSerial,
      disengageFor: T.apostate.state.disengageFor,
      releaseCameraCleared: T.apostate.state.releaseCameraAt === undefined,
    };
    const preLongRestored = !!baseline && T.saves.apply(baseline);
    T.invulnerable(true);
    const duelInst = T.apostate.instance();
    const owned = new Set(duelInst.broodKids || []);
    for (const enemy of [...T.enemies.live]) {
      if (enemy === duelInst || owned.has(enemy) || enemy.eventId === duelInst.id) continue;
      T.enemies.remove(enemy);
    }
    T._teleportRaw(duelInst.x + T.apostate.config.disengageRadius + 45, duelInst.z, 0);
    T.advanceTime(611, 0.1);
    const before = T.apostate.snapshot();
    const captured = T.saves.capture();
    const accepted = !!captured && T.saves.apply(captured);
    T.invulnerable(true);
    const after = T.apostate.snapshot();
    const baselineRestored = !!baseline && T.saves.apply(baseline);
    T.invulnerable(true);
    T.teleportToApostate(14);
    return {
      captured: !!captured,
      accepted,
      preLongRestored,
      baselineRestored,
      leashBefore,
      leashAfter,
      leashGrounded,
      leashSwept,
      reset,
      resetTransient,
      beforeCooldowns: before.cooldowns,
      afterCooldowns: after.cooldowns,
      beforeDisengage: before.disengageFor,
      afterDisengage: after.disengageFor,
      cooldownFloorSafe: Object.values(before.cooldowns)
        .every((value) => value >= -1 && value <= 600),
      disengageSafe: before.disengageFor >= 0
        && before.disengageFor <= T.apostate.config.disengageSeconds + 1,
      bossCount: T.enemies.live.filter((enemy) => enemy.key === "apostate").length,
      mission: T.mission.state.phase,
    };
  });
  check("a ten-minute disengage remains validator-safe and reloadable",
    longDisengageSave.captured && longDisengageSave.accepted
      && longDisengageSave.preLongRestored && longDisengageSave.baselineRestored
      && longDisengageSave.cooldownFloorSafe && longDisengageSave.disengageSafe
      && longDisengageSave.bossCount === 1
      && longDisengageSave.mission === "cathedralBoss",
    JSON.stringify(longDisengageSave));
  check("crossing the leash cancels a jet and sweeps altitude instead of snapping",
    longDisengageSave.leashBefore.action === "jet"
      && longDisengageSave.leashBefore.altitude > 6
      && longDisengageSave.leashAfter.action === null
      && longDisengageSave.leashAfter.altitude > 0
      && longDisengageSave.leashAfter.altitude < longDisengageSave.leashBefore.altitude
      && !longDisengageSave.leashGrounded
      && longDisengageSave.leashSwept.altitude < longDisengageSave.leashAfter.altitude,
    JSON.stringify({ before: longDisengageSave.leashBefore,
      after: longDisengageSave.leashAfter, swept: longDisengageSave.leashSwept,
      grounded: longDisengageSave.leashGrounded }));
  check("reset clears airborne altitude, grounding and transient boss motion",
    longDisengageSave.reset.phase === "dormant"
      && longDisengageSave.reset.action === null
      && longDisengageSave.reset.altitude === 0
      && !longDisengageSave.reset.airborne
      && Object.entries(longDisengageSave.resetTransient)
        .every(([key, value]) => key === "releaseCameraCleared" ? value === true : value === 0),
    JSON.stringify({ reset: longDisengageSave.reset,
      transient: longDisengageSave.resetTransient }));

  /* ---- LIVE COST ---------------------------------------------------- */
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(true);
    const inst = T.apostate.instance();
    const owned = new Set(inst.broodKids || []);
    for (const enemy of [...T.enemies.live]) {
      if (enemy === inst || owned.has(enemy) || enemy.eventId === inst.id) continue;
      T.enemies.remove(enemy);
    }
    Object.assign(T.apostate.state, {
      summonTimer: 120, shotTimer: 120, meleeTimer: 120,
      boostTimer: 120, shieldTimer: 120, jetTimer: 120,
    });
    /* Settle shader uploads without moving the simulation or making later
       batches pay a growing GPU queue. This matches the established focused
       boss probes: one warmed, isolated render batch. */
    for (let i = 0; i < 30; i += 1) T.renderStill();
    const t0 = performance.now();
    for (let i = 0; i < 150; i += 1) T.renderStill();
    const ms = (performance.now() - t0) / 150;
    return {
      msPerFrame: Number(ms.toFixed(2)),
      draws: T.report().render,
      summons: T.apostateState().summons,
      isolatedLive: T.enemies.live.length,
    };
  });
  check("the live boss and full brood render inside budget", cost.msPerFrame < 9,
    `${cost.msPerFrame}ms/frame, ${cost.draws.calls} draws, `
      + `${cost.draws.triangles} triangles, ${cost.summons} summons`);

  /* ---- AIRBORNE DEATH, CLEANUP AND FINAL HANDOFF ------------------- */
  const deathStart = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    T.invulnerable(true);
    Object.assign(T.apostate.state, {
      summonTimer: 120, shotTimer: 120, meleeTimer: 120,
      boostTimer: 120, shieldTimer: 120, jetTimer: 120,
      heat: 0, overheated: false,
    });
    T._teleportRaw(inst.x, inst.z + 32, Math.PI);
    inst.yaw = 0;
    T.forceApostateAction("jet");
    T.advanceTime(0.92, 1 / 120);
    const airborne = T.apostateState().altitude;
    /* Keep an explicitly owned bolt in flight so death cleanup is tested
       without relying on a 126m/s combat shot still being in the nave. */
    const THREE = Object.getPrototypeOf(inst.root.position).constructor;
    const origin = new THREE(inst.x, inst.y + 1.2, inst.z);
    const target = new THREE(inst.x, inst.y + 1.2, inst.z + 70);
    T.combat.launchEnemyProjectile(inst, {}, {
      origin, target, damage: 1, speed: 2, maxRange: 70,
      directAimChance: 1, horizontalSpread: 0, verticalSpread: 0,
      source: "enemy-fire", idPrefix: "apostate-cleanup-qa",
    });
    const gleanerKid = inst.broodKids.find((kid) => kid.key === "gleaner"
      && kid.state !== "death" && kid.health > 0);
    if (gleanerKid) {
      const kidOrigin = new THREE(gleanerKid.x, gleanerKid.y + 1.2, gleanerKid.z);
      const kidTarget = new THREE(gleanerKid.x, gleanerKid.y + 1.2, gleanerKid.z + 70);
      T.combat.launchEnemyProjectile(gleanerKid, {}, {
        origin: kidOrigin, target: kidTarget, damage: 1, speed: 2, maxRange: 70,
        directAimChance: 1, horizontalSpread: 0, verticalSpread: 0,
        source: "enemy-fire", idPrefix: "apostate-brood-cleanup-qa",
      });
    }
    const beforePruneKids = inst.broodKids.length;
    if (gleanerKid) {
      gleanerKid.health = 0;
      gleanerKid.state = "death";
    }
    const afterPruneState = T.apostateState();
    const prunedFromBrood = !!gleanerKid && !inst.broodKids.includes(gleanerKid);
    const ownedRoster = T.enemies.live.filter((enemy) => enemy.eventId === inst.id);
    const ownerIds = new Set([inst.id, ...ownedRoster.map((kid) => kid.id)]);
    const beforeKids = ownedRoster.length;
    const flightsBefore = T.combat.projectileState().flights;
    const beforeBossProjectiles = flightsBefore.filter((flight) => flight.enemyId === inst.id).length;
    const beforeKidProjectiles = gleanerKid
      ? flightsBefore.filter((flight) => flight.enemyId === gleanerKid.id).length : 0;
    const beforeProjectiles = flightsBefore.filter((flight) => ownerIds.has(flight.enemyId)).length;
    let dismissed = null;
    let defeated = 0;
    let settled = 0;
    const offDismiss = T.apostate.bus.on("broodDismissed", (event) => { dismissed = event; });
    const offDefeat = T.apostate.bus.on("defeated", () => { defeated += 1; });
    const offSettle = T.apostate.bus.on("settled", () => { settled += 1; });
    const dealt = T.combat.damageEnemy(inst, inst.health + 1, {
      source: "qa-apostate-finale",
      x: inst.x, y: inst.y + 1, z: inst.z,
      originX: T.player.state.x, originZ: T.player.state.z,
    });
    T.renderOnce(1 / 60);
    const after = T.apostateState();
    const afterKids = inst.broodKids.length;
    const afterProjectiles = T.combat.projectileState().flights
      .filter((flight) => ownerIds.has(flight.enemyId)).length;
    const missionImmediate = T.mission.state.phase;
    T.advanceTime(1.0, 1 / 60);
    const mid = T.apostateState();
    const missionMid = T.mission.state.phase;
    const deathSave = T.saves.capture();
    window.__apostateDeathSave = deathSave;
    offDismiss();
    offDefeat();
    offSettle();
    return {
      airborne, beforeKids, beforeProjectiles,
      beforeBossProjectiles, beforeKidProjectiles, dealt,
      beforePruneKids, afterPruneState, prunedFromBrood,
      after, afterKids, afterProjectiles, dismissed, defeated,
      settledBeforeDelay: settled,
      missionImmediate, missionMid, mid,
      deathSaveCaptured: !!deathSave,
      deathSaveTimer: deathSave?.apostate?.timer ?? null,
    };
  });
  check("an airborne lethal hit begins a visible fall",
    deathStart.dealt > 0 && deathStart.airborne > 6
      && deathStart.after.defeated && deathStart.mid.altitude < deathStart.airborne,
    JSON.stringify({ airborne: deathStart.airborne, after: deathStart.after, mid: deathStart.mid }));
  check("death immediately dismisses every owned insect and projectile",
    deathStart.beforeKids > 0 && deathStart.prunedFromBrood
      && deathStart.afterPruneState.summons === deathStart.beforePruneKids - 1
      && deathStart.beforeBossProjectiles > 0
      && deathStart.beforeKidProjectiles > 0
      && deathStart.afterKids === 0 && deathStart.afterProjectiles === 0
      && deathStart.dismissed?.removed === deathStart.beforeKids
      && deathStart.dismissed?.projectiles >= deathStart.beforeProjectiles
      && deathStart.dismissed?.projectiles
        >= deathStart.beforeBossProjectiles + deathStart.beforeKidProjectiles,
    JSON.stringify(deathStart));
  check("the operation cannot finish before the boss settles",
    deathStart.defeated === 1 && deathStart.settledBeforeDelay === 0
      && deathStart.missionImmediate === "cathedralBoss"
      && deathStart.missionMid === "cathedralBoss" && deathStart.deathSaveCaptured,
    JSON.stringify({ defeated: deathStart.defeated, settled: deathStart.settledBeforeDelay,
      immediate: deathStart.missionImmediate, mid: deathStart.missionMid }));

  const deathEnd = await page.evaluate(() => {
    const T = window.__SF;
    let settled = 0;
    const off = T.apostate.bus.on("settled", () => { settled += 1; });
    T.advanceTime(1.35, 1 / 60);
    const won = T.mission.state.phase;
    const atWin = T.enemies.live.filter((enemy) => enemy.key === "apostate").length;
    T.advanceTime(27.0, 1 / 30);
    const afterFirstCorpse = T.enemies.live.filter((enemy) => enemy.key === "apostate").length;
    const staleDiedAt = T.apostate.instance().diedAt;
    /* Reload the in-settle snapshot in the same session, after the old corpse
       timestamp has aged past generic cleanup. The durable controller must
       get a fresh lifetime and stay registered until it reports victory. */
    const deathSaveAccepted = !!window.__apostateDeathSave
      && T.saves.apply(window.__apostateDeathSave);
    T.invulnerable(true);
    const restoredImmediate = T.enemies.live
      .filter((enemy) => enemy.key === "apostate").length;
    let registeredThroughWin = restoredImmediate === 1;
    let restoreElapsed = 0;
    while (T.mission.state.phase !== "won" && restoreElapsed < 3) {
      T.renderOnce(1 / 60);
      restoreElapsed += 1 / 60;
      if (T.enemies.live.filter((enemy) => enemy.key === "apostate").length !== 1) {
        registeredThroughWin = false;
      }
    }
    const restoredWin = T.mission.state.phase;
    const restoredAtWin = T.enemies.live
      .filter((enemy) => enemy.key === "apostate").length;
    T.advanceTime(27.0, 1 / 30);
    const afterRestoredCorpse = T.enemies.live
      .filter((enemy) => enemy.key === "apostate").length;
    T.advanceTime(2.0, 1 / 30);
    const afterExtra = T.enemies.live.filter((enemy) => enemy.key === "apostate").length;
    off();
    return {
      settled, won, atWin, afterFirstCorpse,
      staleDiedAt, deathSaveAccepted, restoredImmediate,
      registeredThroughWin, restoreElapsed: Number(restoreElapsed.toFixed(2)),
      restoredWin, restoredAtWin, afterRestoredCorpse, afterExtra,
      state: T.apostateState(),
    };
  });
  check("settlement hands the Cathedral finale to the operation win state",
    deathEnd.settled >= 1 && deathEnd.won === "won" && deathEnd.state.defeated,
    JSON.stringify(deathEnd));
  check("the corpse persists for its read, expires once, and never respawns",
    deathEnd.atWin === 1 && deathEnd.afterFirstCorpse === 0
      && deathEnd.afterRestoredCorpse === 0 && deathEnd.afterExtra === 0,
    JSON.stringify(deathEnd));
  check("reloading an aged in-settle death save keeps the boss registered through victory",
    Number.isFinite(deathEnd.staleDiedAt) && deathEnd.deathSaveAccepted
      && deathEnd.restoredImmediate === 1 && deathEnd.registeredThroughWin
      && deathEnd.restoredWin === "won" && deathEnd.restoredAtWin === 1,
    JSON.stringify(deathEnd));

  const realConsoleErrors = consoleErrors.filter((message) =>
    !/jsdelivr|unpkg|favicon|Failed to load resource/i.test(message));
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  check("no failed game-asset requests", assetFailures.length === 0,
    assetFailures.slice(0, 5).join(" | "));
  check("no console errors", realConsoleErrors.length === 0,
    realConsoleErrors.slice(0, 5).join(" | "));

  await writeFile(path.join(outDir, "report.json"), JSON.stringify({
    results, failed, rig, dormantAutoStow, ranged, melee, boost, jetRise, jetEnd,
    deadEntry, revealDeathRearm, coronaLanding, shield, boostVsShield, vent, summons,
    saveRestore, zeroHealthRestore, longDisengageSave, cost, deathStart, deathEnd,
  }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  console.log(`Report: ${path.join(outDir, "report.json")}`);
  await browser.close();
} finally {
  server.kill();
}

process.exitCode = failed ? 1 : 0;
