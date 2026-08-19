#!/usr/bin/env node
/* ============================================================
   SAINTFALL - does the Undercroft PLAY?

   The functional harness proves the second phase exists: the floor
   collapses, the clutch hatches, a lasher can be cut. None of that
   says whether the fight is any good, and a boss phase that is
   correct and unplayable ships as a defect.

   So this one fights it. A bot circles the Apostate at its build's
   own range, cuts a reared lasher when the fight offers one, and
   spends the unmoor window - which is the loop the phase is built
   around - across every difficulty tier and both weapon profiles.

   The five questions it answers, and why each is the one that
   catches a real failure:

     WINNABLE       does the pool actually come down, and in how long?
                    A second phase nobody can finish is worse than no
                    second phase.
     WHAT KILLS YOU damage attributed by source. If the tentacles are
                    doing the boss's job, or the brood is doing the
                    tentacles', the fight is not the fight it looks
                    like.
     THE LOOP       how much of the boss's health comes off inside an
                    unmoor window. The whole design claim is that
                    cutting limbs is how you get damage on the boss;
                    if the window carries a rounding error, the limbs
                    are decoration and the player will ignore them.
     DODGEABLE      lasher wind-ups against lasher connects, on a bot
                    that is moving. A telegraph nobody can beat is not
                    difficulty.
     CHEESE         a bot that parks outside the tentacles' reach and
                    shoots. This project has the note twice - the
                    Distaff shipped winnable from outside its own
                    threat range, and a perfect-aim rifle goes
                    untouchable on hard. If standing still at 30m
                    beats the fight, the arena is wrong.

   Usage:
     node scripts/saintfall-undercroft-probe.mjs [--tiers a,b] [--out dir]
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
    .map((p) => p.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true])
);
const outDir = path.resolve(root, args.out || "output/saintfall/undercroft-probe");
const TIERS = (args.tiers ? String(args.tiers).split(",") : ["pilgrim", "penitent", "martyr"]);
const BUILDS = ["rifle", "lance"];
const port = 55800 + (process.pid % 3000);
const base = `http://127.0.0.1:${port}`;
const results = [];
const checks = [];
let failed = 0;

function check(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

/* ------------------------------------------------------------
   THE BOT, page-side. Kept in one function so the whole fight runs
   inside a single evaluate and never pays a round trip per frame.
   ------------------------------------------------------------ */
function runFight({ build, seconds, cheese }) {
  const T = window.__SF;
  const U = T.undercroft;
  const cfg = U.config;
  const boss = T.apostate.instance();
  const state = T.undercroftState();

  T.equipWeapon(build === "lance" ? "glaive" : "autogun");
  T.autoStow(false);
  T.combat.player.hp = T.combat.player.maxHp;

  const hurt = {};
  let deaths = 0;
  const offHurt = T.combat.bus.on("playerHurt", (e) => {
    /* Keyed on WHO as well as WHAT. `enemy-fire` is the source string
       for the Apostate's own lance and for a Gleaner's spinneret
       alike, and reading the source alone says the brood is doing
       nine tenths of the damage in a fight where most of it is the
       boss shooting you. */
    const who = e.enemyKey || "";
    const k = who && who !== "undercroft" ? `${e.source}:${who}` : (e.source || "unknown");
    hurt[k] = (hurt[k] || 0) + (e.damage || 0);
  });
  const offDead = T.combat.bus.on("playerDied", () => { deaths += 1; });
  let windups = 0;
  let connects = 0;
  const offLash = U.bus.on("lash", (e) => {
    windups += 1;
    if (e && e.hit) connects += 1;
  });
  let windows = 0;
  const offUnmoor = U.bus.on("unmoored", () => { windows += 1; });

  const STAND = cheese ? 34 : (build === "lance" ? 3.4 : 14);
  /* THE WORLD'S CLOCK, NOT THE LOOP'S.

     `fireWeapon` and `aimAt` step the simulation themselves - two
     frames per shot and one per aim pass - so counting `dt` per
     iteration measured only the frames this loop stepped explicitly.
     The rifle profile calls both constantly and the lance calls
     neither, so the two builds were being run for very different
     amounts of world time under the same "200 seconds", with the
     rifle additionally standing still with a stale input vector
     through every step it did not know about. It measured as a build
     gap and it was an instrument gap. */
  const clock = () => T.ctx.atmos.elapsed;
  const t0 = clock();

  /* Held down rather than pulsed through `fireWeapon`, which is both
     how a player fires and the only way to do it without spending
     simulation inside the call. main.js's dispatch reads this flag
     every frame and applies the weapon's own cadence. */
  if (build !== "lance") T.player.input.state.firing = true;
  let hpInWindow = 0;
  let hpOutWindow = 0;
  let prevHp = boss.health;
  let elapsed = 0;
  let cuts = 0;
  const dt = 1 / 60;
  let swingTimer = 0;
  let aimTimer = 0;
  /* What the boss actually spends the fight doing. "The boss did no
     damage" is an observation; "the boss spent 71% of the fight
     walking" is a diagnosis. */
  const bossActions = {};
  let bossShots = 0;
  let distSum = 0;
  let distN = 0;

  while ((clock() - t0) < seconds && boss.health > 0) {
    const ps = T.player.state;
    const u = T.undercroftState();

    /* ---- pick a target: a reared limb inside reach beats the boss,
       because that is the loop the phase is asking for. ---- */
    let limb = null;
    if (!cheese) {
      let best = 1e9;
      for (const l of U.lashers) {
        if (l.mode === "cut" || l.rise < 0.6) continue;
        const n = l.nodes[8];
        const d = Math.hypot(n.x + cfg.x - ps.x, n.z + cfg.z - ps.z);
        if (d < best) { best = d; limb = { l, n, d }; }
      }
      if (limb && limb.d > 22) limb = null;
    }

    const tgtX = limb ? limb.n.x + cfg.x : boss.x;
    const tgtZ = limb ? limb.n.z + cfg.z : boss.z;
    const tgtY = limb ? limb.n.y + u.floorY : boss.y + 1.1;
    const want = limb ? (build === "lance" ? 2.6 : 11) : STAND;

    /* ---- move: hold the standoff and orbit ---- */
    const dx = ps.x - tgtX;
    const dz = ps.z - tgtZ;
    const d = Math.hypot(dx, dz) || 1e-4;
    const radial = (d - want) / Math.max(1, want);
    const orbit = ((Math.floor(elapsed / 4) % 2) ? 1 : -1);
    let mx = (-dx / d) * Math.max(-1, Math.min(1, radial)) + (-dz / d) * orbit * 0.85;
    let mz = (-dz / d) * Math.max(-1, Math.min(1, radial)) + (dx / d) * orbit * 0.85;
    const ml = Math.hypot(mx, mz) || 1;
    /* Injected in the player's own strafe frame: the input is camera
       relative, and the camera is pointed at the target. */
    const yaw = Math.atan2(tgtX - ps.x, tgtZ - ps.z);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const fwd = (mx / ml) * fx + (mz / ml) * fz;
    const str = (mx / ml) * fz - (mz / ml) * fx;
    T.player.input.inject(str, -fwd);

    /* ---- aim, rationed: `aimAt` steps the world itself ---- */
    aimTimer -= dt;
    if (aimTimer <= 0) {
      aimTimer = 0.2;
      T.aimAt(tgtX, tgtY, tgtZ, 1);
    }

    /* ---- attack ---- */
    swingTimer -= dt;
    if (build === "lance") {
      if (d < 4.6 && swingTimer <= 0) { T.meleeSwing(); swingTimer = 0.55; }
    }

    T.renderOnce(dt);
    const a = T.apostateState();
    const act = a.action || (a.airborne ? "airborne" : "idle/move");
    bossActions[act] = (bossActions[act] || 0) + 1;
    distSum += Math.hypot(boss.x - ps.x, boss.z - ps.z);
    distN += 1;
    elapsed = clock() - t0;

    const now = boss.health;
    const removed = Math.max(0, prevHp - now);
    if (removed > 0) {
      if (u.unmooredFor > 0) hpInWindow += removed; else hpOutWindow += removed;
    }
    prevHp = now;
    cuts = u.totalCuts;
    if (T.combat.player.dead) {
      /* Let the respawn resolve rather than counting the same death
         once per frame for three and a half seconds. */
      for (let i = 0; i < 60 * 5 && T.combat.player.dead; i += 1) {
        T.renderOnce(dt);
      }
      elapsed = clock() - t0;
      T.combat.player.hp = T.combat.player.maxHp;
    }
  }

  T.player.input.inject(null, null);
  T.player.input.state.firing = false;
  offHurt && offHurt();
  offDead && offDead();
  offLash && offLash();
  offUnmoor && offUnmoor();

  const total = Object.values(hurt).reduce((a, b) => a + b, 0);
  return {
    build, cheese: !!cheese,
    killed: boss.health <= 0,
    seconds: Number(elapsed.toFixed(1)),
    bossHp: Math.round(boss.health),
    bossMax: Math.round(boss.maxHealth),
    removedPct: Number(((1 - boss.health / boss.maxHealth) * 100).toFixed(1)),
    deaths,
    damageTaken: Number(total.toFixed(0)),
    bySource: Object.fromEntries(Object.entries(hurt)
      .map(([k, v]) => [k, Number(v.toFixed(0))])
      .sort((a, b) => b[1] - a[1])),
    cuts,
    windows,
    windupsSeen: windups,
    connects,
    hitRate: windups ? Number((connects / windups * 100).toFixed(1)) : 0,
    hpInWindow: Math.round(hpInWindow),
    hpOutWindow: Math.round(hpOutWindow),
    bossActionPct: Object.fromEntries(Object.entries(bossActions)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, Number((v / Math.max(1, distN) * 100).toFixed(0))])),
    meanRange: Number((distSum / Math.max(1, distN)).toFixed(1)),
    windowShare: (hpInWindow + hpOutWindow)
      ? Number((hpInWindow / (hpInWindow + hpOutWindow) * 100).toFixed(1)) : 0,
  };
}

try {
  await mkdir(outDir, { recursive: true });
  for (let i = 0; i < 300; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });

  for (const tier of TIERS) {
    for (const build of BUILDS) {
      const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
      await page.goto(
        `${base}/games/saintfall.html?boss=apostate&qa=1&quality=low&difficulty=${tier}`,
        { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
      const armed = await page.evaluate(() => {
        const T = window.__SF;
        T.maximize();
        document.getElementById("sf-boot")?.remove();
        T.advanceToApostatePhase("duel", 14, 1 / 60);
        T.combat.damageEnemy(T.apostate.instance(), 1e9, { source: "probe" });
        for (let i = 0; i < 60 * 18; i += 1) {
          T.renderOnce(1 / 60);
          if (T.undercroftState().phase === "live") break;
        }
        return T.undercroftState().phase;
      });
      if (armed !== "live") throw new Error(`${tier}/${build}: never reached the hive (${armed})`);
      const r = await page.evaluate(runFight, { build, seconds: 200, cheese: false });
      results.push({ tier, ...r });
      console.log(`${tier}/${build}: ${r.killed ? `killed in ${r.seconds}s` : `${r.removedPct}% in ${r.seconds}s`}`
        + ` | deaths ${r.deaths} | taken ${r.damageTaken}`
        + ` | cuts ${r.cuts} windows ${r.windows} windowShare ${r.windowShare}%`
        + ` | lash ${r.connects}/${r.windupsSeen} (${r.hitRate}%)`);
      console.log(`   by source: ${JSON.stringify(r.bySource)}`);
      await page.close();
    }
  }

  /* ---- the cheese run: park outside the tentacles and shoot ---- */
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.goto(`${base}/games/saintfall.html?boss=apostate&qa=1&quality=low&difficulty=martyr`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.advanceToApostatePhase("duel", 14, 1 / 60);
    T.combat.damageEnemy(T.apostate.instance(), 1e9, { source: "probe" });
    for (let i = 0; i < 60 * 18; i += 1) {
      T.renderOnce(1 / 60);
      if (T.undercroftState().phase === "live") break;
    }
  });
  const cheese = await page.evaluate(runFight, { build: "rifle", seconds: 150, cheese: true });
  results.push({ tier: "martyr", ...cheese });
  console.log(`\ncheese (martyr, rifle at 34m): ${cheese.killed ? "KILLED" : `${cheese.removedPct}%`}`
    + ` | taken ${cheese.damageTaken} | deaths ${cheese.deaths}`);
  console.log(`   by source: ${JSON.stringify(cheese.bySource)}`);
  console.log(`   boss did: ${JSON.stringify(cheese.bossActionPct)} at mean ${cheese.meanRange}m`);
  await page.close();

  /* ---------------- the gates ---------------- */
  const fights = results.filter((r) => !r.cheese);
  const martyrs = fights.filter((r) => r.tier === "martyr");
  check("every tier and build can put the second pool down",
    fights.every((r) => r.killed),
    fights.map((r) => `${r.tier}/${r.build}:${r.killed ? r.seconds + "s" : r.removedPct + "%"}`).join(" "));
  check("the fight is not a stalemate on the hardest tier",
    martyrs.every((r) => r.removedPct > 60),
    martyrs.map((r) => `${r.build}:${r.removedPct}%`).join(" "));
  check("the limbs are a mechanic, not decoration",
    fights.every((r) => r.cuts >= 2) && fights.some((r) => r.windows >= 1),
    fights.map((r) => `${r.tier}/${r.build}:${r.cuts}cuts/${r.windows}win`).join(" "));
  check("a moving trooper beats the lasher telegraph more often than not",
    fights.every((r) => r.windupsSeen === 0 || r.hitRate < 50),
    fights.map((r) => `${r.build}:${r.hitRate}%`).join(" "));
  /* Only asked of runs that took a meaningful beating. A bot that
     finishes on 391 damage and 0 deaths has a 90%-of-nothing top
     source, and judging a mix on totals that small measures rounding,
     not balance. */
  check("no single source is doing the whole fight's damage",
    fights.every((r) => {
      const vals = Object.values(r.bySource);
      const tot = vals.reduce((a, b) => a + b, 0);
      if (tot < 600) return true;
      return Math.max(...vals) / tot < 0.85;
    }),
    fights.map((r) => {
      const e = Object.entries(r.bySource);
      const tot = e.reduce((a, b) => a + b[1], 0) || 1;
      const top = e[0] || ["none", 0];
      return `${r.build}:${top[0]} ${(top[1] / tot * 100).toFixed(0)}%`;
    }).join(" "));
  check("parking outside the tentacles does not win the fight untouched",
    !(cheese.killed && cheese.damageTaken < 40),
    `${cheese.killed ? "killed" : cheese.removedPct + "%"} taking ${cheese.damageTaken}`);

  await writeFile(path.join(outDir, "report.json"),
    JSON.stringify({ results, checks, failed }, null, 2));
  console.log(`\n${checks.length - failed}/${checks.length} gates passed`);
  console.log(`Report: ${path.join(outDir, "report.json")}`);
  await browser.close();
} finally {
  server.kill();
}
process.exitCode = failed ? 1 : 0;
