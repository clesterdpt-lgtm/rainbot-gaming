#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Martyr Winnower pass probe

   Three complaints from play, and none of them is a screenshot:

     1. the bombs barely hurt,
     2. downing it makes the animal SKIP to somewhere else,
     3. it flies through the Censer Works instead of around it.

   Each becomes a number here.

   BOMBS. The coals only ever damaged on a DIRECT hit - a 1.8m
   cylinder around the player's chest - so a bomb landing at their
   feet did nothing at all on impact and left a burn behind. The
   measurement is therefore not "does the volley hurt" but "how much
   of a volley aimed at a stationary player lands", attributed off
   the `playerHurt` bus by source, because ember, strafe and ash all
   arrive during the same window and a raw HP delta cannot separate
   them - nor separate any of them from a garrison.

   DOWNING. Sampled as the per-frame world step of the body through
   the landing. A descent is continuous; a teleport is one frame that
   moves further than its neighbours, so it is scored the same way
   the leg rig's is - excess over the neighbouring steps, not raw
   magnitude, because a stall is genuinely fast.

   MASONRY. `collide.flightBlocked` is the game's own answer to "is
   this capsule inside something", and it is the one the flyer never
   asked. Sampled every frame across a full airborne cycle, with the
   worst overlap depth kept, because a boss clipping one cornice for
   one frame and a boss cruising through a cracking tower are the
   same boolean and very different bugs.

   Usage: node scripts/saintfall-winnower-pass-probe.mjs [--out FILE]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const outFile = path.resolve(root, outArg >= 0
  ? process.argv[outArg + 1]
  : "output/saintfall/winnower-pass-probe.json");
const PORT = 47100 + (process.pid % 800);
const BASE = `http://127.0.0.1:${PORT}`;

/* A volley aimed at someone who does not move should be punishing.
   Below this it is scenery. */
const VOLLEY_MIN = 55;
/* One frame of the landing may not exceed twice its neighbours by
   more than this. The stall descent itself is fast and legal. */
const STEP_JUMP_LIMIT = 0.5;
/* Frames of the airborne cycle the body may spend inside masonry. */
const CLIP_PCT_LIMIT = 1.0;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({ viewport: { width: 960, height: 600 } })).newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=low`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

    const res = await page.evaluate(async () => {
      const T = window.__SF;
      const ctx = T.ctx;
      const win = ctx.winnower;
      const out = { tiers: {}, landing: null, masonry: null };

      /* Damage is attributed off the bus, never off raw HP: the
         Censer garrison fires during the same window and reports
         `enemy-fire`, which a health delta cannot tell from a coal. */
      const tally = {};
      ctx.combat.bus.on("playerHurt", (e) => {
        if (!String(e.source || "").startsWith("winnower")) return;
        tally[e.source] = (tally[e.source] || 0) + e.damage;
      });
      const resetTally = () => { for (const k of Object.keys(tally)) delete tally[k]; };

      /* Where the coals actually landed. Zero damage from a volley
         aimed at a stationary player is either the finding or a
         broken harness, and only the impact points tell them apart. */
      let ashDrops = [];
      win.bus.on("ash", (e) => ashDrops.push({ x: e.x, z: e.z, radius: e.radius }));
      let throws = [];
      win.bus.on("emberThrow", (e) => throws.push({
        o: [Number(e.ox.toFixed(1)), Number(e.oy.toFixed(1)), Number(e.oz.toFixed(1))],
        t: [Number(e.tx.toFixed(1)), Number(e.ty.toFixed(1)), Number(e.tz.toFixed(1))],
        v: [Number(e.vx.toFixed(1)), Number(e.vy.toFixed(1)), Number(e.vz.toFixed(1))],
        wantM: Number(Math.hypot(e.tx - e.ox, e.tz - e.oz).toFixed(1)),
      }));
      let throwAt = null;
      win.bus.on("bombard", (e) => {
        const ps = ctx.player.state;
        throwAt = {
          boss: [Number(e.x.toFixed(1)), Number(e.y.toFixed(1)), Number(e.z.toFixed(1))],
          player: [Number(ps.x.toFixed(1)), Number(ps.y.toFixed(1)), Number(ps.z.toFixed(1))],
          flatM: Number(Math.hypot(e.x - ps.x, e.z - ps.z).toFixed(1)),
          dropM: Number((e.y - ps.y).toFixed(1)),
          count: e.count,
        };
      });

      const park = () => {
        /* Beside the works, on open ground, and NOT under a free
           camera - a detached camera makes `hurtPlayer` return 0 for
           the rest of the run and every number below would be zero. */
        T.releaseCamera();
        /* NOT `clearEnemies()`. It empties the roster the enemies
           module iterates, and that loop is what copies `inst.x/y/z`
           onto the rig - so the module keeps simulating a boss whose
           SKELETON stops moving, and every bone-sourced position
           (the censers throw from one) goes stale by however far the
           animal has flown since. It cost an afternoon: the coals
           appeared to be aimed fifty metres behind the animal. */
        win.ensureSpawned();
        const inst = win.instance();
        T.teleport(inst.x + 26, inst.z + 26, 0);
        ctx.combat.player.hp = ctx.combat.player.maxHp;
        ctx.combat.player.dead = false;
        /* REFILL THE LIFT POOL. `stepSoar` stalls the moment it is
           empty, so a probe that drained it in an earlier case gets a
           boss that lands again on the first frame of every forced
           soar - which is how the masonry sample came back with 3600
           frames of "land" and nothing else. */
        inst.lift = inst.spec?.liftPool ?? 4;
        return inst;
      };

      /* ---- 1. WHAT A VOLLEY LANDS, per difficulty tier ---- */
      for (const tier of ["pilgrim", "penitent", "martyr"]) {
        T.setDifficultyForQA(tier);
        const inst = park();
        win.forcePhase("soar", 40);
        for (let i = 0; i < 30; i += 1) T.advanceTime(1 / 60, 1 / 60);
        resetTally();
        ctx.combat.player.hp = ctx.combat.player.maxHp;
        const primed = win.primeBombard();
        const phaseSeen = {};
        let emberPeak = 0;
        let inAshFrames = 0;
        ashDrops = [];
        throwAt = null;
        throws = [];
        /* Long enough for the throw, the arc, the impact and one
           full ash tick, but short of a second volley. */
        for (let i = 0; i < 260; i += 1) {
          T.advanceTime(1 / 60, 1 / 60);
          /* EVERY FRAME. The encounter's own reveal camera detaches
             the player, and `hurtPlayer` returns 0 outright while it
             is detached - so the FIRST tier measured, and only the
             first, scored a flat zero for a volley that visibly
             landed a metre away. */
          T.releaseCamera();
          ctx.combat.player.dead = false;
          const st = win.status();
          phaseSeen[st.phase] = (phaseSeen[st.phase] || 0) + 1;
          if (st.embers > emberPeak) emberPeak = st.embers;
          if (win.inAsh()) inAshFrames += 1;
          if (ctx.combat.player.hp < ctx.combat.player.maxHp * 0.15) {
            ctx.combat.player.hp = ctx.combat.player.maxHp;
          }
        }
        out.tiers[tier] = {
          ember: Number((tally["winnower-ember"] || 0).toFixed(1)),
          ash: Number((tally["winnower-ash"] || 0).toFixed(1)),
          strafe: Number((tally["winnower-strafe"] || 0).toFixed(1)),
          total: Number(Object.values(tally).reduce((a, b) => a + b, 0).toFixed(1)),
          maxHp: ctx.combat.player.maxHp,
          primed,
          emberPeak,
          phaseSeen,
          inAshFrames,
          throwAt,
          throws,
          ashDrops: ashDrops.length,
          /* Roof or sand? `spillAsh` always beds the field on the
             GROUND, so the ash position alone cannot say whether the
             coal was stopped by a building on the way. */
          ashOnRoof: ashDrops.map((a) => {
            const top = ctx.collide.solidTop(a.x, a.z);
            const gnd = ctx.collide.groundHeight(a.x, a.z);
            return Number.isFinite(top) ? Number((top - gnd).toFixed(1)) : 0;
          }),
          ashFromBossM: ashDrops.map((a) => Number(Math.hypot(
            a.x - (throwAt ? throwAt.boss[0] : 0),
            a.z - (throwAt ? throwAt.boss[2] : 0)
          ).toFixed(1))).sort((x, y) => x - y),
          ashDistM: ashDrops.map((a) => Number(Math.hypot(
            a.x - ctx.player.state.x, a.z - ctx.player.state.z
          ).toFixed(1))).sort((x, y) => x - y),
          distM: Number(Math.hypot(
            inst.x - ctx.player.state.x, inst.z - ctx.player.state.z
          ).toFixed(1)),
        };
      }
      T.setDifficultyForQA("penitent");

      /* ---- 2. DOWNING CONTINUITY ---- */
      {
        const inst = park();
        win.forcePhase("soar", 40);
        for (let i = 0; i < 40; i += 1) T.advanceTime(1 / 60, 1 / 60);
        /* Empty the lift pool the way a rifle build does, so the
           landing that follows is a STALL - the reported case. */
        inst.lift = 0;
        const steps = [];
        let prev = { x: inst.x, y: inst.y, z: inst.z };
        let sawLand = false;
        for (let i = 0; i < 260; i += 1) {
          T.advanceTime(1 / 60, 1 / 60);
          const s = win.status();
          if (s.phase === "land") sawLand = true;
          steps.push({
            t: Number((i / 60).toFixed(3)),
            phase: s.phase,
            d: Math.hypot(inst.x - prev.x, inst.y - prev.y, inst.z - prev.z),
            x: inst.x, y: inst.y, z: inst.z,
          });
          prev = { x: inst.x, y: inst.y, z: inst.z };
          if (s.phase === "stoke") break;
        }
        let worst = 0;
        let at = null;
        for (let n = 1; n < steps.length - 1; n += 1) {
          const excess = steps[n].d
            - 2 * Math.max(steps[n - 1].d, steps[n + 1].d);
          if (excess > worst) {
            worst = excess;
            at = {
              t: steps[n].t,
              phase: steps[n].phase,
              stepM: Number(steps[n].d.toFixed(3)),
              neighbourM: Number(
                Math.max(steps[n - 1].d, steps[n + 1].d).toFixed(3)
              ),
            };
          }
        }
        out.landing = {
          sawLand,
          frames: steps.length,
          maxStepM: Number(steps.reduce((m, s) => Math.max(m, s.d), 0).toFixed(3)),
          jumpM: Number(worst.toFixed(3)),
          worstAt: at,
        };
      }

      /* ---- 3. MASONRY CLEARANCE across an airborne cycle ---- */
      {
        const inst = park();
        win.forcePhase("soar", 90);
        /* The BODY, not the span: the bestiary radius is sized to the
           thorax for exactly this reason, and the animal hangs below
           its own origin (the gut sits at -1.85 in model space). */
        const R = 4.5;
        const BODY_LOW = -2.2;
        const BODY_HEIGHT = 4.4;
        let frames = 0;
        let clipped = 0;
        let worstDepth = 0;
        let worstAt = null;
        const phases = {};
        /* CLEARING A BUILDING MUST NOT LOOK LIKE A HICCUP. Lifting the
           body over masonry is only an improvement if the lift is
           flown; a hard floor that catches it reads as the animal
           being shoved. Scored as isolated steps in ALTITUDE, the
           same way the landing is. */
        const alt = [];
        for (let i = 0; i < 3600; i += 1) {
          T.advanceTime(1 / 60, 1 / 60);
          ctx.combat.player.hp = ctx.combat.player.maxHp;
          ctx.combat.player.dead = false;
          const s = win.status();
          phases[s.phase] = (phases[s.phase] || 0) + 1;
          if (s.phase !== "soar" && s.phase !== "strafe" && s.phase !== "bracket") {
            inst.lift = inst.spec?.liftPool ?? 4;
            /* Only the AIRBORNE cycle is under test; a grounded body
               overlapping the ground it is standing on is not a
               clipped building. Kept flying rather than skipped so
               the sample covers a real patrol. */
            win.forcePhase("soar", 90);
            continue;
          }
          frames += 1;
          alt.push(inst.y);
          const feet = inst.y + BODY_LOW;
          /* MASONRY ONLY. `flightBlocked` also answers for terrain,
             and the strafing pass deliberately skims it - counting
             those frames measured the dip, not the district. */
          const blocked = ctx.collide.flightBlocked(
            inst.x, inst.z, feet, R, BODY_HEIGHT, true
          );
          if (blocked) {
            clipped += 1;
            /* How far INSIDE, so a clipped cornice and a cruise
               through a tower are different numbers. */
            const top = ctx.collide.solidTop(inst.x, inst.z);
            const depth = Number.isFinite(top) ? top - feet : 0;
            if (depth > worstDepth) {
              worstDepth = depth;
              worstAt = {
                phase: s.phase,
                x: Number(inst.x.toFixed(1)),
                y: Number(inst.y.toFixed(1)),
                z: Number(inst.z.toFixed(1)),
                solidTop: Number(top.toFixed(1)),
              };
            }
          }
        }
        let altJump = 0;
        let altAt = null;
        for (let n = 2; n < alt.length - 1; n += 1) {
          const d0 = Math.abs(alt[n - 1] - alt[n - 2]);
          const d1 = Math.abs(alt[n] - alt[n - 1]);
          const d2 = Math.abs(alt[n + 1] - alt[n]);
          const excess = d1 - 2 * Math.max(d0, d2);
          if (excess > altJump) {
            altJump = excess;
            altAt = { y: Number(alt[n].toFixed(1)), stepM: Number(d1.toFixed(3)) };
          }
        }
        out.masonry = {
          altJumpM: Number(altJump.toFixed(3)),
          altJumpAt: altAt,
          maxClimbPerFrameM: Number(alt.reduce((m, v, i) => (
            i ? Math.max(m, Math.abs(v - alt[i - 1])) : 0
          ), 0).toFixed(3)),
          frames,
          clippedFrames: clipped,
          clippedPct: Number((100 * clipped / Math.max(1, frames)).toFixed(2)),
          worstDepthM: Number(worstDepth.toFixed(2)),
          worstAt,
          phases,
        };
      }
      return out;
    });

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(res, null, 2));

    let fails = 0;
    console.log("\nSAINTFALL Winnower pass\n" + "=".repeat(78));
    console.log("\n1. WHAT ONE BOMBARDMENT LANDS ON A STATIONARY PLAYER");
    console.log("tier".padEnd(10) + "ember".padStart(8) + "ash".padStart(8)
      + "strafe".padStart(8) + "total".padStart(8) + "  % of a full bar");
    for (const [tier, v] of Object.entries(res.tiers)) {
      const pct = (100 * v.total / Math.max(1, v.maxHp)).toFixed(0);
      const bad = v.total < VOLLEY_MIN;
      if (bad) fails += 1;
      console.log(tier.padEnd(10) + `${v.ember}`.padStart(8) + `${v.ash}`.padStart(8)
        + `${v.strafe}`.padStart(8) + `${v.total}`.padStart(8)
        + `  ${pct}%` + (bad ? `   FAIL under ${VOLLEY_MIN}` : ""));
    }

    console.log("\n2. DOWNING CONTINUITY (stall landing)");
    const L = res.landing;
    const landBad = !L.sawLand || L.jumpM > STEP_JUMP_LIMIT;
    if (landBad) fails += 1;
    console.log(`  reached land phase: ${L.sawLand}   frames ${L.frames}`);
    console.log(`  max step ${L.maxStepM}m/frame   isolated jump ${L.jumpM}m`
      + (landBad ? `   FAIL over ${STEP_JUMP_LIMIT}m` : "   ok"));
    if (L.worstAt) console.log(`  worst: ${JSON.stringify(L.worstAt)}`);

    console.log("\n3. MASONRY CLEARANCE (airborne cycle)");
    const M = res.masonry;
    const clipBad = M.clippedPct > CLIP_PCT_LIMIT;
    if (clipBad) fails += 1;
    console.log(`  ${M.clippedFrames}/${M.frames} frames inside masonry `
      + `= ${M.clippedPct}%   worst depth ${M.worstDepthM}m`
      + (clipBad ? `   FAIL over ${CLIP_PCT_LIMIT}%` : "   ok"));
    if (M.worstAt) console.log(`  worst: ${JSON.stringify(M.worstAt)}`);
    console.log(`  altitude: max ${M.maxClimbPerFrameM}m/frame, `
      + `isolated jump ${M.altJumpM}m`
      + (M.altJumpM > 0.35 ? "   FAIL - the lift pops" : "   ok"));
    if (M.altJumpM > 0.35) fails += 1;
    console.log(`  phases sampled: ${JSON.stringify(M.phases)}`);

    console.log("\n" + "=".repeat(78));
    console.log(fails ? `${fails} area(s) FAIL` : "all areas pass");
    console.log(`wrote ${path.relative(root, outFile)}`);
    process.exitCode = fails ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
