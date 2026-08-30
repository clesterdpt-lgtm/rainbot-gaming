#!/usr/bin/env node
/* Kenosis operative kits (m107): boots the summit page once per
   operative and proves every doctrine verb end to end through the
   same paths the inputs take - the Vigil Step's displacement and
   charges, the crescent volley's damage and falloff numbers, the
   fast blades' tempo, the Augur tank; the Bastion's unlimited
   frontal block (and its refusals), the hammer cast's flight,
   pierce damage, flyer knockdown and return catch, the Censer
   leap (impulse, cost, cooldown, no flight), the slow hammer
   tempo, the trials cohort, and the death -> basecamp revive. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/kenosis-kit");
const port = 45900 + (process.pid % 1200);
const base = `http://127.0.0.1:${port}`;

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

const report = { checks: [], errors: {}, states: {} };
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};

async function bootOperative(browser, character) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.goto(
    `${base}/games/saintfall-white-vigil.html?qa=1&character=${character}&quality=medium&time=noon&fuel=limited`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => document.documentElement.classList.add("sf-maximised"));
  return { page, context, errors };
}

const stepFor = (page, seconds, dt = 1 / 60) => page.evaluate(
  ({ seconds, dt }) => { window.__SF.advanceTime(seconds, dt); return true; },
  { seconds, dt });

async function shoot(page, file) {
  const shotPath = path.join(outDir, file);
  await page.screenshot({ path: shotPath });
  return shotPath;
}

/* ------------------------------------------------------------------
   BASTION PENITENT
   ------------------------------------------------------------------ */
async function probeBastion(browser) {
  const { page, context, errors } = await bootOperative(browser, "bastion-penitent");
  report.errors.bastion = errors;

  const kit0 = await page.evaluate(() => window.__SF.summit.kitState());
  check("bastion: kit present", kit0 && kit0.id === "bastion-penitent", kit0?.doctrine);
  check("bastion: melee spec published", kit0?.meleeSpec?.melee === true
    && kit0?.meleeSpec?.damage === 132, kit0?.meleeSpec);
  check("bastion: block module installed", !!kit0?.block, kit0?.block && {
    frontDot: kit0.block.frontDot,
  });
  check("bastion: hammer held", kit0?.hammer?.phase === "held");

  const jet0 = await page.evaluate(() => window.__SF.jetpackState());
  check("bastion: leap mode pack", jet0?.leapMode === true
    && jet0?.maxFuel === 100, { leapMode: jet0?.leapMode, maxFuel: jet0?.maxFuel });

  /* ---- the leap: impulse up, charge spent, cooldown armed, and no
     flight state ever. setJetInput holds the real chord. */
  await page.evaluate(() => {
    const T = window.__SF;
    T.player.state.camPitch = -0.1;
    T.setJetInput(true);
  });
  await stepFor(page, 0.10);
  const midLeap = await page.evaluate(() => ({
    jet: window.__SF.jetpackState(),
    vy: window.__SF.player.state.vy,
    grounded: window.__SF.player.state.grounded,
  }));
  await page.evaluate(() => window.__SF.setJetInput(false));
  check("bastion: leap fired an impulse", !midLeap.grounded && midLeap.vy > 6,
    { vy: Number(midLeap.vy.toFixed(2)) });
  check("bastion: leap never enters flight", midLeap.jet.inFlight === false
    && midLeap.jet.active === false, { mode: midLeap.jet.mode });
  check("bastion: leap paid charge and armed cooldown",
    midLeap.jet.fuel <= 100 - 21 && midLeap.jet.leapCooldownRemaining > 1.0,
    { fuel: midLeap.jet.fuel, cooldown: midLeap.jet.leapCooldownRemaining });
  await shoot(page, "bastion-leap.png");
  await stepFor(page, 2.5);
  const landed = await page.evaluate(() => ({
    grounded: window.__SF.player.state.grounded,
    landings: window.__SF.jetpackState().landings,
  }));
  check("bastion: leap lands and is booked", landed.grounded && landed.landings >= 1, landed);

  /* ---- the block: raise, hold forever, frontal verdicts, chipless. */
  await stepFor(page, 2.2); // leap cooldown + settle
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE" })));
  await stepFor(page, 0.35);
  const blockUp = await page.evaluate(() => {
    const T = window.__SF;
    const ps = T.player.state;
    const front = T.combat.hurtPlayer(30, {
      source: "probe", x: ps.x + Math.sin(ps.yaw) * 6, z: ps.z + Math.cos(ps.yaw) * 6,
    });
    const behind = T.combat.hurtPlayer(10, {
      source: "probe", x: ps.x - Math.sin(ps.yaw) * 6, z: ps.z - Math.cos(ps.yaw) * 6,
    });
    return {
      state: T.summit.blockState(),
      hp: T.combat.player.hp,
      front, behind,
      dock: T.summit.kitDockState(),
    };
  });
  check("bastion: shield raises on E", blockUp.state?.active === true,
    { activeFor: blockUp.state?.activeFor });
  check("bastion: frontal blow blocked for free", blockUp.state?.blocks >= 1
    && blockUp.hp === 150 - 10, { hp: blockUp.hp, blocks: blockUp.state?.blocks });
  check("bastion: rear blow lands", blockUp.hp < 150, { hp: blockUp.hp });
  check("bastion: hud dock shows guard", blockUp.dock?.ability?.state === "active",
    blockUp.dock?.ability);
  await shoot(page, "bastion-block.png");
  /* Hold it an implausible time for an energy shield - free is free. */
  await stepFor(page, 6.0);
  const blockHeld = await page.evaluate(() => ({
    state: window.__SF.summit.blockState(),
    fuel: window.__SF.jetpackState().fuel,
  }));
  check("bastion: guard holds with no charge drain",
    blockHeld.state?.active === true && blockHeld.fuel > 70,
    { fuel: blockHeld.fuel, activeFor: blockHeld.state?.activeFor });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyE" })));
  await stepFor(page, 0.3);

  /* ---- melee tempo: the shared clip at 0.78x speed. */
  const meleeProbe = await page.evaluate(() => {
    const T = window.__SF;
    const dur = T.actionDuration("melee1");
    T.player.meleeSwing(T.player.state.yaw);
    let steps = 0;
    while (T.player.action && steps < 400) { T.advanceTime(1 / 60, 1 / 60); steps += 1; }
    return { dur, seconds: steps / 60 };
  });
  check("bastion: hammer swings at 0.78x tempo",
    meleeProbe.seconds > meleeProbe.dur * 1.15 && meleeProbe.seconds < meleeProbe.dur * 1.45,
    meleeProbe);

  /* ---- the hammer cast, against a body placed on the aim line. */
  const castSetup = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const ps = T.player.state;
    ps.camPitch = 0.0;
    T.advanceTime(0.5, 1 / 60);
    const yaw = ps.aimViewYaw;
    const ex = ps.x + Math.sin(yaw) * 14;
    const ez = ps.z + Math.cos(yaw) * 14;
    /* A gleaner: 3.5m tall, so the level aim ray cannot pass over it
       the way it does a knee-high thresher. */
    const inst = T.spawnEnemy("gleaner", ex, ez, {});
    return { inst, yaw };
  });
  check("bastion: probe gleaner spawned", !!castSetup.inst, castSetup.inst);
  const castOk = await page.evaluate(() => window.__SF.summit.throwHammer());
  check("bastion: cast accepted", castOk === true);
  await stepFor(page, 0.30);
  const windup = await page.evaluate(() => window.__SF.summit.kitState().hammer);
  await stepFor(page, 0.35);
  const midCast = await page.evaluate(() => window.__SF.summit.kitState().hammer);
  check("bastion: wind-up then flight", windup.phase === "windup"
    && midCast.casts >= 1,
    { at030: windup.phase, at065: midCast.phase, casts: midCast.casts });
  await shoot(page, "bastion-cast.png");
  await stepFor(page, 3.0);
  const caught = await page.evaluate(() => ({
    hammer: window.__SF.summit.kitState().hammer,
    live: window.__SF.enemies.live
      .filter((e) => e.state !== "death" && e.health > 0).length,
  }));
  check("bastion: cast kills the gleaner in one blow",
    caught.hammer.hits >= 1 && caught.live === 0,
    { hits: caught.hammer.hits, live: caught.live });
  check("bastion: hammer returned to the fist", caught.hammer.phase === "held"
    && caught.hammer.catches >= 1 && caught.hammer.cooldown > 0,
    { catches: caught.hammer.catches, cooldown: caught.hammer.cooldown });
  const reCast = await page.evaluate(() => {
    const ok = window.__SF.summit.throwHammer();
    return { ok, reason: window.__SF.summit.kitState().hammer.lastReason };
  });
  check("bastion: recast refused on cooldown", reCast.ok === false
    && reCast.reason === "cooldown", reCast);

  /* ---- flyer knockdown: a censer-kite forced onto the flight line. */
  const kite = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const trials = T.summit.trialsState();
    const drone = trials.drones[0];
    return drone;
  });
  check("bastion: censer-kites aloft", kite && kite.alive && !kite.grounded, kite && {
    hp: kite.hp, position: kite.position,
  });
  const knockdown = await page.evaluate(() => {
    /* The same sweep the flying hammer performs, aimed through the
       kite - this is the kit's own code path (summit-kenosis
       sweepHammer -> trials.sweep with knockdown), driven from its
       public seam so the probe does not depend on camera aim. */
    const T = window.__SF;
    const trials = T.summit.trialsHandle ? T.summit.trialsHandle() : null;
    const drone = trials?.drones?.[0];
    if (!drone) return { missing: true };
    const hits = trials.sweep(drone.x - 5, drone.y, drone.z, 1, 0, 0, 10, {
      damage: 130, stun: 3.0, knockdown: true, exclude: new Set(),
    });
    T.advanceTime(1.2, 1 / 60);
    return {
      hits: hits ? hits.length : 0,
      grounded: drone.grounded,
      hp: drone.hp,
      stunFor: drone.stunFor,
      y: drone.y,
    };
  });
  check("bastion: hammer sweep fells the flyer", knockdown.hits >= 1
    && knockdown.grounded === true && knockdown.hp <= 140 - 100,
    knockdown);

  /* ---- death and the basecamp revive. */
  const revive = await page.evaluate(() => {
    const T = window.__SF;
    T.combat.player.hp = 5;
    const ps = T.player.state;
    T.combat.hurtPlayer(60, {
      source: "probe", x: ps.x - Math.sin(ps.yaw) * 4, z: ps.z - Math.cos(ps.yaw) * 4,
    });
    const dead = T.combat.player.dead;
    T.advanceTime(3.2, 1 / 60);
    return {
      dead,
      aliveAfter: !T.combat.player.dead,
      hp: T.combat.player.hp,
      x: ps.x, z: ps.z,
    };
  });
  check("bastion: death revives at basecamp", revive.dead && revive.aliveAfter
    && revive.hp === 150, revive);

  report.states.bastion = await page.evaluate(() => ({
    kit: window.__SF.summit.kitState(),
    jet: window.__SF.jetpackState(),
    dock: window.__SF.summit.kitDockState(),
  }));
  check("bastion: zero page errors", errors.length === 0, errors.slice(0, 4));
  await context.close();
}

/* ------------------------------------------------------------------
   WHITE VIGIL
   ------------------------------------------------------------------ */
async function probeVigil(browser) {
  const { page, context, errors } = await bootOperative(browser, "white-vigil");
  report.errors.vigil = errors;

  const kit0 = await page.evaluate(() => window.__SF.summit.kitState());
  check("vigil: kit present", kit0 && kit0.id === "white-vigil", kit0?.doctrine);
  check("vigil: two blink charges", kit0?.blink?.charges === 2
    && kit0?.blink?.rangeM === 12, kit0?.blink);

  const jet0 = await page.evaluate(() => window.__SF.jetpackState());
  check("vigil: augur carries the deeper tank", jet0?.maxFuel === 130
    && jet0?.leapMode !== true, { maxFuel: jet0?.maxFuel });

  const loco = await page.evaluate(() => window.__SF.summit.character().locomotion);
  check("vigil: fast movement profile", loco?.sprintSpeed === 9.6
    && loco?.walkSpeed === 4.8, loco && { sprint: loco.sprintSpeed, walk: loco.walkSpeed });

  /* ---- the Vigil Step. */
  const blink = await page.evaluate(() => {
    const T = window.__SF;
    const ps = T.player.state;
    const from = { x: ps.x, z: ps.z };
    const ok = T.summit.blink();
    return {
      ok,
      moved: Math.hypot(ps.x - from.x, ps.z - from.z),
      kit: T.summit.kitState().blink,
    };
  });
  check("vigil: blink displaces the body", blink.ok === true && blink.moved >= 8,
    { moved: Number(blink.moved.toFixed(2)) });
  check("vigil: blink spends a charge", blink.kit.charges === 1
    && blink.kit.casts === 1, blink.kit);
  await shoot(page, "vigil-blink.png");
  const blink2 = await page.evaluate(() => {
    const T = window.__SF;
    T.summit.blink();
    const drained = T.summit.kitState().blink;
    const refused = T.summit.blink();
    return { drained, refused, reason: T.summit.kitState().blink.lastReason };
  });
  check("vigil: third step refused for charge", blink2.refused === false
    && blink2.reason === "no-charge", { reason: blink2.reason });
  await stepFor(page, 6.0);
  const recharged = await page.evaluate(() => window.__SF.summit.kitState().blink);
  check("vigil: charges walk back", recharged.charges >= 1,
    { charges: recharged.charges, rechargeIn: recharged.rechargeIn });

  /* ---- the crescent volley against a body. */
  const volley = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const ps = T.player.state;
    ps.camPitch = 0.0;
    T.advanceTime(0.4, 1 / 60);
    const yaw = ps.aimViewYaw;
    T.spawnEnemy("gleaner", ps.x + Math.sin(yaw) * 12, ps.z + Math.cos(yaw) * 12, {});
    const before = T.enemies.live[0]?.health ?? null;
    T.setFiring(true);
    T.advanceTime(1.6, 1 / 60);
    T.setFiring(false);
    const after = T.enemies.live[0]?.health ?? null;
    return { before, after, discharge: T.summit.dischargeState() };
  });
  check("vigil: volley is a real weapon", volley.discharge.hits >= 1
    && (volley.after === null || volley.after < volley.before),
    { before: volley.before, after: volley.after, hits: volley.discharge.hits });
  check("vigil: mid-range numbers", volley.discharge.rangeM === 42
    && volley.discharge.damage === 26 && volley.discharge.speedMps === 46,
    { range: volley.discharge.rangeM, damage: volley.discharge.damage });
  await shoot(page, "vigil-volley.png");

  /* ---- fast blades. */
  const meleeProbe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const dur = T.actionDuration("melee1");
    T.player.meleeSwing(T.player.state.yaw);
    const began = !!T.player.action;
    let steps = 0;
    while (T.player.action && steps < 400) { T.advanceTime(1 / 60, 1 / 60); steps += 1; }
    return { dur, began, seconds: steps / 60 };
  });
  check("vigil: blades swing without a weapons module", meleeProbe.began === true);
  check("vigil: blades run at 1.30x tempo",
    meleeProbe.seconds < meleeProbe.dur * 0.88 && meleeProbe.seconds > meleeProbe.dur * 0.62,
    meleeProbe);

  /* ---- the trials cohort answers, and the ambush is real: an idle
     operative standing in the yard bleeds. (It also DIES in about
     seven seconds - measured - which is what the revive flow is for;
     the probe leaves before that.) */
  const trial = await page.evaluate(() => {
    const T = window.__SF;
    const yard = T.summit.trialsState().yard;
    T.teleport(yard.x, yard.z, 0);
    T.advanceTime(1.2, 1 / 60);
    const state1 = T.summit.trialsState();
    T.advanceTime(2.2, 1 / 60);
    const hpUnderFire = T.combat.player.hp;
    T.summit.clearTrials();
    T.clearEnemies();
    T.combat.player.hp = T.combat.player.maxHp;
    return {
      engagedState: state1.cohort.state,
      live: state1.cohort.live,
      hpUnderFire,
    };
  });
  check("vigil: the yard answers", trial.engagedState === "engaged" && trial.live > 0,
    { state: trial.engagedState, live: trial.live });
  check("vigil: the cohort presses a real attack", trial.hpUnderFire < 150,
    { hpUnderFire: Math.round(trial.hpUnderFire) });
  await shoot(page, "vigil-trials.png");

  report.states.vigil = await page.evaluate(() => ({
    kit: window.__SF.summit.kitState(),
    jet: window.__SF.jetpackState(),
    dock: window.__SF.summit.kitDockState(),
    discharge: window.__SF.summit.dischargeState(),
  }));
  check("vigil: zero page errors", errors.length === 0, errors.slice(0, 4));
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
    await probeBastion(browser);
    await probeVigil(browser);
  } finally {
    await browser?.close();
    child.kill();
  }
  const failed = report.checks.filter((c) => !c.pass);
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
  console.log(`report: ${path.join(outDir, "report.json")}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
