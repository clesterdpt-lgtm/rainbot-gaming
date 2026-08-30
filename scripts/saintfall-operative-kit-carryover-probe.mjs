#!/usr/bin/env node
/* Focused regression for the two Kenosis operatives in the full
   Saintfall campaign. This proves the character picker changes more
   than the body: authored weapon assets, active-doctrine routing,
   attacks, guard and the campaign save contract all boot together. */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 50100 + (process.pid % 300);
const base = `http://127.0.0.1:${port}`;
const proofDir = path.join(root, "output", "playwright", "saintfall-operative-kit-carryover");
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
});

const checks = [];
function check(name, pass, actual, expected) {
  checks.push({ name, pass: Boolean(pass), actual, expected });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
  if (!pass) console.log(`     actual: ${JSON.stringify(actual)}\n   expected: ${JSON.stringify(expected)}`);
}

async function waitForServer() {
  for (let i = 0; i < 160; i += 1) {
    try {
      const response = await fetch(`${base}/games/saintfall.html`, { cache: "no-store" });
      if (response.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

/* `requireKit` is not optional decoration: the ready-gate below waits
   on `kenosis.status()`, and Vesper has no Kenosis kit at all - so
   booting her through the operative gate waits the full five minutes
   and then throws. */
async function boot(page, character, { requireKit = true } = {}) {
  await page.goto(`${base}/games/saintfall.html?qa=1&intro=0&quality=low&character=${character}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(
    (needKit) => window.__SF?.isReady?.() && (!needKit || window.__SF?.kenosis?.status?.()),
    requireKit, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.invulnerable(true);
    window.__SF.clearEnemies();
    window.__SF.maximize?.();
  });
  await page.waitForTimeout(250);
}

let browser;
try {
  await waitForServer();
  await mkdir(proofDir, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await boot(page, "white-vigil");
  await page.screenshot({ path: path.join(proofDir, "white-vigil-campaign.png") });
  const white = await page.evaluate(() => {
    const T = window.__SF;
    const snapshot = T.saves.capture();
    const before = { x: T.player.state.x, z: T.player.state.z };
    const stepped = T.kenosis.tryBlink();
    T.advanceTime(0.12);
    const after = { x: T.player.state.x, z: T.player.state.z };
    const firedLeft = T.discharge.fireOnce(0);
    const firedRight = T.discharge.fireOnce(1);
    T.advanceTime(0.04);
    const meleeStarted = T.player.meleeSwing(T.player.state.aimViewYaw);
    const actionBeforeRestore = T.player.action;
    const blinkBeforeRestore = T.kenosis.status().blink;
    const restored = T.saves.apply(snapshot);
    T.advanceTime(0.02);
    return {
      parts: T.loadout.parts.map((part) => part.spec.id),
      doctrine: T.kenosis.status().doctrine,
      blink: blinkBeforeRestore,
      stepped,
      stepDistance: Math.hypot(after.x - before.x, after.z - before.z),
      firedLeft,
      firedRight,
      discharge: T.discharge.status(),
      meleeStarted,
      actionBeforeRestore,
      restored,
      restoredBlink: T.kenosis.status().blink,
      restoredDischarge: T.discharge.status(),
      restoredAction: T.player.action,
      campaignWeaponVisible: T.weapons.current.root.visible,
      saveWeapon: snapshot?.weapon || null,
    };
  });
  check("White Vigil carries both authored crescent emitters",
    JSON.stringify(white.parts) === JSON.stringify(["left-hybrid", "right-hybrid"]),
    white.parts, ["left-hybrid", "right-hybrid"]);
  check("White Vigil runs The Kenotic Rite with a working Step",
    white.doctrine === "The Kenotic Rite" && white.stepped
      && white.stepDistance > 5 && white.blink.charges === 1,
    white, "Wing doctrine, >5m step, one of two charges spent");
  check("White Vigil fires from both real emitters and can enter its blade combo",
    white.firedLeft && white.firedRight && white.discharge.supported
      && white.discharge.fired >= 2 && white.meleeStarted
      && String(white.actionBeforeRestore).startsWith("melee"),
    white, "two crescent shots and a live melee action");
  check("White Vigil field restore clears transient shots and replenishes Step",
    white.restored && white.restoredDischarge.active === 0
      && white.restoredBlink.charges === 2 && white.restoredAction === null,
    white, "restore accepted, no live crescents/action, two Step charges");
  check("White Vigil hides the compatibility lance while retaining a valid save record",
    white.campaignWeaponVisible === false && white.saveWeapon?.mode === "ranged"
      && typeof white.saveWeapon?.overheated === "boolean",
    white, "hidden campaign lance and normalized weapon snapshot");

  await boot(page, "bastion-penitent");
  await page.screenshot({ path: path.join(proofDir, "bastion-campaign.png") });
  const bastion = await page.evaluate(() => {
    const T = window.__SF;
    const snapshot = T.saves.capture();
    T.setShieldInput(true);
    T.advanceTime(0.22);
    const guarded = T.kenosis.status().block;
    T.setShieldInput(false);
    T.advanceTime(0.12);
    const cast = T.kenosis.tryThrowHammer();
    T.advanceTime(0.7);
    const hammerBeforeRestore = T.kenosis.status().hammer;
    const restored = T.saves.apply(snapshot);
    T.advanceTime(0.02);
    return {
      parts: T.loadout.parts.map((part) => part.spec.id),
      doctrine: T.kenosis.status().doctrine,
      guarded,
      cast,
      hammerBeforeRestore,
      restored,
      restoredKit: T.kenosis.status(),
      leapMode: T.jetpack.status(T.player.state).leapMode,
      campaignWeaponVisible: T.weapons.current.root.visible,
      saveWeapon: snapshot?.weapon || null,
    };
  });
  check("Bastion carries the authored tower shield and reliquary hammer",
    JSON.stringify(bastion.parts) === JSON.stringify(["bastion-shield", "bastion-hammer"]),
    bastion.parts, ["bastion-shield", "bastion-hammer"]);
  check("Bastion runs The Iron Liturgy with a live unlimited tower guard",
    bastion.doctrine === "The Iron Liturgy" && bastion.guarded.active
      && bastion.guarded.blocks === 0,
    bastion, "Censer doctrine and an active tower guard");
  check("Bastion's Hammer Cast leaves the hand and the Censer pack remains leap-only",
    bastion.cast && ["out", "return"].includes(bastion.hammerBeforeRestore.phase)
      && bastion.hammerBeforeRestore.casts === 1 && bastion.leapMode,
    bastion, "one hammer cast in flight/return and leap-mode pack");
  check("Bastion field restore recalls Hammer Cast and drops transient guard",
    bastion.restored && bastion.restoredKit.hammer.phase === "held"
      && bastion.restoredKit.block.active === false,
    bastion, "restore accepted, hammer held, guard inactive");
  check("Bastion hides the compatibility lance while retaining a valid save record",
    bastion.campaignWeaponVisible === false && bastion.saveWeapon?.mode === "ranged"
      && typeof bastion.saveWeapon?.overheated === "boolean",
    bastion, "hidden campaign lance and normalized weapon snapshot");

  /* ============================================================
     m112 - THE DOCTRINE AND THE CALL ACTIONS, IN THE CAMPAIGN

     The kits came across first and the trees and the wheel followed.
     Booting is not the proof: the tree has to be BUYABLE and its
     rites have to FIRE, the operative's own commands have to LAND,
     and Vesper has to be untouched by all of it.
     ============================================================ */
  for (const [id, order0, capstone, verb] of [
    ["white-vigil", "quicksilver", "quicksilver_unbroken_vigil", "blink"],
    ["bastion-penitent", "bulwark", "bulwark_the_shut_gate", "guardBlock"],
  ]) {
    await boot(page, id);
    const live = await page.evaluate(async ({ order0, capstone, verb }) => {
      const T = window.__SF;
      const d = T.progression;
      const defs = d.definitions();
      const wheel = Array.from(T.ctx.mission.wheelOrder || []);

      /* BUY THE ORDER through the production spend() path, then drive
         a rite and diff the proc counter - the same rule the summit
         audit uses: a talent that does not appear in `procCounts()`
         did not fire, and every seam here is optional-chained. */
      d.respec?.();
      d.grantXp?.(99999, null, "qa");
      const order = defs.orders.find((o) => o.id === order0);
      const bought = [];
      for (const talent of order.talents) {
        for (let r = 0; r < talent.maxRank; r += 1) {
          if (d.spend(talent.id).ok) bought.push(talent.id);
        }
      }
      const equipped = d.equipCapstone(capstone, 0).ok;
      const before = Object.keys(d.procCounts()).length;
      d.verb(verb, { amount: 40, perfect: true, fromX: T.player.state.x, fromZ: T.player.state.z });
      T.advanceTime(0.6, 1 / 60);
      const procs = d.procCounts();

      /* AND THE COMMANDS. Called through `ctx.mission.call`, which is
         what the wheel presses, and watched for a real impact. */
      const log = [];
      T.ctx.command.bus.on("impact", (e) => log.push(e.key));
      T.summit?.commandReset?.() ?? T.ctx.command.reset();
      const key = wheel[0];
      const accepted = T.ctx.mission.call(key);
      T.advanceTime(7, 1 / 60);

      /* The arrow code has to resolve against THIS catalog too. */
      T.ctx.command.reset();
      T.ctx.mission.beginEntry();
      const code = T.ctx.mission.stratagems[wheel[1]].code;
      let coded = null;
      for (const dir of code) coded = T.ctx.mission.pushDirection(dir);
      T.ctx.command.reset();

      return {
        tree: defs.id, orders: defs.orders.length,
        nodes: defs.orders.reduce((n, o) => n + o.talents.length + (o.capstone ? 1 : 0), 0),
        bought: bought.length, equipped,
        fired: Object.keys(procs).length - before,
        wheel, accepted, landed: log.filter((k) => k === key).length, coded,
      };
    }, { order0, capstone, verb });

    check(`${id}: carries its own doctrine in the campaign`,
      live.tree === id && live.orders === 5 && live.nodes === 25 && live.bought === 8
      && live.equipped,
      live, "own 5-order/25-node tree, Order buyable, Vow equippable");
    check(`${id}: its rites fire in the campaign`, live.fired > 0, live, "at least one proc");
    check(`${id}: its own call actions land in the campaign`,
      live.accepted === live.wheel[0] && live.landed === 1,
      live, "call accepted and one impact");
    check(`${id}: the arrow code resolves its own catalog`,
      live.coded === live.wheel[1], live, `code returns ${live.wheel[1]}`);
  }

  /* Vesper: nothing about any of this reaches her. */
  await boot(page, "vesper-reliquary", { requireKit: false });
  const vesper = await page.evaluate(() => {
    const T = window.__SF;
    const defs = T.progression.definitions();
    return {
      wheel: Array.from(T.ctx.mission.wheelOrder || []),
      orders: (defs.orders || defs.doctrine?.orders || []).map((o) => o.id),
      command: !!T.ctx.command,
      career: !!T.progression.captureCareer?.(),
    };
  });
  check("Vesper keeps her own doctrine, wheel and career envelope",
    vesper.command === false && vesper.career === true
    && JSON.stringify(vesper.wheel) === JSON.stringify(["orbital", "cluster", "resupply"])
    && vesper.orders.includes("censer"),
    vesper, "no command module, career intact, Vesper's five Orders and three stratagems");

  check("full-campaign operative boots stay console clean",
    errors.length === 0, errors, []);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

const failures = checks.filter((entry) => !entry.pass);
console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
if (failures.length) process.exitCode = 1;
