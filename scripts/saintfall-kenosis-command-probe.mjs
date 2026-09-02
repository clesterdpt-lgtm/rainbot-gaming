#!/usr/bin/env node
/* The Kenosis field commands, proved by what they DO.

   A call action is the hardest thing in this codebase to verify by
   looking: it is asynchronous (a fuse burns for seconds), it resolves
   through a shockwave whose return value the caller discards, and
   every seam it crosses is optional-chained - so `call()` returning
   its own key proves only that the catalog has an entry. This asks
   each command the question it exists to answer:

     Gilding Rite    did the pool refill and is the boon live?
     Mirror Choir    are three effigies standing, and is the swarm
                     actually looking at them rather than at the Vigil?
     Crescent Rain   does a target in the AIR take more than the same
                     target on the ground?
     Standing Gate   does a shot that crosses the wall get stopped and
                     a shot that does not, not?
     Falling Anvil   is a flyer inside the outer ring on the ground?

   Plus the two Vows, which change the SHAPE of a call rather than a
   number: The Response must turn one call into three impacts, and
   The Great Bell must land at the caller's own feet with no fuse. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/kenosis-commands");
const port = 47800 + (process.pid % 1100);
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

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};

const EXPECTED = {
  "white-vigil": ["mirrorchoir", "crescentrain", "resupply"],
  "bastion-penitent": ["standinggate", "fallinganvil", "resupply"],
};

/* Enough to outlast the longest fuse (3.4s) plus the Rain's own
   0.7s walk and the Anvil's staged arrival. */
const RESOLVE_SECONDS = 6.0;

/* A COMMAND TAKES SECONDS AND A THRESHER DOES NOT WAIT. Charge speed
   is 7.4 m/s, so a body alerted at the beacon has run twenty-five
   metres by the time a 3.4-second fuse burns down - and every blast
   assertion reads zero against a target that was simply somewhere
   else. `stunTime` is combat.js's own "this creature does nothing"
   gate and `untouchable` does not include it, so a long stun holds
   the subject in place without protecting it from anything. */
const HOLD_STILL = `(inst) => { inst.stunTime = 999; return inst; }`;


/* THE SUMMIT HAS NO FLYING ENEMY. Its roster is thresher / gleaner /
   harrow and the trials' censer-kites are the trials module's own
   drones, not bestiary instances - so a probe that spawns
   "censer-kite" gets nothing back and every flyer assertion silently
   compares undefined to undefined.

   `combat.groundFlyer` and the Rain's air bonus both read exactly two
   things: `inst.spec.flies` and `inst.grounded`. `inst.spec` is a
   per-instance REFERENCE to the shared spec table, so replacing it
   with a copy gives this one body wings and leaves every other
   thresher on the level alone. */
const MAKE_FLYER = `(inst, height) => {
  inst.spec = { ...inst.spec, flies: true };
  inst.grounded = false;
  inst.y = window.__SF.summit.altitudeAt(inst.x, inst.z) + height;
  return inst;
}`;


async function auditOperative(browser, character) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 180)}`); });
  await page.goto(
    /* `?fuel=limited` is not decoration. The summit builds its pack with
       `unlimitedFuel` unless asked otherwise, and `jetpack.drain` then
       short-circuits to a full tank on every call - so on the default
       URL the Gilding Rite's charge refill is unmeasurable, and a
       harness that measured it anyway would report a pass it did not
       earn either way. */
    `${base}/games/saintfall-white-vigil.html?qa=1&character=${character}&quality=medium&time=noon&fuel=limited`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate((src) => { window.__MAKE_FLYER = eval(src); }, MAKE_FLYER);
  await page.evaluate((src) => { window.__HOLD_STILL = eval(src); }, HOLD_STILL);
  await page.evaluate(() => {
    document.documentElement.classList.add("sf-maximised");
    const T = window.__SF;
    /* Flat, open, and well clear of the trial yard - the cohort has a
       40m wake radius and a command probe that accidentally fights a
       Harrow measures the Harrow. */
    T.teleport(120, 930, Math.PI);
    T.summit.armCommandLog();
    T.advanceTime(1.0, 1 / 60);
  });

  /* ---------------- the catalog and the wheel ---------------- */
  const catalog = await page.evaluate(() => {
    const T = window.__SF;
    const c = T.summit.commandCatalog();
    return {
      order: c.order,
      specs: c.order.map((k) => ({
        key: k,
        name: c.stratagems[k]?.name,
        short: c.stratagems[k]?.short,
        colour: c.stratagems[k]?.colour,
        cooldown: c.stratagems[k]?.cooldown,
      })),
    };
  });
  check(`${character}: three commands, the right three`,
    JSON.stringify(catalog.order) === JSON.stringify(EXPECTED[character]),
    catalog.order);
  check(`${character}: every command is named and coloured`,
    catalog.specs.every((s) => s.name && s.short && /^#[0-9a-f]{6}$/i.test(s.colour)),
    catalog.specs.map((s) => `${s.key}=${s.name}`));

  /* The wheel itself. Three sectors, three DISTINCT sigils - a key
     with no entry in ui.js's ICONS table silently renders the generic
     crest, which on a three-sector wheel is three identical buttons. */
  const wheel = await page.evaluate(() => {
    const T = window.__SF;
    T.gameUi.closeMenu?.();
    /* Opened the way a player opens it - `ui.js` has no public
       open-the-wheel call, and a wheel populated by reading the DOM
       of a closed dialog would not prove the key path works. */
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ", bubbles: true }));
    const opened = T.gameUi.wheelState().open;
    const nodes = Array.from(document.querySelectorAll(".sf-command-wheel__option"));
    const paths = nodes.map((n) => Array.from(n.querySelectorAll(".sf-command-wheel__sigil path"))
      .map((p) => p.getAttribute("d")).join("|"));
    return {
      opened,
      count: nodes.length,
      keys: nodes.map((n) => n.dataset.command),
      names: nodes.map((n) => n.querySelector("strong")?.textContent || ""),
      angles: nodes.map((n) => n.style.getPropertyValue("--sf-command-angle")),
      distinctSigils: new Set(paths).size,
    };
  });
  check(`${character}: the wheel opens and carries all three, on distinct sectors`,
    wheel.opened === true && wheel.count === 3 && new Set(wheel.angles).size === 3
    && JSON.stringify(wheel.keys) === JSON.stringify(EXPECTED[character]), wheel);
  await page.evaluate(() => window.__SF.gameUi.cancelWheel("probe"));
  check(`${character}: each wheel sector has its own sigil`,
    wheel.distinctSigils === 3, { distinct: wheel.distinctSigils, names: wheel.names });

  /* ---------------- every command actually lands ---------------- */
  const landings = await page.evaluate(async ({ seconds }) => {
    const T = window.__SF;
    const out = [];
    for (const key of T.summit.commandCatalog().order) {
      T.summit.commandReset();
      T.summit.clearCommandLog();
      T.advanceTime(0.2, 1 / 60);
      const accepted = T.summit.commandCall(key);
      const afterCall = {
        pending: T.summit.commandPending().length,
        cooldown: T.summit.commandCooldowns()[key],
      };
      /* A second call in the same breath must be refused - the whole
         point of a cooldown, and the one behaviour a catalog-only
         implementation would still pass. */
      const second = T.summit.commandCall(key);
      T.advanceTime(seconds, 1 / 60);
      const log = T.summit.commandLog().filter((e) => e.key === key && !e.echo);
      out.push({
        key, accepted, second, afterCall,
        impacts: log.length,
        radius: log[0]?.radius ?? 0,
        damage: log[0]?.damage ?? 0,
        stillPending: T.summit.commandPending().length,
      });
    }
    T.summit.commandReset();
    return out;
  }, { seconds: RESOLVE_SECONDS });
  check(`${character}: every command is accepted, lands once, and clears`,
    landings.every((r) => r.accepted === r.key && r.second === null
      && r.afterCall.pending === 1 && r.afterCall.cooldown > 0
      && r.impacts === 1 && r.stillPending === 0),
    landings);

  /* ---------------- what each one actually DOES ---------------- */
  const effects = {};

  /* THE GILDING RITE. Shared by both operatives, so it is measured
     for both: the pool refilled, the pack refilled, and the boon
     multiplying damage on the combat path. */
  effects.gilding = await page.evaluate(async ({ seconds }) => {
    const T = window.__SF;
    T.summit.commandReset();
    T.combat.player.hp = 40;
    const maxFuel = T.jetpack.status(T.player.state).maxFuel;
    const before = { hp: T.combat.player.hp, boon: T.summit.commandBoon() };
    T.summit.commandCall("resupply");
    T.advanceTime(seconds, 1 / 60);
    /* FUEL IS THE WRONG MEASUREMENT. The pack recharges on its own
       over the six seconds this waits, so a full tank afterwards
       proves nothing. What the rite actually buys the pack is FREE
       FLIGHT, and the honest test of that is to spend from the tank
       and find it still full - `jetpack.drain` short-circuits to
       maxFuel whenever the boon is live, which is the exact line the
       blessing reaches. */
    const drainedUnderBoon = (() => {
      T.jetpack.drain(maxFuel * 0.8);
      return T.jetpack.status(T.player.state).fuel;
    })();
    /* Read the blessing BEFORE the control spend clears it - the reset
       below is what makes the control a control. */
    const boonLive = T.summit.commandBoon();
    const emptied = (() => {
      T.summit.commandReset();
      T.jetpack.drain(maxFuel * 0.8);
      return T.jetpack.status(T.player.state).fuel;
    })();
    const after = {
      hp: T.combat.player.hp,
      maxHp: T.combat.player.maxHp,
      maxFuel,
      drainedUnderBoon,
      drainedWithout: emptied,
      boon: boonLive,
    };
    T.summit.commandReset();
    return { before, after };
  }, { seconds: RESOLVE_SECONDS });
  check(`${character}: the Gilding Rite restores, consecrates and frees the pack`,
    effects.gilding.after.hp === effects.gilding.after.maxHp
    && effects.gilding.after.drainedUnderBoon === effects.gilding.after.maxFuel
    && effects.gilding.after.drainedWithout < effects.gilding.after.maxFuel
    && effects.gilding.after.boon.active === true
    && effects.gilding.after.boon.damage > 1.2
    && effects.gilding.after.boon.infiniteCharge === true,
    effects.gilding);

  if (character === "white-vigil") {
    /* THE MIRROR CHOIR. Three effigies, and - the actual mechanic -
       a swarm whose attention has been moved off the player. The lure
       is `inst.commandLure` with `owner: "mission"`, which combat.js
       checks BEFORE ordinary player sensing; anything else is
       overwritten on the very next frame by a nearby player. */
    effects.choir = await page.evaluate(async ({ seconds }) => {
      const T = window.__SF;
      T.summit.commandReset();
      T.clearEnemies();
      const ps = T.player.state;
      /* Ahead of the look, where the beacon will land. */
      const tx = ps.x + Math.sin(ps.camYaw) * 22;
      const tz = ps.z + Math.cos(ps.camYaw) * 22;
      for (let i = 0; i < 4; i += 1) {
        T.spawnEnemy("thresher", tx + (i - 1.5) * 3, tz + 2, {});
      }
      T.advanceTime(0.3, 1 / 60);
      const hpBefore = T.enemies.live.map((e) => e.health);
      T.summit.commandCall("mirrorchoir");
      T.advanceTime(2.4, 1 / 60);
      const fields = T.summit.commandFields();
      const lured = T.enemies.live.filter((e) => e.commandLure
        && e.commandLure.owner === "mission").length;
      const held = fields.effigies.length;
      /* Then hold past the effigies' 8-second life to see them
         shatter for damage rather than simply expiring. */
      T.advanceTime(9.0, 1 / 60);
      const hpAfter = T.enemies.live.map((e) => e.health);
      const after = T.summit.commandFields();
      const out = {
        held, lured,
        alive: T.enemies.live.length,
        damaged: hpBefore.reduce((n, h, i) => n + ((hpAfter[i] ?? 0) < h ? 1 : 0), 0),
        remainingEffigies: after.effigies.length,
      };
      T.clearEnemies();
      T.summit.commandReset();
      return out;
    }, { seconds: RESOLVE_SECONDS });
    check("white-vigil: the Choir stands three and holds the swarm",
      effects.choir.held === 3 && effects.choir.lured >= 3
      && effects.choir.damaged >= 1 && effects.choir.remainingEffigies === 0,
      effects.choir);

    /* CRESCENT RAIN. The claim is that it is weighted against the
       air, so the honest test is the SAME creature at the SAME
       distance, once grounded and once flying. */
    effects.rain = await page.evaluate(async ({ seconds }) => {
      const T = window.__SF;
      const run = async (flying) => {
        T.summit.commandReset();
        T.clearEnemies();
        const ps = T.player.state;
        const tx = ps.x + Math.sin(ps.camYaw) * 22;
        const tz = ps.z + Math.cos(ps.camYaw) * 22;
        T.spawnEnemy("thresher", tx, tz, {});
        T.advanceTime(0.3, 1 / 60);
        const inst = T.enemies.live[0];
        if (!inst) return null;
        /* Same body, same ground position - only the altitude and the
           `flies` flag differ, which is exactly the variable. */
        if (flying) window.__MAKE_FLYER(inst, 3.5);
        window.__HOLD_STILL(inst);
        inst.health = 4000;
        const before = inst.health;
        T.summit.commandCall("crescentrain");
        T.advanceTime(seconds, 1 / 60);
        const live = T.enemies.live[0];
        return { taken: before - (live ? live.health : 0) };
      };
      const air = await run(true);
      const ground = await run(false);
      T.clearEnemies();
      T.summit.commandReset();
      return { air, ground };
    }, { seconds: RESOLVE_SECONDS });
    check("white-vigil: Crescent Rain hits the air harder than the ground",
      effects.rain.ground?.taken > 0
      && effects.rain.air?.taken > effects.rain.ground.taken * 1.15,
      effects.rain);
  }

  if (character === "bastion-penitent") {
    /* THE STANDING GATE. The claim is a WALL, so the test is
       directional: an enemy shot whose line crosses the span must be
       stopped, and one from behind the player must not. A radius
       implementation passes the first and fails the second. */
    effects.gate = await page.evaluate(async ({ seconds }) => {
      const T = window.__SF;
      T.summit.commandReset();
      const ps = T.player.state;
      T.summit.commandCall("standinggate");
      T.advanceTime(seconds, 1 / 60);
      const fields = T.summit.commandFields();
      const gate = fields.gates[0] || null;
      if (!gate) return { gate: null };
      /* A shot from beyond the wall, on the line between it and the
         player - and a shot from the opposite side, which never
         crosses anything. */
      const fx = Math.sin(ps.camYaw);
      const fz = Math.cos(ps.camYaw);
      const through = T.summit.commandBlocks({
        source: "enemy-fire", enemyKey: "gleaner",
        x: ps.x + fx * 40, y: ps.y + 1, z: ps.z + fz * 40,
      });
      const behind = T.summit.commandBlocks({
        source: "enemy-fire", enemyKey: "gleaner",
        x: ps.x - fx * 40, y: ps.y + 1, z: ps.z - fz * 40,
      });
      /* And a melee blow, which a wall has no opinion about. */
      const melee = T.summit.commandBlocks({
        source: "enemy-melee", enemyKey: "harrow",
        x: ps.x + fx * 3, y: ps.y + 1, z: ps.z + fz * 3,
      });
      const out = {
        gate: { width: gate.width, remaining: Math.round(gate.remaining) },
        through, behind, melee,
      };
      T.summit.commandReset();
      return out;
    }, { seconds: RESOLVE_SECONDS });
    /* AND THE GATE IS A WALL. `blocksEnemyProjectile` is a damage-path
       test - it fires once a bolt has already arrived. This is the
       part that matters in play: a real Gleaner bolt, launched
       through the wall by the production `launchEnemyProjectile`, has
       to DIE at it. `spawnProjectile` sets a bolt's whole span from
       `collide.rayBlock`, so if the Gate is not in that query the
       bolt sails through and the wall is scenery. */
    effects.gateSolid = await page.evaluate(async ({ seconds }) => {
      const T = window.__SF;
      const shoot = () => {
        T.clearEnemies();
        const ps = T.player.state;
        /* A Gleaner directly beyond the beacon, firing back down the
           same line the Gate was called on. */
        const gx = ps.x + Math.sin(ps.camYaw) * 40;
        const gz = ps.z + Math.cos(ps.camYaw) * 40;
        T.spawnEnemy("gleaner", gx, gz, {});
        T.advanceTime(0.3, 1 / 60);
        const inst = T.enemies.live.find((e) => e.key === "gleaner");
        if (!inst) return null;
        inst.stunTime = 999;
        /* COUNTED, NOT INFERRED FROM HP. The first cut measured the
           player's health delta and was flaky run to run - regen, the
           post-hit grace and six bolts on one identical path share a
           single fate. `projectileState()` already counts what this
           check is actually about: how many bolts REACHED the player
           and how many did damage. */
        const t0 = T.combat.projectileState();
        const shots = [];
        for (let i = 0; i < 6; i += 1) {
          const r = T.combat.launchEnemyProjectile(inst, inst.spec, {
            horizontalSpread: 0.02, verticalSpread: 0.01, directAimChance: 1,
          });
          if (r && Number.isFinite(r.span)) shots.push(Number(r.span.toFixed(2)));
        }
        T.advanceTime(2.5, 1 / 60);
        const t1 = T.combat.projectileState();
        const out = {
          spans: shots,
          contacts: t1.contacts - t0.contacts,
          hits: t1.damagingHits - t0.damagingHits,
        };
        T.clearEnemies();
        T.combat.clearProjectiles?.();
        T.combat.player.hp = T.combat.player.maxHp;
        return out;
      };

      T.summit.commandReset();
      T.advanceTime(0.3, 1 / 60);
      const open = shoot();                       // no wall
      T.summit.commandCall("standinggate");
      T.advanceTime(seconds, 1 / 60);
      const gate = T.summit.commandFields().gates[0] || null;
      const walled = shoot();                     // wall standing

      /* And it is solid to feet as well as to fire. */
      const ps = T.player.state;
      const gy = gate ? gate.y : ps.y;
      const atWall = gate ? T.summit.commandHandle().gateBlocks(gate.x, gate.z, gy, 0.42) : null;
      const beside = gate
        ? T.summit.commandHandle().gateBlocks(
          gate.x + Math.cos(gate.yaw) * (gate.width * 0.5 + 3),
          gate.z - Math.sin(gate.yaw) * (gate.width * 0.5 + 3), gy, 0.42)
        : null;
      const overhead = gate
        ? T.summit.commandHandle().gateBlocks(gate.x, gate.z, gy + 6, 0.42) : null;

      /* Real collision system checks for player and AI */
      const collideBlocked = gate ? T.collide.blocked(gate.x, gate.z, gy, 0.42) : null;
      const collideBeside = gate
        ? T.collide.blocked(
          gate.x + Math.cos(gate.yaw) * (gate.width * 0.5 + 3),
          gate.z - Math.sin(gate.yaw) * (gate.width * 0.5 + 3), gy, 0.42)
        : null;
      const collideOverhead = gate
        ? T.collide.flightBlocked(gate.x, gate.z, gy + 6, 0.42, 2.35)
        : null;

      /* Swept path check across the standing gate */
      const nx = Math.sin(gate?.yaw || 0);
      const nz = Math.cos(gate?.yaw || 0);
      const walkStart = gate ? [gate.x + nx * 3, gate.z + nz * 3] : null;
      const walkGoal = gate ? [gate.x - nx * 3, gate.z - nz * 3] : null;
      const walkClearThroughGate = gate
        ? T.collide.walkClear(walkStart[0], walkStart[1], walkGoal[0], walkGoal[1], 0.42)
        : null;

      /* Multi-frame walk simulation towards the gate */
      let curX = walkStart ? walkStart[0] : 0;
      let curZ = walkStart ? walkStart[1] : 0;
      const stepDist = 0.1;
      const totalSteps = 60;
      const dx = walkStart && walkGoal ? (walkGoal[0] - walkStart[0]) / 6 : 0;
      const dz = walkStart && walkGoal ? (walkGoal[1] - walkStart[1]) / 6 : 0;
      for (let i = 0; i < totalSteps; i += 1) {
        const out = T.collide.slide(curX, curZ, curX + dx * (stepDist / 1.0), curZ + dz * (stepDist / 1.0), gy, 0.42);
        curX = out[0];
        curZ = out[1];
      }
      const distanceTravelled = walkStart ? Math.hypot(curX - walkStart[0], curZ - walkStart[1]) : 0;
      const distanceToGoal = walkGoal ? Math.hypot(curX - walkGoal[0], curZ - walkGoal[1]) : 0;
      const walkBlockedByGate = distanceTravelled < 2.5 && distanceToGoal > 3.0;

      T.summit.commandReset();
      const walkClearAfterReset = gate
        ? T.collide.walkClear(walkStart[0], walkStart[1], walkGoal[0], walkGoal[1], 0.42)
        : null;

      curX = walkStart ? walkStart[0] : 0;
      curZ = walkStart ? walkStart[1] : 0;
      for (let i = 0; i < totalSteps; i += 1) {
        const out = T.collide.slide(curX, curZ, curX + dx * (stepDist / 1.0), curZ + dz * (stepDist / 1.0), gy, 0.42);
        curX = out[0];
        curZ = out[1];
      }
      const afterResetPassed = walkGoal ? Math.hypot(curX - walkGoal[0], curZ - walkGoal[1]) < 0.15 : false;

      return { open, walled, atWall, beside, overhead,
        collideBlocked, collideBeside, collideOverhead,
        walkClearThroughGate, walkClearAfterReset,
        walkBlockedByGate, afterResetPassed,
        distanceTravelled, distanceToGoal,
        width: gate ? gate.width : null };
    }, { seconds: RESOLVE_SECONDS });
    const gs = effects.gateSolid;
    /* CONTACTS, not damage. Bolts fired at a Bastion reach him and are
       then eaten by the tower shield he is holding - `damagingHits`
       came back 0 or 1 at random and had nothing to do with the wall.
       What the Gate is for is stopping a bolt REACHING you, and the
       shield's opinion of the ones that get through is a different
       system's business. */
    check("bastion-penitent: bolts die at the Gate instead of at the player",
      gs.open && gs.walled
      && gs.open.contacts > 0 && gs.walled.contacts === 0 && gs.walled.hits === 0
      && Math.min(...gs.walled.spans) < Math.min(...gs.open.spans) * 0.75,
      { openSpans: gs.open?.spans, walledSpans: gs.walled?.spans,
        open: { contacts: gs.open?.contacts, hits: gs.open?.hits },
        walled: { contacts: gs.walled?.contacts, hits: gs.walled?.hits } });
    check("bastion-penitent: the Gate is solid underfoot and open above it",
      gs.atWall === true && gs.beside === false && gs.overhead === false
      && gs.collideBlocked === true && gs.collideBeside === false
      && gs.collideOverhead === false,
      { atWall: gs.atWall, beside: gs.beside, overhead: gs.overhead,
        collideBlocked: gs.collideBlocked, collideBeside: gs.collideBeside,
        collideOverhead: gs.collideOverhead });
    check("bastion-penitent: player walking into the Gate slides and stops",
      gs.walkBlockedByGate === true && gs.afterResetPassed === true,
      { walkBlockedByGate: gs.walkBlockedByGate, afterResetPassed: gs.afterResetPassed });

    check("bastion-penitent: the Gate stops what crosses it and nothing else",
      effects.gate.gate && effects.gate.through === true
      && effects.gate.behind === false && effects.gate.melee === false,
      effects.gate);

    /* THE FALLING ANVIL. Two claims: enormous damage in a small
       radius, and everything flying in the WIDER ring put on the
       ground. The second is the one a Bastion who cannot fly buys. */
    effects.anvil = await page.evaluate(async ({ seconds }) => {
      const T = window.__SF;
      T.summit.commandReset();
      T.clearEnemies();
      const ps = T.player.state;
      const tx = ps.x + Math.sin(ps.camYaw) * 22;
      const tz = ps.z + Math.cos(ps.camYaw) * 22;
      /* One under the drop, one out at 16m - inside the 20m pressure
         ring but outside the 11m blast. */
      T.spawnEnemy("thresher", tx, tz, {});
      T.spawnEnemy("thresher", tx + 16, tz, {});
      T.advanceTime(0.3, 1 / 60);
      const kites = T.enemies.live.map((e) => window.__MAKE_FLYER(e, 6));
      kites.forEach((k) => { window.__HOLD_STILL(k); k.health = 4000; });
      const near = kites[0];
      const far = kites[1];
      const nearBefore = near?.health ?? 0;
      T.summit.commandCall("fallinganvil");
      T.advanceTime(seconds, 1 / 60);
      const out = {
        nearTaken: nearBefore - (near?.health ?? 0),
        nearGrounded: !!near?.grounded,
        farGrounded: !!far?.grounded,
        farTaken: 4000 - (far?.health ?? 0),
      };
      T.clearEnemies();
      T.summit.commandReset();
      return out;
    }, { seconds: RESOLVE_SECONDS });
    check("bastion-penitent: the Anvil crushes near and grounds wide",
      effects.anvil.nearTaken > 300 && effects.anvil.nearGrounded === true
      && effects.anvil.farGrounded === true && effects.anvil.farTaken < 50,
      effects.anvil);
  }

  /* ---------------- the two call Vows ---------------- */
  const vow = await page.evaluate(async ({ character, seconds }) => {
    const T = window.__SF;
    const d = T.summit.doctrineHandle();
    const orderId = character === "white-vigil" ? "antiphon" : "tocsin";
    const capId = character === "white-vigil"
      ? "antiphon_the_response" : "tocsin_the_great_bell";
    d.respec();
    T.summit.doctrineGrantXp(99999);
    const def = T.summit.doctrineDefinitions().orders.find((o) => o.id === orderId);
    for (const talent of def.talents) {
      for (let r = 0; r < talent.maxRank; r += 1) d.spend(talent.id);
    }
    const equipped = d.equipCapstone(capId, 0);
    T.summit.commandReset();
    T.summit.clearCommandLog();
    const first = T.summit.commandCatalog().order[0];

    if (character === "white-vigil") {
      /* THE RESPONSE. One call, three impacts - and the two extras
         must be marked as echoes so nothing downstream double-counts
         them as commands the player paid for. */
      T.summit.commandCall(first);
      T.advanceTime(seconds + 3, 1 / 60);
      const log = T.summit.commandLog();
      T.summit.commandReset();
      d.respec();
      return {
        equipped: equipped.ok,
        impacts: log.length,
        echoes: log.filter((e) => e.echo).length,
        keys: Array.from(new Set(log.map((e) => e.key))).sort(),
      };
    }

    /* THE GREAT BELL. Called from behind a raised shield it must skip
       the fuse entirely and land at the Bastion's own feet. Measured
       against a control call with the shield DOWN, so a command that
       simply had a short delay could not pass. */
    const ps = T.player.state;
    const control = (() => {
      T.summit.commandCall(first);
      const p = T.summit.commandPending()[0];
      const r = { remaining: p?.remaining ?? -1, dist: p ? Math.hypot(p.x - ps.x, p.z - ps.z) : -1 };
      T.summit.commandReset();
      return r;
    })();
    /* The shield is raised through the input the game itself reads.
       `input.state.block` is RECOMPUTED every frame from the held keys
       (`state.block = keybindDown(keys, "block") || touch.block`), so
       writing it is erased before anything looks - the touch hold is
       the half of that expression a harness can actually set. */
    T.player.input.setTouchHold("block", true);
    T.advanceTime(0.5, 1 / 60);
    const block = T.summit.blockState();
    const guarding = block?.active === true;
    T.summit.clearCommandLog();
    T.summit.commandCall(first);
    const live = T.summit.commandPending()[0] || null;
    const belled = {
      remaining: live?.remaining ?? -1,
      dist: live ? Math.hypot(live.x - ps.x, live.z - ps.z) : -1,
    };
    T.player.input.setTouchHold("block", false);
    T.advanceTime(seconds, 1 / 60);
    T.summit.commandReset();
    d.respec();
    return {
      equipped: equipped.ok, guarding, control, belled,
      block: block ? { active: block.active, requested: block.requested,
        reason: block.blockedReason } : null,
    };
  }, { character, seconds: RESOLVE_SECONDS });

  if (character === "white-vigil") {
    check("white-vigil: The Response answers one call with three",
      vow.equipped && vow.impacts === 3 && vow.echoes === 2 && vow.keys.length === 3,
      vow);
  } else {
    check("bastion-penitent: The Great Bell lands at his feet with no fuse",
      vow.equipped && vow.guarding
      && vow.control.remaining > 1.0 && vow.control.dist > 15
      && vow.belled.remaining <= 0.05 && vow.belled.dist < 2.0,
      vow);
  }

  /* ---------------- drawn, heard, and shown ---------------- */
  const presentation = await page.evaluate(async () => {
    const T = window.__SF;
    const out = { fns: [], beacon: {}, dock: null, dockRow: null };
    /* The four call effects exist and are callable. A missing one is
       an optional-chained no-op at the impact - the command lands,
       does its damage, and draws nothing at all. */
    out.fns = ["mirrorChoir", "crescentRain", "standingGate", "fallingAnvil"]
      .filter((k) => typeof T.vfx[k] === "function");

    /* And the BEACON is really in the scene while the fuse burns, and
       really gone afterwards - the one piece of a command the player
       looks at for seconds rather than frames. */
    const handle = T.summit.commandHandle();
    for (const key of T.summit.commandCatalog().order) {
      T.summit.commandReset();
      T.advanceTime(0.2, 1 / 60);
      const idle = handle.group.children.length;
      T.summit.commandCall(key);
      T.advanceTime(0.3, 1 / 60);
      const burning = handle.group.children.length;
      T.advanceTime(12, 1 / 60);
      out.beacon[key] = { idle, burning };
    }
    T.summit.commandReset();
    T.advanceTime(0.2, 1 / 60);
    T.summit.commandCall(T.summit.commandCatalog().order[0]);
    T.advanceTime(0.3, 1 / 60);
    out.dock = T.summit.commandDock();
    const dockRow = document.querySelector("#sf-kit-command");
    out.dockRow = dockRow ? {
      hidden: dockRow.hidden,
      name: dockRow.querySelector("#sf-kit-command-name")?.textContent || "",
      value: dockRow.querySelector("#sf-kit-command-value")?.textContent || "",
      state: dockRow.dataset.state,
    } : null;
    T.summit.commandReset();
    return out;
  });
  check(`${character}: every call has its own effect function`,
    presentation.fns.length === 4, presentation.fns);
  check(`${character}: a live beacon stands in the world and clears`,
    Object.values(presentation.beacon).every((b) => b.burning > b.idle),
    presentation.beacon);
  check(`${character}: the HUD shows the command row`,
    presentation.dockRow && presentation.dockRow.hidden === false
    && presentation.dockRow.value.length > 0, presentation.dockRow);
  check(`${character}: the dock reports what is in the air`,
    presentation.dock?.inbound?.remaining > 0, presentation.dock);

  /* The audio path. An Order missing from `audio.DOCTRINE_ORDERS` is
     SILENT with no error, and an Order in the Set but unrouted speaks
     with the campaign's Edict cipher - both invisible in a log. */
  /* `doctrineVoice` debounces on `ac.currentTime` - REAL seconds - and
     a probe that advanced six simulated seconds inside one real frame
     is still inside the 0.07s Order gap from whatever it just drove.
     A real pause is the only thing that clears it. */
  await delay(400);
  const heard = await page.evaluate(({ character }) => {
    const T = window.__SF;
    const order = character === "white-vigil" ? "antiphon" : "tocsin";
    const ps = T.player.state;
    return {
      order: T.audio.doctrineCue({
        order, cue: "verse", kind: "verse", stage: "proc",
        x: ps.x, y: ps.y, z: ps.z, intensity: 0.8, rank: 2,
      }),
      unknown: T.audio.doctrineCue({
        order: "not-an-order", cue: "verse", kind: "verse",
        x: ps.x, y: ps.y, z: ps.z,
      }),
      cues: ["commandCast", "gildingRite", "mirrorChoir",
        "crescentRain", "gateRaise", "anvilFall"]
        .filter((k) => typeof T.audio[k] === "function"),
    };
  }, { character });
  check(`${character}: the call Order has its own voice`,
    heard.order === true && heard.unknown === false && heard.cues.length === 6, heard);

  await page.evaluate(() => {
    const T = window.__SF;
    T.summit.commandReset();
    T.hideHud(false);
    T.summit.commandCall(T.summit.commandCatalog().order[0]);
    T.advanceTime(0.5, 1 / 60);
    T.renderStill();
  });
  await page.screenshot({
    path: path.join(outDir, `${character}-beacon.png`),
    clip: { x: 0, y: 0, width: 1400, height: 900 },
  });

  check(`${character}: zero page errors`, errors.length === 0, errors.slice(0, 4));
  await context.close();
  return { catalog, wheel, landings, effects, vow, presentation, heard, errors };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  const out = {};
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const character of Object.keys(EXPECTED)) {
      console.log(`\n=== ${character} ===`);
      out[character] = await auditOperative(browser, character);
    }
  } finally {
    await browser?.close();
    child.kill();
  }
  await writeFile(path.join(outDir, "commands.json"), JSON.stringify(out, null, 2));
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  console.log(`report: ${outDir}`);
  if (failed.length) {
    console.log("FAILED:", failed.map((c) => c.name).join(", "));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
