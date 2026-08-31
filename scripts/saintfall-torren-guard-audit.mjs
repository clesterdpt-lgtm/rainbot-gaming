#!/usr/bin/env node
/* WHAT CAN TORREN ACTUALLY BLOCK?
 *
 * He is melee-only and carries a tower shield he never pays for, so
 * his defence has to answer for the reach he does not have. That is a
 * claim about every damage source in the game, not about the shield -
 * and the shield turned out to be fine. What was wrong was the
 * PAYLOADS.
 *
 * `normalizeGuardDetail` reads a payload's x/y/z as the attack's
 * ORIGIN, and infers UNBLOCKABLE when that origin sits on the player,
 * because a zero-distance origin has no direction and is therefore an
 * area effect. Most projectiles reported their IMPACT point - which is
 * on the player by definition of a direct hit - so a bolt Torren was
 * staring straight at was classed as an explosion and refused.
 *
 * This walks every source, fires it at a guarding Torren from the
 * front, and prints the verdict with the reason the rules gave. AoE is
 * expected to be unblockable; anything with a direction is not. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 47900 + (process.pid % 500);
const base = `http://127.0.0.1:${port}`;

/* Every payload shape the game actually sends, taken from the
   `hurtPlayer` call sites. `aoe: true` means it SHOULD be
   unblockable - a slam, a grab, a lingering field - and the audit
   asserts that too, so a future change that quietly makes an
   explosion guardable is caught the same way. */
const SOURCES = [
  // --- directional: must be blockable ---
  ["enemy-melee", false, (p) => ({ originX: p.x + 3, originY: p.y + 1, originZ: p.z, guardType: "frontal" })],
  ["enemy-fire", false, (p) => ({ x: p.x + 30, y: p.y + 1.5, z: p.z })],
  ["abbess-bite", false, (p) => ({ x: p.x, y: p.y + 1.2, z: p.z, originX: p.x + 4, originY: p.y + 1.4, originZ: p.z, guardType: "frontal" })],
  ["coulter-bite", false, (p) => ({ x: p.x + 4, y: p.y + 1.2, z: p.z, originX: p.x + 4, originY: p.y + 1.2, originZ: p.z, guardType: "frontal" })],
  ["distaff-bite", false, (p) => ({ x: p.x, y: p.y + 1, z: p.z, originX: p.x + 5, originY: p.y + 1, originZ: p.z, guardType: "frontal" })],
  ["winnower-sweep", false, (p) => ({ x: p.x, y: p.y + 1, z: p.z, originX: p.x + 6, originY: p.y + 2, originZ: p.z, guardType: "frontal" })],
  ["winnower-strafe", false, (p) => ({ x: p.x, y: p.y + 1, z: p.z, originX: p.x + 8, originY: p.y + 4, originZ: p.z, guardType: "frontal" })],
  ["stylite-bolt", false, (p) => ({ x: p.x, y: p.y + 1, z: p.z, originX: p.x + 6, originY: p.y + 5, originZ: p.z, guardType: "frontal" })],
  ["distaff-web", false, (p) => ({ x: p.x, y: p.y + 1, z: p.z, originX: p.x + 6, originY: p.y + 1, originZ: p.z, guardType: "frontal" })],
  ["garner-shard", false, (p) => ({ x: p.x, y: p.y + 1, z: p.z, originX: p.x + 6, originY: p.y + 2, originZ: p.z, guardType: "frontal" })],
  ["venom-globule", false, (p) => ({ x: p.x, y: p.y + 1, z: p.z, originX: p.x + 6, originY: p.y + 2, originZ: p.z, guardType: "frontal" })],
  ["coulter-breach", false, (p) => ({ x: p.x + 5, y: p.y + 1.5, z: p.z })],
  // --- area effects: must NOT be blockable ---
  ["abbess-slam", true, (p) => ({ x: p.x, y: p.y + 1, z: p.z })],
  ["distaff-slam", true, (p) => ({ x: p.x, y: p.y + 1, z: p.z, guardType: "unblockable" })],
  ["garner-seize", true, (p) => ({ x: p.x, y: p.y + 1, z: p.z, guardType: "unblockable" })],
  ["garner-devour", true, (p) => ({ x: p.x, y: p.y + 1, z: p.z, guardType: "unblockable" })],
  ["matriarch-tremor", true, (p) => ({ x: p.x, y: p.y + 1, z: p.z, guardType: "unblockable" })],
  ["stylite-stoop", true, (p) => ({ x: p.x, y: p.y + 1, z: p.z, guardType: "unblockable" })],
  ["stylite-crash", true, (p) => ({ x: p.x, y: p.y + 1, z: p.z, guardType: "unblockable" })],
  ["winnower-ash", true, (p) => ({ x: p.x, y: p.y + 1, z: p.z })],
  ["venom", true, (p) => ({ x: p.x, y: p.y + 1, z: p.z })],
  ["explosion", true, (p) => ({ x: p.x, y: p.y + 1, z: p.z })],
];

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
      `${base}/games/saintfall.html?qa=1&intro=0&quality=low&character=bastion-penitent`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

    await page.evaluate((src) => {
      window.__MAKE = {};
      for (const [name, body] of src) window.__MAKE[name] = eval(body);
    }, SOURCES.map(([name, , fn]) => [name, fn.toString()]));

    const rows = await page.evaluate(async ({ sources }) => {
      const T = window.__SF;
      T.clearEnemies();
      T.advanceTime(0.8, 1 / 60);
      /* Shield UP, and held up: the guard is driven through the input
         the kit reads, not by setting its flag. */
      T.player.input.setTouchHold("block", true);
      T.advanceTime(0.6, 1 / 60);
      const guardUp = T.shield.status().active;

      const out = [];
      for (const [source, aoe] of sources) {
        const ps = T.player.state;
        /* Everything is thrown from straight ahead, so an unblocked
           result is never merely a bad angle. */
        const detail = window.__MAKE[source](
          { x: ps.x + Math.sin(ps.yaw) * 0, y: ps.y, z: ps.z, yaw: ps.yaw });
        /* Rebuild the origin ahead of the body's actual facing. */
        const fx = Math.sin(ps.yaw);
        const fz = Math.cos(ps.yaw);
        if (Number.isFinite(detail.originX)) {
          const r = Math.hypot(detail.originX - ps.x, detail.originZ - ps.z) || 6;
          detail.originX = ps.x + fx * r;
          detail.originZ = ps.z + fz * r;
        } else if (Number.isFinite(detail.x)
          && Math.hypot(detail.x - ps.x, detail.z - ps.z) > 0.5) {
          const r = Math.hypot(detail.x - ps.x, detail.z - ps.z);
          detail.x = ps.x + fx * r;
          detail.z = ps.z + fz * r;
        }
        detail.source = source;
        T.combat.player.hp = T.combat.player.maxHp;
        const before = T.combat.player.hp;
        T.combat.hurtPlayer(40, detail);
        const attempt = T.shield.lastAttempt?.() || {};
        out.push({
          source, aoe,
          blocked: !!attempt.ok,
          reason: attempt.reason || "n/a",
          guardType: attempt.guardType || null,
          took: Number((before - T.combat.player.hp).toFixed(1)),
        });
        T.advanceTime(0.05, 1 / 60);
      }
      T.player.input.setTouchHold("block", false);
      return { guardUp, out };
    }, { sources: SOURCES.map(([s, aoe]) => [s, aoe]) });

    check("the tower shield is up", rows.guardUp === true);
    console.log("\n  source                 aoe   blocked  reason");
    for (const r of rows.out) {
      console.log(`  ${r.source.padEnd(22)} ${r.aoe ? "yes" : " no"}    `
        + `${String(r.blocked).padEnd(7)}  ${r.reason}`);
    }
    const shouldBlock = rows.out.filter((r) => !r.aoe && !r.blocked);
    const shouldNot = rows.out.filter((r) => r.aoe && r.blocked);
    check("every directional attack is blockable from the front",
      shouldBlock.length === 0,
      shouldBlock.map((r) => ({ source: r.source, reason: r.reason })));
    check("every area effect stays unblockable",
      shouldNot.length === 0, shouldNot.map((r) => r.source));
    /* ============================================================
       AND THE REPORTED CASE, END TO END.
       Everything above proves the RULES handle the right payload
       shapes. This proves the Stylite actually sends one: a real
       volley, from the real boss, at a guarding Torren. It is the
       bolt that was reported unblockable. */
    const live = await page.evaluate(async () => {
      const T = window.__SF;
      if (!T.styliteState?.()) return { skipped: "no stylite on this page" };
      T.teleportToStylite?.(20);
      /* LAND FIRST. The guard is refused while airborne, and a
         teleport drops the body - raising the shield in the same
         breath measures a refusal that has nothing to do with the
         payload. */
      T.advanceTime(2.0, 1 / 60);
      T.invulnerable(false);
      T.combat.player.hp = T.combat.player.maxHp;
      /* Face the boss, or a block is refused on ANGLE and says
         nothing about the payload either. */
      const st = T.styliteState();
      T.setBodyHeading?.(Math.atan2(st.x - T.player.state.x, st.z - T.player.state.z));
      T.advanceTime(0.4, 1 / 60);
      T.player.input.setTouchHold("block", true);
      T.advanceTime(0.6, 1 / 60);
      /* `perched` IS the firing state - there is no "volley" phase,
         the volley runs on its own cadence while it sits. */
      /* HELD perched for the whole window. Left alone it stoops, and
         the stoop stuns - which drops the guard, so every bolt after
         it arrives at a shield that is down and the test measures the
         stun instead of the payload. */
      const seen = [];
      const stop = T.combat.bus.on("playerHurt", (e) => seen.push(e.source));
      const blocks0 = T.shield.status().blocks;
      /* Each bolt is judged at the moment it lands: was the shield up,
         and what did the rules say about it? */
      const verdicts = [];
      const stop2 = T.shield.bus?.on?.("block", (e) => verdicts.push(e));
      for (let i = 0; i < 40; i += 1) {
        T.forceStylitePhase?.("perched", 30);
        T.player.input.setTouchHold("block", true);
        T.advanceTime(0.4, 1 / 60);
        const a2 = T.shield.lastAttempt?.() || {};
        if (a2.reason && a2.reason !== "inactive") {
          verdicts.push({ ok: a2.ok, reason: a2.reason, guardType: a2.guardType });
        }
      }
      stop?.();
      stop2?.();
      const attempt = verdicts.length ? verdicts[verdicts.length - 1]
        : (T.shield.lastAttempt?.() || {});
      T.player.input.setTouchHold("block", false);
      return {
        guarding: T.shield.status().active,
        blocks: T.shield.status().blocks - blocks0,
        lastReason: attempt.reason || null,
        lastGuardType: attempt.guardType || null,
        boltVerdicts: verdicts.filter((v) => v.guardType === "frontal").length,
        hurtBy: Array.from(new Set(seen)),
      };
    });
    if (live.skipped) {
      console.log(`  (live Stylite check skipped: ${live.skipped})`);
    } else {
      console.log(`  live Stylite volley: ${live.blocks} block(s),`
        + ` last attempt ${live.lastGuardType}/${live.lastReason},`
        + ` got through: [${live.hurtBy.join(",")}]`);
      check("a real Stylite bolt is blocked by a guarding Torren",
        live.blocks > 0 && live.boltVerdicts > 0, live);
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
