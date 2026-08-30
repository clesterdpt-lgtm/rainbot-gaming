#!/usr/bin/env node
/* BRINGING THE WINNOWER DOWN WITH A THROWN HAMMER.

   Reported from play: the cast downed the boss instantly and it went
   straight back into the air. The cause was that `groundFlyer` called
   `ctx.winnower.forcePhase("stoke")` with NO timer, and `forcePhase`
   only sets `state.timer` when it is given one - so the forced stoke
   inherited whatever fraction of a second the interrupted soar had
   left. `beginStoke()` sets 5.5; the forced path set nothing.

   Restoring the timer alone would have fixed the flicker and left a
   worse problem: one throw, on one cooldown, opening a boss window the
   fight otherwise makes you earn. So a boss with a LIFT POOL is now
   brought down by draining it, through the stall path the encounter
   already owns.

   This measures the whole claim: one cast does not down it, three do,
   the landing that results is the long STALLED one, trash flyers still
   drop in a single blow, and the encounter's own 18% damage cap still
   holds so the cast cannot burst a boss down. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 47800 + (process.pid % 600);
const base = `http://127.0.0.1:${port}`;

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}
async function waitServer() {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};

async function main() {
  const child = server();
  let browser;
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 140)));
    await page.goto(
      `${base}/games/saintfall.html?qa=1&intro=0&quality=low&character=bastion-penitent&boss=winnower`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

    const data = await page.evaluate(async () => {
      const T = window.__SF;
      T.invulnerable(true);
      const w0 = T.summitless === undefined ? T.winnowerState?.() : null;
      if (!T.winnowerState?.()) return { error: "no winnower on this page" };

      T.teleportToWinnower(26);
      T.advanceTime(0.5, 1 / 60);
      T.forceWinnowerPhase("soar", 20);
      T.advanceTime(1.0, 1 / 60);
      const inst = T.enemies.live.find((e) => e.key === "winnower");
      if (!inst) return { error: "winnower not live" };

      const st = () => T.winnowerState();
      const shot = () => ({
        phase: st().phase, lift: Number((inst.lift ?? 0).toFixed(2)),
        grounded: !!inst.grounded,
      });

      /* Full pool, airborne. */
      inst.lift = inst.maxLift;
      const before = shot();

      /* --- ONE BLOW --- */
      const one = T.combat.groundFlyer(inst, { stun: 3 });
      T.advanceTime(0.5, 1 / 60);
      const afterOne = shot();
      /* Still up two seconds later? (the reported bug was an instant
         drop-and-relaunch, so this is where that showed) */
      T.advanceTime(2.0, 1 / 60);
      const settledOne = shot();

      /* --- THREE --- */
      T.combat.groundFlyer(inst, { stun: 3 });
      T.advanceTime(0.3, 1 / 60);
      const afterTwo = shot();
      T.combat.groundFlyer(inst, { stun: 3 });
      T.advanceTime(0.4, 1 / 60);
      const afterThree = shot();
      /* An emptied pool sends it into `land` FIRST - the descent - and
         only then into `stoke`, which is the window that matters. The
         first cut of this probe sampled 0.8s in, caught the boss still
         flying down, and read the land timer as the window. */
      const reached = T.advanceToWinnowerPhase("stoke", 12);
      const downed = shot();
      const stalled = st().stalled ?? null;
      const downWindow = st().timer ?? null;

      /* The damage cap the encounter already owns. */
      const capped = st().downDamageCap ?? null;

      /* --- TRASH STILL DROPS IN ONE --- */
      const ps = T.player.state;
      const tx = ps.x + Math.sin(ps.camYaw) * 18;
      const tz = ps.z + Math.cos(ps.camYaw) * 18;
      T.spawnEnemy("thresher", tx, tz, {});
      let trash = null;
      let best = 6;
      for (const e of T.enemies.live) {
        const d = Math.hypot(e.x - tx, e.z - tz);
        if (e.key === "thresher" && d < best) { best = d; trash = e; }
      }
      let trashDown = null;
      if (trash) {
        trash.spec = { ...trash.spec, flies: true };
        trash.grounded = false;
        trash.y += 8;
        trash.health = 4000;
        const ok = T.combat.groundFlyer(trash, { stun: 2 });
        T.advanceTime(0.2, 1 / 60);
        trashDown = { accepted: ok, grounded: !!trash.grounded };
      }

      return {
        before, one, afterOne, settledOne, afterTwo, afterThree,
        reached, downed, stalled, downWindow, capped, trashDown,
        maxLift: inst.maxLift,
      };
    });

    if (data.error) {
      check("winnower reachable", false, data);
    } else {
      console.log(`  lift ${data.maxLift} -> ${data.afterOne.lift}`
        + ` -> ${data.afterTwo.lift} -> ${data.afterThree.lift}`
        + `   phase ${data.before.phase} -> ${data.afterThree.phase}`);
      check("one cast drains lift but does NOT down the boss",
        data.one === true && data.afterOne.lift < data.before.lift
        && data.afterOne.grounded === false, { before: data.before, afterOne: data.afterOne });
      /* The reported bug, stated as a check: it must not drop and pop
         back up. Two seconds after a single blow it is still flying. */
      check("a single cast never drops it and relaunches",
        data.settledOne.grounded === false
        && (data.settledOne.phase === "soar" || data.settledOne.phase === "strafe"),
        data.settledOne);
      check("three casts empty the pool and bring it down",
        data.afterThree.lift <= 0 && data.reached >= 0
        && data.downed.grounded === true && data.downed.phase === "stoke",
        { afterThree: data.afterThree, reachedStokeIn: data.reached, downed: data.downed });
      /* 5.5s is a landing it chose; 7.5 is the one the player earned.
         The whole point of routing through lift is that the cast buys
         the SECOND one. */
      check("the landing it earns is the long STALLED one",
        data.stalled === true && data.downWindow > 5.5,
        { stalled: data.stalled, window: data.downWindow });
      check("the encounter's own downing damage cap still applies",
        data.capped > 0 && data.capped <= 0.25, { downDamageCap: data.capped });
      check("a trash flyer still drops in a single blow",
        data.trashDown && data.trashDown.accepted === true
        && data.trashDown.grounded === true, data.trashDown);
    }
    check("zero page errors", errors.length === 0, errors.slice(0, 2));
    await context.close();
  } finally {
    await browser?.close();
    child.kill();
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
