#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Matriarch, measured as a THREAT

   `saintfall-matriarch-fight.mjs` proves the encounter is wired up:
   the weak point is behind, the brood caps, the moveset fires. It
   cannot answer the only question a player actually asks, which is
   whether any of it can reach them.

   THE COMPLAINT THIS EXISTS TO MEASURE

   "Too easy to avoid." The animal walked at 2.55 m/s. A trooper
   moves at 8.6 hipfiring and 3.96 down the sights, so a player who
   never stopped aiming still opened ground on it, and one who let go
   of the right button left at more than three times its pace. Past
   23m its only gap-closer switched off entirely, so standing off and
   plinking was not a strategy that beat the boss - it was a range at
   which the boss stopped being one.

   WHAT IS MEASURED, per scenario: what fraction of the run the player
   spent inside scythe reach, how much of the boss's moveset connected,
   and - the one that matters for a kite - the NET CLOSURE RATE, in
   metres a second, of an animal chasing a player who is moving away
   from it at a speed a person can hold while shooting.

   The player is driven, not simulated: each tick they are placed at a
   fixed speed along the scenario's policy, so the numbers compare
   across runs instead of across bot moods. Damage is summed from
   per-tick health DROPS rather than a floor, so passive regen between
   hits cannot flatter the result.

   Usage:  node scripts/saintfall-matriarch-pressure.mjs
           node scripts/saintfall-matriarch-pressure.mjs --json out.json
           node scripts/saintfall-matriarch-pressure.mjs --seconds 30
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/matriarch");
const PORT = 49937;
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SECONDS = Number(argOf("--seconds", "26"));
const JSON_OUT = argOf("--json", null);

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const findings = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) findings.push(label);
};

try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE}/games/saintfall.html`); if (r.ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&difficulty=penitent`,
    { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await mkdir(OUT, { recursive: true });
  await page.evaluate(() => {
    window.__SF.maximize();
    window.__SF.hideHud(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  const cfg = await page.evaluate(() => {
    const c = window.__SF.ctx.matriarch.config;
    return {
      walkSpeed: c.walkSpeed, backSpeed: c.backSpeed, strafeSpeed: c.strafeSpeed,
      chaseSpeed: c.chaseSpeed ?? null, chaseFrom: c.chaseFrom ?? null,
      lanceDashMax: c.lanceDashMax ?? c.lanceDash,
      turnRate: c.turnRate, holdBand: c.holdBand,
      comboReach: c.comboReach, comboCadence: c.comboCadence,
      lanceRange: c.lanceRange, lanceCadence: c.lanceCadence,
      cullCadence: c.cullCadence, cullLoiter: c.cullLoiter,
      rouseSpeedScale: c.rouseSpeedScale,
    };
  });
  console.log("=== THE ANIMAL AS TUNED ===");
  console.log(`  stalk ${cfg.walkSpeed} m/s · back ${cfg.backSpeed} · strafe ${cfg.strafeSpeed}`
    + `${cfg.chaseSpeed ? ` · chase ${cfg.chaseSpeed} from ${cfg.chaseFrom}m` : " · no chase gear"}`);
  console.log(`  turn ${cfg.turnRate} rad/s · band ${cfg.holdBand.join("-")}m`);
  console.log(`  combo ${cfg.comboReach}m every ${cfg.comboCadence}s`
    + ` · lance ${cfg.lanceRange.join("-")}m every ${cfg.lanceCadence}s`
    + ` · cull every ${cfg.cullCadence}s after ${cfg.cullLoiter}s`);
  console.log(`  player: WALK 4.4 · SPRINT 8.6 · sighted 3.96\n`);

  /* ============================================================
     ONE SCENARIO

     `policy` is evaluated in the page each tick and returns the
     player's DESIRED position; the runner clamps the step to the
     scenario's speed, so a policy cannot cheat by asking for a
     teleport. Everything is measured from the boss's own status()
     counters and the player's health, both sampled per tick.
     ============================================================ */
  async function run(scenario) {
    return page.evaluate(async ([s, seconds]) => {
      const T = window.__SF;
      const TICK = 0.05;
      // `_teleportRaw` steps a frame of its own, so a tick is longer
      // than the advanceTime it is paired with. Measuring speed
      // against the advance alone would drive the player 33% fast.
      const DT = TICK + 1 / 60;

      T.clearEnemies();
      T.ctx.districtBosses.reset("reach");
      const site = T.ctx.districtBosses.sites.find((e) => e.key === "reach");
      const inst = T.ctx.districtBosses.ensureSpawned("reach");
      if (!inst) return null;

      // In at the range the hunt starts from, then wait out the gate
      // so the measured window is the FIGHT and not the reveal.
      T._teleportRaw(inst.x + 30, inst.z + 30, Math.atan2(-30, -30));
      T.invulnerable(false);
      T.ctx.combat.player.maxHp = 100000;
      T.ctx.combat.player.hp = 100000;
      let gate = 0;
      for (let i = 0; i < 400; i += 1) {
        T.advanceTime(TICK, 1 / 60);
        gate += TICK;
        if (T.ctx.districtBosses.status("reach")?.phase === "active") break;
      }
      if (s.roused) T.ctx.matriarch.force("rouse", inst);

      // Onto the scenario's opening mark.
      const open = s.startDist;
      T._teleportRaw(inst.x + open * 0.7071, inst.z + open * 0.7071,
        Math.atan2(-0.7071, -0.7071));
      T.advanceTime(TICK, 1 / 60);

      const base = T.ctx.matriarch.status(inst);
      const ps = T.ctx.player.state;
      let px = ps.x;
      let pz = ps.z;
      let hp = T.ctx.combat.player.hp;
      let damage = 0;
      let inReach = 0;
      let dyOk = 0;
      let losOk = 0;
      let inCull = 0;
      let distSum = 0;
      let distMin = Infinity;
      let distMax = 0;
      let firstHitAt = -1;
      let ranOut = false;
      let ticks = 0;
      let startDist = Math.hypot(px - inst.x, pz - inst.z);
      const reach = T.ctx.matriarch.config.comboReach;
      const cullR = T.ctx.matriarch.config.cullRadius;
      const steps = Math.round(seconds / DT);

      for (let i = 0; i < steps; i += 1) {
        const t = i * DT;
        const bx = inst.x;
        const bz = inst.z;
        let ax = px - bx;
        let az = pz - bz;
        const d = Math.hypot(ax, az) || 1e-4;
        ax /= d; az /= d;
        // Tangent, for the orbiting policies.
        const tx = -az;
        const tz = ax;

        let wantX = px;
        let wantZ = pz;
        if (s.mode === "retreat") {
          // Straight back, and the run ENDS at the arena's edge rather
          // than turning along it. The first version held a fixed gap
          // from the BOSS, which a boss that now actually chases simply
          // walked out of its own ring - so every retreat measured a
          // disengage and a teleport home instead of a pursuit.
          wantX = px + ax * s.speed * DT;
          wantZ = pz + az * s.speed * DT;
          if (Math.hypot(wantX - site.x, wantZ - site.z) > s.holdAt) {
            ranOut = true;
            break;
          }
        } else if (s.mode === "standoff") {
          // Hold the mark, sidestep across it - a player plinking.
          const err = d - s.holdAt;
          const rx = -ax * Math.max(-1, Math.min(1, err));
          const rz = -az * Math.max(-1, Math.min(1, err));
          const mx = tx + rx;
          const mz = tz + rz;
          const ml = Math.hypot(mx, mz) || 1;
          wantX = px + (mx / ml) * s.speed * DT;
          wantZ = pz + (mz / ml) * s.speed * DT;
        } else if (s.mode === "orbit") {
          const r = s.holdAt + Math.sin(t * 0.9) * s.wobble;
          const err = d - r;
          const mx = tx - ax * Math.max(-1, Math.min(1, err));
          const mz = tz - az * Math.max(-1, Math.min(1, err));
          const ml = Math.hypot(mx, mz) || 1;
          wantX = px + (mx / ml) * s.speed * DT;
          wantZ = pz + (mz / ml) * s.speed * DT;
        }
        // Never further than the policy's speed allows.
        const sx = wantX - px;
        const sz = wantZ - pz;
        const sl = Math.hypot(sx, sz);
        const cap = s.speed * DT;
        if (sl > cap) { wantX = px + (sx / sl) * cap; wantZ = pz + (sz / sl) * cap; }
        px = wantX; pz = wantZ;

        T._teleportRaw(px, pz, Math.atan2(bx - px, bz - pz));
        T.advanceTime(TICK, 1 / 60);
        px = T.ctx.player.state.x;
        pz = T.ctx.player.state.z;

        const now = T.ctx.combat.player.hp;
        if (now < hp) {
          damage += hp - now;
          if (firstHitAt < 0) firstHitAt = +t.toFixed(2);
        }
        hp = now;

        const dist = Math.hypot(px - inst.x, pz - inst.z);
        distSum += dist;
        distMin = Math.min(distMin, dist);
        distMax = Math.max(distMax, dist);
        /* WHILE IN REACH, COULD IT HAVE LANDED AT ALL? `tryLand` gates
           on height and line of sight as well as range and arc, and
           on the Reach's crater wall both of those fail at six metres
           - so a swing can be perfectly aimed, in range, and still
           draw nothing. Counted here so a live run that lands nothing
           says WHY rather than just how often. */
        if (dist <= reach) {
          inReach += 1;
          const psy = T.ctx.player.state.y;
          /* Fall back to the numbers the module carried before this
             pass, so the SAME probe can measure a stashed baseline
             and the comparison is like for like. */
          const C2 = T.ctx.matriarch.config;
          const sc = C2.strikeCentre ?? 1.2;
          const sh = C2.strikeHeight ?? 3.4;
          if (Math.abs(psy - (inst.y + sc)) <= sh) dyOk += 1;
          const inv2 = 1 / (dist || 1);
          const blocked = T.ctx.collide?.rayBlock
            ? T.ctx.collide.rayBlock(inst.x, inst.y + sc, inst.z,
              (px - inst.x) * inv2, 0, (pz - inst.z) * inv2, dist) < dist - 0.2
            : false;
          if (!blocked) losOk += 1;
        }
        if (dist <= cullR) inCull += 1;
        ticks += 1;
        if (T.ctx.combat.player.dead) break;
      }

      const end = T.ctx.matriarch.status(inst);
      const endDist = Math.hypot(px - inst.x, pz - inst.z);
      const elapsed = ticks * DT;
      return {
        key: s.key,
        gate: +gate.toFixed(1),
        seconds: +elapsed.toFixed(1),
        startDist: +startDist.toFixed(1),
        endDist: +endDist.toFixed(1),
        ranOut,
        siteDist: +Math.hypot(px - site.x, pz - site.z).toFixed(1),
        // Positive means the animal gained ground on a fleeing player.
        closure: +((startDist - endDist) / Math.max(0.1, elapsed)).toFixed(2),
        meanDist: +(distSum / Math.max(1, ticks)).toFixed(1),
        minDist: +distMin.toFixed(1),
        maxDist: +distMax.toFixed(1),
        inReachPct: +((inReach / Math.max(1, ticks)) * 100).toFixed(1),
        dyOkPct: inReach ? +((dyOk / inReach) * 100).toFixed(0) : null,
        losOkPct: inReach ? +((losOk / inReach) * 100).toFixed(0) : null,
        inCullPct: +((inCull / Math.max(1, ticks)) * 100).toFixed(1),
        tells: (end?.tells || 0) - (base?.tells || 0),
        landed: (end?.landed || 0) - (base?.landed || 0),
        whiffed: (end?.whiffed || 0) - (base?.whiffed || 0),
        misses: Object.fromEntries(Object.keys(end?.misses || {}).map((k) =>
          [k, (end.misses[k] || 0) - (base?.misses?.[k] || 0)])),
        tracked: !!end?.misses,
        lances: (end?.lances || 0) - (base?.lances || 0),
        culls: (end?.culls || 0) - (base?.culls || 0),
        damage: Math.round(damage),
        dps: +(damage / Math.max(0.1, elapsed)).toFixed(1),
        firstHitAt,
        roused: !!end?.roused,
        bossPhase: T.ctx.districtBosses.status("reach")?.phase || null,
        homeDist: +Math.hypot(inst.x - site.x, inst.z - site.z).toFixed(1),
        arenaRadius: site.arenaRadius,
      };
    }, [scenario, SECONDS]);
  }

  /* The four ways a player refuses this fight, in order of how much
     the complaint is about them. */
  const SCENARIOS = [
    { key: "backpedal-sighted", mode: "retreat", speed: 3.96, startDist: 12, holdAt: 74,
      label: "backs away DOWN THE SIGHTS (3.96 m/s) - never stops aiming" },
    { key: "backpedal-hipfire", mode: "retreat", speed: 8.6, startDist: 12, holdAt: 74,
      label: "backs away HIPFIRING (8.6 m/s) - the free retreat" },
    { key: "standoff-24m", mode: "standoff", speed: 3.96, startDist: 24, holdAt: 24,
      label: "holds 24m and sidesteps - the plinking range" },
    { key: "orbit-9m", mode: "orbit", speed: 6.0, startDist: 11, holdAt: 9, wobble: 4.5,
      label: "orbits at 9m, 6 m/s - a trooper strafing in the fold" },
    { key: "orbit-9m-roused", mode: "orbit", speed: 6.0, startDist: 11, holdAt: 9, wobble: 4.5,
      roused: true, label: "the same orbit, roused" },
  ];

  const results = [];
  for (const s of SCENARIOS) {
    console.log(`\n=== ${s.key.toUpperCase()} ===`);
    console.log(`  ${s.label}`);
    const r = await run(s);
    if (!r) { check(false, `${s.key}: the Reach's Matriarch can be woken`); continue; }
    results.push(r);
    console.log(`  gate opened in ${r.gate}s · ran ${r.seconds}s`
      + `${r.ranOut ? " (ended at the arena's edge)" : ""} · boss ${r.bossPhase}`
      + ` · ${r.homeDist}m from home (arena ${r.arenaRadius}m)`);
    console.log(`  distance  start ${r.startDist}m -> end ${r.endDist}m`
      + `  ·  mean ${r.meanDist}m  ·  min ${r.minDist}m  ·  max ${r.maxDist}m`);
    console.log(`  CLOSURE   ${r.closure >= 0 ? "+" : ""}${r.closure} m/s`
      + `   (positive = it gained ground)`);
    console.log(`  in scythe reach ${r.inReachPct}% of the run · in cull radius ${r.inCullPct}%`);
    if (r.inReachPct > 0) {
      console.log(`  of the time in reach: height gate passable ${r.dyOkPct}%`
        + ` · line of sight clear ${r.losOkPct}%`);
    }
    console.log(`  tells ${r.tells} · landed ${r.landed} · whiffed ${r.whiffed}`
      + ` · lances ${r.lances} · culls ${r.culls}`);
    if (r.whiffed) {
      console.log(`  why the misses: ${Object.entries(r.misses)
        .filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(" · ") || "unrecorded"}`);
    }
    console.log(`  damage ${r.damage} (${r.dps}/s)`
      + ` · first hit ${r.firstHitAt < 0 ? "NEVER" : `${r.firstHitAt}s`}`);
  }

  /* ============================================================
     THE COMMITTED MOVES, AGAINST A STRAFE

     The stand-off scenario throws four lances and lands none, which
     is not a number a scenario can explain: it says nothing about
     whether the charge fell short, overshot, or arrived pointing the
     wrong way. Each move is forced at a set of ranges against a
     player strafing at aiming pace, and what is reported is the
     ANGULAR ERROR at the contact frame against the arc that has to
     contain it - which is the quantity the whole lead is about.

     THE PLAYER MOVES AT THEIR OWN SPEED AND IS NEVER REPOSITIONED BY
     THE BOSS. An earlier version placed them on a fixed radius from
     the animal's live position every tick, which silently made the
     gap un-closeable: the charge covered nineteen metres and the
     probe reported the player still twenty-four away, because it had
     put them there.
     ============================================================ */
  console.log("\n=== COMMITTED MOVES vs A STRAFING PLAYER ===");
  const committed = await page.evaluate(async () => {
    const T = window.__SF;
    const TICK = 1 / 60;
    const DT = TICK * 2;               // _teleportRaw steps one of its own
    /* ON FLAT, CLEAR GROUND, and not in the Gilded Reach's own crater.
       The first version ran these where the boss actually stands, and
       every scythe whiffed with the aim four degrees off inside a
       forty-degree arc: the player, circling at six metres, was three
       metres UP the crater wall with masonry between them - so the
       misses were the height gate and the line-of-sight gate, both
       working correctly, on a slope this test is not about. A
       mechanism is measured where the mechanism is the only variable;
       what the terrain does to it is the encounter's business, and
       the live scenarios above already play it out where it lives. */
    const site = T.findFlatSite(16);
    /* AND ALONG THE FLATTEST BEARING OUT OF IT. The site itself is
       only clear to sixteen metres, and a lance thrown from thirty
       carries the animal well past that - two of the long trials
       failed the HEIGHT gate at -3.6m against a limit of 3.4, having
       charged downhill off the edge of the patch. The trials are laid
       along the least-varying ray so the only thing the sweep varies
       is the range. */
    let bearing = 0;
    let flattest = Infinity;
    const g0 = T.ctx.terrain.heightAt(site[0], site[1]);
    for (let k = 0; k < 48; k += 1) {
      const b = (k / 48) * Math.PI * 2;
      let worst = 0;
      for (let d = 2; d <= 38; d += 2) {
        const hx = site[0] + Math.sin(b) * d;
        const hz = site[1] + Math.cos(b) * d;
        worst = Math.max(worst, Math.abs(T.ctx.terrain.heightAt(hx, hz) - g0));
      }
      if (worst < flattest) { flattest = worst; bearing = b; }
    }
    T.clearEnemies();
    T.spawnEnemy("matriarch", site[0], site[1], { yaw: 0 });
    T.advanceTime(0.6, 1 / 60);
    const inst = T.ctx.enemies.live.find((e) => e.key === "matriarch");
    if (!inst) return null;
    inst.health = 1e6;
    inst.maxHealth = 1e6;
    T.invulnerable(false);
    T.ctx.combat.player.maxHp = 100000;
    const C = T.ctx.matriarch.config;
    const arcDeg = Math.acos(C.comboArc) * 180 / Math.PI;
    const out = [];

    const trial = (kind, range, speed) => {
      T.ctx.combat.player.hp = 100000;
      /* BACK ON THE MARK FIRST. The trials run in sequence and each
         lance carries the animal up to twenty-five metres downrange;
         left where the last one dropped it, the thirty-four metre
         throw started sixty metres off the flat ray and cut its own
         dash short on ground the sweep had never measured. */
      inst.x = site[0];
      inst.z = site[1];
      inst.home = { x: site[0], z: site[1] };
      let px = inst.x + Math.sin(bearing) * range;
      let pz = inst.z + Math.cos(bearing) * range;
      // A true strafe: tangential to wherever the animal now is,
      // at the player's own pace, and nothing else moves them.
      const step = (hold) => {
        const dx = px - inst.x;
        const dz = pz - inst.z;
        const d = Math.hypot(dx, dz) || 1;
        let mx = -dz / d;
        let mz = dx / d;
        /* HOLDING THE RANGE IS PART OF THE STRAFE, and it has to come
           out of the same speed budget. Without it the warm-up let
           the animal drift out of its own reach before the move was
           forced, and four combos were scored as whiffs when the aim
           error at contact was five degrees inside a forty-degree
           arc: they missed on DISTANCE, which is a different fault
           and was not the one under test. */
        if (hold) {
          const err = Math.max(-1, Math.min(1, d - range));
          mx -= (dx / d) * err;
          mz -= (dz / d) * err;
          const ml = Math.hypot(mx, mz) || 1;
          mx /= ml; mz /= ml;
        }
        px += mx * speed * DT;
        pz += mz * speed * DT;
        T._teleportRaw(px, pz, Math.atan2(inst.x - px, inst.z - pz));
        T.advanceTime(TICK, 1 / 60);
      };
      T._teleportRaw(px, pz, Math.atan2(inst.x - px, inst.z - pz));
      T.advanceTime(0.25, 1 / 60);
      /* THE ANIMAL IS PINNED FOR THE WARM-UP, and only for it. This
         probe is about where a committed move ARRIVES, so the range it
         is thrown from has to be the range the trial names; left free,
         a boss that now chases closed 10m to 7.4 before the throw and
         walked the 34m trial clean out of its own arena. It still
         turns, thinks and tracks - only the feet are held. */
      const bx = inst.x;
      const bz = inst.z;
      for (let i = 0; i < 24; i += 1) {
        step(true);
        inst.x = bx;
        inst.z = bz;
      }

      const before = T.ctx.combat.player.hp;
      const atCock = Math.hypot(px - inst.x, pz - inst.z);
      const startX = inst.x;
      const startZ = inst.z;
      if (!T.ctx.matriarch.force(kind, inst)) return null;
      let errDeg = -1;
      let endGap = -1;
      let gates = null;
      /* THE CONTACT FRAME, not the frame the animal finishes moving.
         A combo runs a wind-up, a gap and half a second of recovery,
         and reading the geometry when the ACTION ends measured the
         boss's aim a second after the blade had already passed - so
         four swings whose real error was well inside the arc were
         reported as unexplained misses. `comboStep` ticks on each
         resolved beat whether it connects or not, which is the only
         signal a whiff also emits. */
      let step0 = T.ctx.matriarch.status(inst)?.comboStep ?? 0;
      for (let i = 0; i < 300; i += 1) {
        const was = T.ctx.matriarch.status(inst)?.action === kind;
        step(false);
        const st = T.ctx.matriarch.status(inst);
        const resolved = (st?.comboStep ?? 0) > step0
          || T.ctx.combat.player.hp < before
          || (was && st?.action !== kind);
        if (resolved) {
          const dx = px - inst.x;
          const dz = pz - inst.z;
          endGap = Math.hypot(dx, dz);
          const bearing = Math.atan2(dx, dz);
          let e = bearing - inst.yaw;
          e = Math.atan2(Math.sin(e), Math.cos(e));
          errDeg = Math.abs(e) * 180 / Math.PI;
          /* THE OTHER TWO GATES. `tryLand` tests four things and the
             two obvious ones - reach and arc - were both satisfied on
             swings that still drew nothing, so the height check and
             the line of sight are dumped here rather than reasoned
             about. Replicated from the module verbatim. */
          const ps2 = T.playerState();
          gates = {
            dy: +(ps2.y - (inst.y + 1.2)).toFixed(2),
            dyLimit: 3.4,
            los: T.ctx.collide?.rayBlock
              ? +T.ctx.collide.rayBlock(inst.x, inst.y + 2.2, inst.z,
                dx / endGap, 0, dz / endGap, endGap).toFixed(2)
              : null,
            instY: +inst.y.toFixed(2),
            playerY: +ps2.y.toFixed(2),
          };
          break;
        }
      }
      const took = before - T.ctx.combat.player.hp;
      return {
        kind, range, speed,
        atCock: +atCock.toFixed(1),
        dashed: +Math.hypot(inst.x - startX, inst.z - startZ).toFixed(1),
        endGap: +endGap.toFixed(1),
        errDeg: +errDeg.toFixed(0),
        damage: Math.round(took),
        hit: took > 0,
        gates,
      };
    };

    for (const range of [6.5, 7.2]) {
      for (const speed of [3.96, 6.0]) {
        const r = trial("combo", range, speed);
        if (r) out.push(r);
      }
    }
    for (const range of [10, 14, 18, 24, 30, 34]) {
      const r = trial("lance", range, 3.96);
      if (r) out.push(r);
    }
    T.invulnerable(true);
    return { arcDeg: +arcDeg.toFixed(0), trials: out,
      flat: +flattest.toFixed(2), patch: +site[2] };
  });
  if (committed) {
    console.log(`  the arc that has to contain the error is +-${committed.arcDeg} degrees`);
    console.log(`  on a patch flat to ${committed.patch}m, along a ray flat to `
      + `${committed.flat}m over 38m`);
    for (const t of committed.trials) {
      console.log(`  ${t.kind.padEnd(5)} from ${String(t.range).padStart(4)}m`
        + ` vs ${t.speed} m/s: thrown at ${t.atCock}m`
        + `${t.kind === "lance" ? `, dashed ${t.dashed}m` : ""}`
        + ` -> ${t.endGap}m away, aim off by ${t.errDeg} deg`
        + ` -> ${t.hit ? `HIT for ${t.damage}` : "whiffed"}`);
      if (!t.hit && t.gates) {
        console.log(`         gates: dy ${t.gates.dy} (limit +-${t.gates.dyLimit})`
          + ` · LOS ${t.gates.los} vs gap ${t.endGap}`
          + ` · boss y ${t.gates.instY}, player y ${t.gates.playerY}`);
      }
    }
    const combo = committed.trials.filter((t) => t.kind === "combo");
    const lance = committed.trials.filter((t) => t.kind === "lance");
    check(combo.filter((t) => t.hit).length >= Math.ceil(combo.length * 0.75),
      "the scythes land on a player holding a strafe",
      `${combo.filter((t) => t.hit).length} of ${combo.length}`);
    check(lance.filter((t) => t.hit).length >= Math.ceil(lance.length * 0.6),
      "the lance arrives on a strafing player across its whole band",
      `${lance.filter((t) => t.hit).length} of ${lance.length} ranges landed`);
  }

  /* ============================================================
     THE GATES

     Deliberately about REACHING the player rather than about how
     much it takes off them. A boss that cannot close is not made
     dangerous by a bigger number on the swing, and one that can is
     already dangerous with the numbers it has.
     ============================================================ */
  console.log("\n=== IS IT AVOIDABLE ===");
  const by = (k) => results.find((r) => r.key === k);
  const sighted = by("backpedal-sighted");
  const hipfire = by("backpedal-hipfire");
  const standoff = by("standoff-24m");
  const orbit = by("orbit-9m");
  const roused = by("orbit-9m-roused");

  if (sighted) {
    check(sighted.closure > -0.1,
      "a player who never leaves the sights cannot open ground on it",
      `closure ${sighted.closure} m/s, ${sighted.startDist}m -> ${sighted.endDist}m`);
    check(sighted.landed > 0,
      "...and is caught and hit inside the run",
      `${sighted.landed} of ${sighted.tells} tells, first at ${sighted.firstHitAt}s`);
  }
  if (hipfire) {
    check(hipfire.tells > 0,
      "breaking into a full run is answered, not ignored",
      `${hipfire.tells} tells, ${hipfire.lances} lances, ended ${hipfire.endDist}m out`);
  }
  if (standoff) {
    check(standoff.landed > 0,
      "twenty-four metres is not a safe place to stand",
      `${standoff.landed} landed, ${standoff.lances} lances, `
      + `${standoff.inReachPct}% of the run inside scythe reach`);
  }
  if (orbit) {
    check(orbit.landed > 0 && orbit.dps > 0,
      "a strafing player in the fold is hit",
      `${orbit.landed} of ${orbit.tells} tells, ${orbit.dps} dps`);
  }

  /* ============================================================
     THE SITE ITSELF, which is a separate fault and is reported as
     one rather than scored against the animal.

     The moveset connects: on open ground the scythes land four times
     out of four and the lance six out of six across its whole band.
     In the Gilded Reach it lands roughly half as often, and the miss
     tally says why - `sight`, over and over. Measured cold, with
     nothing moving: standing on its own spawn marker, only 56 to 65
     per cent of the directions around this animal are clear at strike
     height, and the ground within nine metres of it runs from 8.7m
     below to 11.2m above. It is parked on a ridge with masonry inside
     its own melee reach.

     That predates every change in this pass - a boss that could not
     close never had a swing to lose to a wall - and fixing it means
     moving a district boss's site, which drags the arena ring, the
     beacon, the reveal camera and every save that records a position.
     It is named here so it is not mistaken for the animal being
     harmless again. */
  console.log("\n=== THE GROUND IT WAS GIVEN ===");
  const siteClear = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.districtBosses.ensureSpawned("reach");
    if (!inst) return null;
    const C = T.ctx.matriarch.config;
    const out = {};
    for (const r of [5, 7, 9]) {
      let clear = 0;
      for (let k = 0; k < 72; k += 1) {
        const b = (k / 72) * Math.PI * 2;
        const hit = T.ctx.collide.rayBlock(inst.x, inst.y + (C.strikeCentre ?? 1.2), inst.z,
          Math.sin(b), 0, Math.cos(b), r);
        if (!(hit < r - 0.2)) clear += 1;
      }
      out[r] = Math.round((clear / 72) * 100);
    }
    const g0 = T.ctx.terrain.heightAt(inst.x, inst.z);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 36; k += 1) {
      const b = (k / 36) * Math.PI * 2;
      const h = T.ctx.terrain.heightAt(inst.x + Math.sin(b) * 9, inst.z + Math.cos(b) * 9);
      lo = Math.min(lo, h - g0);
      hi = Math.max(hi, h - g0);
    }
    return { clear: out, relief: [+lo.toFixed(1), +hi.toFixed(1)] };
  });
  if (siteClear) {
    console.log(`  clear arc at strike height: 5m ${siteClear.clear[5]}%`
      + ` · 7m ${siteClear.clear[7]}% · 9m ${siteClear.clear[9]}%`);
    console.log(`  ground within 9m: ${siteClear.relief[0]}m to +${siteClear.relief[1]}m`
      + ` relative to where it stands`);
    check(siteClear.clear[7] >= 80,
      "the arena gives it a clear swing in most directions at scythe range",
      `${siteClear.clear[7]}% clear at 7m - masonry inside its own reach`);
    check(siteClear.relief[1] - siteClear.relief[0] <= 8,
      "...on ground level enough for a ground animal to reach a player on it",
      `${(siteClear.relief[1] - siteClear.relief[0]).toFixed(1)}m of relief within 9m`);
  }
  if (orbit && roused) {
    check(roused.tells >= orbit.tells,
      "rousing raises the pressure rather than lowering it",
      `${orbit.tells} tells calm -> ${roused.tells} roused`);
  }
  for (const r of results) {
    check(r.homeDist <= r.arenaRadius + 0.5,
      `${r.key}: it stays inside its own arena while it chases`,
      `${r.homeDist}m from the site marker`);
  }

  check(pageErrors.length === 0, "no page errors during the probe",
    pageErrors.slice(0, 3).join(" | ") || "clean");

  if (JSON_OUT) {
    await writeFile(path.isAbsolute(JSON_OUT) ? JSON_OUT : path.join(root, JSON_OUT),
      JSON.stringify({ config: cfg, seconds: SECONDS, results }, null, 2));
    console.log(`\n  wrote ${JSON_OUT}`);
  }

  console.log(`\n${findings.length ? `${findings.length} FINDING(S)` : "ALL CHECKS PASSED"}`);
  for (const f of findings) console.log(`  - ${f}`);
  await browser.close();
} finally {
  server.kill();
}
process.exit(findings.length ? 1 : 0);
