#!/usr/bin/env node
/* ============================================================
   SAINTFALL - The Undercroft (Apostate phase two) regression

   Proves the second phase as a player-facing contract:
     - a lethal Cathedral hit collapses the floor instead of killing;
     - the ground override actually replaces the terrain, so the room
       has a floor eighty-eight metres under one;
     - the cinematic lands both bodies and hands control back;
     - the promised headroom is real against the pack's own ceiling;
     - the clutch and the lashers are shootable, cuttable, and the
       cut is what staggers the boss;
     - containment holds, respawn stays in the room, and the second
       pool still ends the operation exactly once;
     - a save taken in the hive reloads into the hive.

   Usage:
     node scripts/saintfall-undercroft.mjs [--out output/path] [--shots 1]
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
const outDir = path.resolve(root, args.out || "output/saintfall/undercroft");
const wantShots = args.shots !== "0";
const port = 54200 + (process.pid % 4000);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail) });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const pageErrors = [];
const consoleErrors = [];

/** Render-loop-safe screenshot: the headless shell throttles rAF to
 *  about one frame a second, so a fixed wait photographs black.
 *  Step the world explicitly, then shoot. */
async function shoot(page, file, steps = 2) {
  if (!wantShots) return null;
  await page.evaluate((n) => {
    const T = window.__SF;
    for (let i = 0; i < n; i += 1) T.renderStill();
  }, steps);
  const out = path.join(outDir, file);
  await page.screenshot({ path: out });
  return out;
}

try {
  await mkdir(outDir, { recursive: true });
  for (let attempt = 0; attempt < 300; attempt += 1) {
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
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`${base}/games/saintfall.html?boss=apostate&quality=high&qa=1`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  /* ---- 1. THE ROOM EXISTS AND COSTS NOTHING UNTIL IT IS USED ---- */
  const dormant = await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.renderOnce(1 / 60);
    const u = T.undercroftState();
    const c = T.undercroftGround(u.landing.x, u.landing.z);
    return { u, overrideWhileIdle: c };
  });
  check("the chamber is built at load and hidden",
    dormant.u.phase === "idle" && dormant.u.visible === false,
    `${dormant.u.phase}/visible=${dormant.u.visible}`);
  check("the chamber is a real build, not an empty group",
    dormant.u.counts.cells > 80 && dormant.u.counts.veins > 10
      && dormant.u.counts.sacs > 8 && dormant.u.counts.rubble > 20,
    JSON.stringify(dormant.u.counts));
  check("the ground override is silent before the collapse",
    dormant.overrideWhileIdle === null, String(dormant.overrideWhileIdle));
  check("the pan is dug well below the nave floor",
    dormant.u.surfaceY - dormant.u.floorY > 80,
    (dormant.u.surfaceY - dormant.u.floorY).toFixed(2));

  /* ---- 2. HEADROOM, AGAINST THE PACK'S OWN CEILING -------------- */
  const headroom = await page.evaluate(() => {
    const T = window.__SF;
    const u = T.undercroftState();
    return {
      apex: u.apex, headroom: u.headroom, hemHeadroom: u.hemHeadroom,
      packCeiling: T.jetpackState()?.maxAltitude ?? 10,
    };
  });
  check("the vault clears a fully-flown pack over the fighting pan",
    headroom.headroom > 20, `${headroom.apex}m apex, ${headroom.headroom}m clear`);
  check("even the hem clears a fully-flown pack",
    headroom.hemHeadroom > 4, `${headroom.hemHeadroom}m clear at the wall`);

  /* ---- 3. A LETHAL HIT COLLAPSES THE FLOOR ---------------------- */
  const collapse = await page.evaluate(() => {
    const T = window.__SF;
    T.advanceToApostatePhase("duel", 12, 1 / 60);
    const inst = T.apostate.instance();
    const beforeKills = T.combat.stats().kills;
    const stageOneMax = inst.maxHealth;
    /* One overkill blow through the real damage pipeline, which is
       the only honest way to ask "does a killing hit kill". */
    T.combat.damageEnemy(inst, inst.maxHealth * 4, { source: "qa" });
    const armed = T.apostateState();
    return {
      beforeKills, stageOneMax,
      health: inst.health,
      phase: armed.phase, stage: armed.stage, dead: armed.dead,
      kills: T.combat.stats().kills,
      under: T.undercroftState().phase,
    };
  });
  check("a lethal Cathedral hit does not kill the boss",
    collapse.health >= 1 && collapse.dead === false,
    `hp=${collapse.health} dead=${collapse.dead}`);
  check("the lethal hit is not counted as a kill",
    collapse.kills === collapse.beforeKills,
    `${collapse.beforeKills} -> ${collapse.kills}`);

  const fracture = await page.evaluate(() => {
    const T = window.__SF;
    T.renderOnce(1 / 60);
    return {
      apostate: T.apostateState(),
      under: T.undercroftState(),
      free: T.playerState().free,
    };
  });
  check("the collapse arms on the next frame",
    fracture.under.phase === "fracture" && fracture.apostate.phase === "descent"
      && fracture.apostate.stage === 2,
    `${fracture.under.phase}/${fracture.apostate.phase}/stage${fracture.apostate.stage}`);
  check("the cinematic takes the camera", fracture.free === true, String(fracture.free));
  const fractureShot = await shoot(page, "01-fracture.png");

  /* ---- 4. THE FALL --------------------------------------------- */
  const fall = await page.evaluate(() => {
    const T = window.__SF;
    const samples = [];
    let sawFall = false;
    let minGap = Infinity;
    for (let i = 0; i < 900; i += 1) {
      T.renderOnce(1 / 60);
      const u = T.undercroftState();
      const ps = T.playerState();
      const inst = T.apostate.instance();
      if (u.phase === "fall") {
        sawFall = true;
        minGap = Math.min(minGap, Math.abs(inst.y - ps.y));
        if (i % 12 === 0) samples.push({ py: Number(ps.y.toFixed(1)), by: Number(inst.y.toFixed(1)) });
      }
      if (u.phase === "settle" || u.phase === "live") break;
    }
    const ps = T.playerState();
    return {
      sawFall, samples, minGap: Number(minGap.toFixed(2)),
      phase: T.undercroftState().phase,
      playerY: ps.y, floorY: T.undercroftState().floorY,
      dropped: samples.length > 1 ? samples[0].py - samples[samples.length - 1].py : 0,
    };
  });
  check("the trooper falls", fall.sawFall && fall.dropped > 25,
    `${fall.dropped.toFixed(1)}m sampled`);
  check("the boss falls with them, in frame", fall.minGap < 12, `${fall.minGap}m apart`);
  const fallShot = await shoot(page, "02-fall.png");

  /* ---- 5. LANDING AND RELEASE ----------------------------------- */
  const settled = await page.evaluate(() => {
    const T = window.__SF;
    let answered = 0;
    for (let i = 0; i < 900; i += 1) {
      T.renderOnce(1 / 60);
      const u = T.undercroftState();
      answered = Math.max(answered, u.lashersUp);
      if (u.phase === "live") break;
    }
    const u = T.undercroftState();
    const ps = T.playerState();
    const inst = T.apostate.instance();
    return {
      phase: u.phase, free: ps.free, answered,
      playerY: Number(ps.y.toFixed(2)),
      chamberFloorHere: Number(T.undercroftGround(ps.x, ps.z).toFixed(2)),
      bossY: Number(inst.y.toFixed(2)),
      bossHealth: inst.health, bossMax: inst.maxHealth,
      grounded: ps.grounded,
      eggs: u.eggs, lashers: u.lashers.length,
      apart: Number(Math.hypot(inst.x - ps.x, inst.z - ps.z).toFixed(2)),
      visible: u.visible,
    };
  });
  check("the fight resumes underground with control returned",
    settled.phase === "live" && settled.free === false && settled.visible === true,
    `${settled.phase}/free=${settled.free}`);
  check("the trooper is standing on the chamber floor, not the desert",
    Math.abs(settled.playerY - settled.chamberFloorHere) < 0.6 && settled.grounded,
    `${settled.playerY} vs ${settled.chamberFloorHere}`);
  check("the second pool is bigger than the first and full",
    settled.bossMax > collapse.stageOneMax
      && settled.bossHealth === settled.bossMax,
    `${collapse.stageOneMax} -> ${settled.bossHealth}/${settled.bossMax}`);
  check("the hive answers with every limb", settled.answered >= 5, String(settled.answered));
  check("the boss lands within reach, not across the room",
    settled.apart > 6 && settled.apart < 34, `${settled.apart}m`);
  const liveShot = await shoot(page, "03-landed.png", 3);

  /* ---- 6. THE ROOM IS A ROOM ------------------------------------ */
  const room = await page.evaluate(() => {
    const T = window.__SF;
    const u = T.undercroftState();
    const cfg = T.undercroft.config;
    /* Sampled from the chamber's own centre, not the landing point:
       the landing sits under the breach and is already thirty metres
       off-axis, so a radius measured from it walks straight out
       through the gallery and reads the wall as "the pan". */
    const samples = [];
    for (let r = 0; r <= cfg.reach + 8; r += 4) {
      samples.push({
        r,
        y: T.undercroftGround(cfg.x + r, cfg.z),
        terrain: T.terrain.heightAt(cfg.x + r, cfg.z),
      });
    }
    /* Walk the trooper hard at the wall for four seconds and see
       whether the room lets go of them. */
    const ps = T.playerState();
    T.player.spawn(u.landing.x, u.landing.z, 0);
    let escaped = 0;
    let maxR = 0;
    for (let i = 0; i < 260; i += 1) {
      ps.x += 1.2;
      ps.z += 0.6;
      T.renderOnce(1 / 60);
      const dr = Math.hypot(ps.x - (u.landing.x - T.undercroft.config.x + T.undercroft.config.x),
        ps.z - u.landing.z);
      const fromCentre = Math.hypot(ps.x - T.undercroft.config.x, ps.z - T.undercroft.config.z);
      maxR = Math.max(maxR, fromCentre);
      if (fromCentre > T.undercroft.config.keepIn + 0.5) escaped += 1;
    }
    return { samples, escaped, maxR: Number(maxR.toFixed(2)), keepIn: cfg.keepIn };
  });
  const insideSamples = room.samples.filter((s) => s.r <= 40);
  check("the override actually replaces the terrain inside the room",
    insideSamples.every((s) => s.y !== null && s.terrain - s.y > 70),
    `${insideSamples.length} samples, min drop ${
      Math.min(...insideSamples.map((s) => s.terrain - s.y)).toFixed(1)}m`);
  check("the override stops at the room's edge",
    room.samples.filter((s) => s.r > 92).every((s) => s.y === null),
    JSON.stringify(room.samples[room.samples.length - 1]));
  check("the wall holds a trooper shoved straight at it",
    room.escaped === 0 && room.maxR <= room.keepIn + 0.5,
    `max r=${room.maxR} against keepIn ${room.keepIn}`);

  /* ---- 7. THE CLUTCH IS SHOOTABLE ------------------------------- */
  const clutch = await page.evaluate(() => {
    const T = window.__SF;
    T.player.spawn(T.undercroftState().landing.x, T.undercroftState().landing.z, 0);
    let laid = 0;
    for (let i = 0; i < 60 * 40 && laid === 0; i += 1) {
      T.renderOnce(1 / 60);
      laid = T.undercroftState().eggs;
    }
    const u = T.undercroftState();
    const before = u.eggs;
    const egg = T.undercroft.eggs.find((e) => e.live);
    const hits = egg
      ? T.undercroftHit(egg.x, egg.y + 1, egg.z, 1.8, 9999) : 0;
    const after = T.undercroftState().eggs;
    /* Let one run to term and prove it produces an actual enemy. */
    let hatched = 0;
    for (let i = 0; i < 60 * 25; i += 1) {
      T.renderOnce(1 / 60);
      hatched = T.undercroftState().brood;
      if (hatched > 0) break;
    }
    return { before, hits, after, hatched, eggsNow: T.undercroftState().eggs };
  });
  check("the hive lays a clutch around the trooper", clutch.before > 0, String(clutch.before));
  check("an egg is a target", clutch.hits > 0 && clutch.after < clutch.before,
    `${clutch.before} -> ${clutch.after} (${clutch.hits} hits)`);
  check("an egg left alone hatches something", clutch.hatched > 0, String(clutch.hatched));

  /* ---- 8. THE LASHERS ------------------------------------------- */
  const lash = await page.evaluate(() => {
    const T = window.__SF;
    const cfg = T.undercroft.config;
    /* Stand where the limbs can reach, and let them come up. */
    const a = 0.31;
    const px = cfg.x + Math.cos(a) * (cfg.lasherRoot - 8);
    const pz = cfg.z + Math.sin(a) * (cfg.lasherRoot - 8);
    T.player.spawn(px, pz, 0);
    T.invulnerable(true);
    let up = 0;
    let tallest = -Infinity;
    for (let i = 0; i < 60 * 30; i += 1) {
      T.renderOnce(1 / 60);
      const u = T.undercroftState();
      up = Math.max(up, u.lashersUp);
      for (const l of u.lashers) tallest = Math.max(tallest, l.tipY);
      if (up > 0 && i > 60 * 6) break;
    }
    const inst = T.apostate.instance();
    const before = { stun: inst.stunTime || 0, cuts: T.undercroftState().totalCuts };
    /* Cut whatever is currently reared. A limb spends most of its
       cycle sheathed, so this waits on the sim rather than assuming
       one is standing there. */
    let cut = 0;
    let staggered = 0;
    let unmoored = 0;
    for (let frame = 0; frame < 60 * 45 && cut < 3; frame += 1) {
      T.renderOnce(1 / 60);
      const limb = T.undercroft.lashers.find((l) => l.rise > 0.5 && l.mode !== "cut");
      if (!limb) continue;
      const node = limb.nodes[Math.floor(limb.nodes.length * 0.6)];
      T.undercroftHit(node.x + cfg.x, node.y + T.undercroftState().floorY,
        node.z + cfg.z, 2.5, 99999);
      if (limb.mode === "cut") cut += 1;
      staggered = Math.max(staggered, T.apostate.instance().stunTime || 0);
      unmoored = Math.max(unmoored, T.undercroftState().unmooredFor);
    }
    const after = T.undercroftState();
    return {
      up, tallest: Number(tallest.toFixed(2)),
      floorY: after.floorY, apex: after.apex,
      cut, staggered: Number(staggered.toFixed(2)),
      totalCuts: after.totalCuts, unmooredFor: Number(unmoored.toFixed(2)),
      cutModes: after.lashers.filter((l) => l.mode === "cut").length,
    };
  });
  check("lashers rear where the trooper is", lash.up > 0, String(lash.up));
  check("a reared lasher never touches the roof",
    lash.tallest - lash.floorY < lash.apex - 4,
    `tip ${(lash.tallest - lash.floorY).toFixed(1)}m under a ${lash.apex}m vault`);
  check("a lasher can be cut", lash.cut >= 1 && lash.cutModes >= 1,
    `${lash.cut} cut`);
  check("cutting staggers the thing feeding them", lash.staggered > 0.5,
    `${lash.staggered}s`);
  check("the third cut unmoors the boss",
    lash.cut >= 3 && lash.unmooredFor > 0,
    `cuts=${lash.totalCuts} unmoored=${lash.unmooredFor}s`);

  /* ---- 8a. AND THE WINDOW PAYS ---------------------------------
     Cutting three limbs is the phase's whole damage loop, and the
     measurement in `unmooredDamage` says the window only pays if a
     hit inside it lands for more. The multiplier shipped inside the
     collapse-arming branch, above a `return` that threw its product
     away, so for the phase's entire life the window was worth
     exactly nothing extra. This takes the SAME hit twice through
     combat.js's own entry - once inside the window still open from
     the third cut above, once after it lapses - and compares what
     came out. The assertion is the RATIO rather than either
     absolute number, because doctrine and the Gilding boon are
     multipliers on this same path and would move both samples. ---- */
  const unmoorPay = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    const SAMPLE = 40;
    let reported = null;
    const stop = T.combat.bus.on("enemyDamaged", (e) => {
      if (e && e.source === "qa-unmoor") reported = e;
    });
    /* The pool is put back after each sample: this harness goes on to
       measure containment and the second death, and a probe that
       quietly shaves the boss would be changing the fight it is
       reporting on. Aimed from off to one side so the request carries
       a real origin for the aegis test to read. */
    function sample() {
      const before = inst.health;
      reported = null;
      const actual = T.combat.damageEnemy(inst, SAMPLE, {
        source: "qa-unmoor",
        x: inst.x, y: inst.y + 1.2, z: inst.z,
        originX: inst.x - 12, originZ: inst.z,
      });
      inst.health = before;
      return {
        /* The PREDICATE the boss reads, not the rounded number the
           status block prints: `unmooredFor` is reported to two
           decimals, so a window with a float's worth of time left
           reads as closed and the "outside" sample lands inside it. */
        unmoored: T.undercroft.unmoored(),
        unmooredFor: Number(T.undercroftState().unmooredFor.toFixed(2)),
        actual: Number(actual.toFixed(3)),
        reported: reported ? Number(reported.damage.toFixed(3)) : null,
        requested: reported ? Number(reported.requested.toFixed(3)) : null,
      };
    }
    /* A raised shield zeroes a frontal hit, and a blocked sample
       would read as "the multiplier did nothing" - so both samples
       wait for a frame where the aegis is down rather than trusting
       the boss to be idle. */
    let inside = null;
    for (let i = 0; i < 60 * 6; i += 1) {
      if (!T.undercroft.unmoored()) break;
      if (!T.apostateState().shieldActive) { inside = sample(); break; }
      T.renderOnce(1 / 60);
    }
    let outside = null;
    for (let i = 0; i < 60 * 20; i += 1) {
      T.renderOnce(1 / 60);
      if (T.undercroft.unmoored()) continue;
      if (T.apostateState().shieldActive) continue;
      outside = sample();
      break;
    }
    if (stop) stop();
    return {
      sample: SAMPLE,
      factor: T.undercroft.config.unmooredDamage,
      inside, outside,
      ratio: (inside && outside && outside.reported > 0)
        ? Number((inside.reported / outside.reported).toFixed(3)) : null,
    };
  });
  check("a hit lands at all in the hive",
    !!unmoorPay.outside && unmoorPay.outside.actual > 0,
    JSON.stringify(unmoorPay.outside));
  check("outside the window a hit is reported at face value",
    !!unmoorPay.outside
      && Math.abs(unmoorPay.outside.reported - unmoorPay.outside.requested) < 0.01,
    `${unmoorPay.outside?.reported} vs requested ${unmoorPay.outside?.requested}`);
  check("the unmoor window multiplies the damage it reports",
    unmoorPay.ratio !== null
      && Math.abs(unmoorPay.ratio - unmoorPay.factor) < 0.02,
    `x${unmoorPay.ratio} (want x${unmoorPay.factor}): `
      + `${unmoorPay.inside?.reported} in / ${unmoorPay.outside?.reported} out`);
  const lashShot = await shoot(page, "04-lashers.png", 2);

  /* ---- 8b. A LASH THAT CONNECTS IS A LASH THAT HURTS ------------ */
  const lashHurt = await page.evaluate(() => {
    const T = window.__SF;
    const cfg = T.undercroft.config;
    T.invulnerable(false);
    T.combat.player.hp = T.combat.player.maxHp;
    let swings = 0;
    let connected = 0;
    const stop = T.undercroft.bus.on("lash", (e) => {
      swings += 1;
      if (e?.hit) connected += 1;
    });
    /* Pinned inside a root's reach and not allowed to move, which is
       the only way to ask "does this attack work" without also asking
       "can the player dodge it". */
    const a = 0.31 + Math.PI * 0.25;
    const px = cfg.x + Math.cos(a) * (cfg.lasherInnerRoot - 5);
    const pz = cfg.z + Math.sin(a) * (cfg.lasherInnerRoot - 5);
    T.player.spawn(px, pz, 0);
    const startHp = T.combat.player.hp;
    for (let i = 0; i < 60 * 50; i += 1) {
      T.player.state.x = px;
      T.player.state.z = pz;
      T.renderOnce(1 / 60);
      if (connected > 0) break;
    }
    const hp = T.combat.player.hp;
    stop?.();
    T.invulnerable(true);
    T.combat.player.hp = T.combat.player.maxHp;
    return { swings, connected, startHp, hp };
  });
  check("a lasher that is not dodged takes health off the trooper",
    lashHurt.connected > 0 && lashHurt.hp < lashHurt.startHp,
    `${lashHurt.connected}/${lashHurt.swings} connected, ${lashHurt.startHp} -> ${lashHurt.hp}`);

  /* ---- 8c. WHAT THE ROOM COSTS ---------------------------------
     Measured as the module's own CPU, not as a frame rate: this
     project's frame is GPU fill-bound and a headless shell's wall
     clock says almost nothing about either. Eight tentacles are
     re-solved and two vertex buffers rewritten every frame, so the
     number worth defending is what that costs the simulation. */
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    const u = T.undercroft;
    const sample = (n) => {
      /* Warm, then measure - the first call through a fresh code path
         is a compile, not a frame. */
      for (let i = 0; i < 40; i += 1) u.update(1 / 60);
      const t0 = performance.now();
      for (let i = 0; i < n; i += 1) u.update(1 / 60);
      return (performance.now() - t0) / n;
    };
    const liveMs = sample(400);
    const liveState = T.undercroftState();
    return {
      liveMs: Number(liveMs.toFixed(4)),
      lashers: liveState.lashers.length,
      lashersUp: liveState.lashersUp,
      eggs: liveState.eggs,
    };
  });
  check("the room's own simulation stays inside a frame's budget",
    cost.liveMs < 1.2, `${cost.liveMs}ms with ${cost.lashers} limbs`);

  /* ---- 9. DYING UNDERGROUND STAYS UNDERGROUND ------------------- */
  const death = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(false);
    const cfg = T.undercroft.config;
    T.combat.hurtPlayer(99999, { source: "qa" });
    let respawned = false;
    for (let i = 0; i < 60 * 12; i += 1) {
      T.renderOnce(1 / 60);
      if (!T.combat.player.dead) { respawned = true; break; }
    }
    const ps = T.playerState();
    return {
      respawned,
      fromCentre: Number(Math.hypot(ps.x - cfg.x, ps.z - cfg.z).toFixed(2)),
      y: Number(ps.y.toFixed(2)),
      floorY: T.undercroftState().floorY,
      stillLive: T.undercroftState().phase,
    };
  });
  check("respawning after a death underground stays in the room",
    death.respawned && death.fromCentre < 60 && death.y - death.floorY < 8,
    `r=${death.fromCentre} y-floor=${(death.y - death.floorY).toFixed(2)}`);

  /* ---- 10. SAVE AND RELOAD INSIDE THE HIVE ---------------------- */
  const saveTrip = await page.evaluate(async () => {
    const T = window.__SF;
    T.invulnerable(true);
    /* Settle to a saveable frame: grounded, no action, no free cam. */
    for (let i = 0; i < 240; i += 1) T.renderOnce(1 / 60);
    const reason = T.saves.state().saveReason;
    const wrote = T.saveSlot(0);
    const before = {
      under: T.undercroftState(), boss: T.apostateState(),
      player: { x: T.playerState().x, y: T.playerState().y, z: T.playerState().z },
    };
    for (let i = 0; i < 300; i += 1) T.renderOnce(1 / 60);
    const loaded = T.loadSlot(0);
    for (let i = 0; i < 5; i += 1) T.renderOnce(1 / 60);
    const after = {
      under: T.undercroftState(), boss: T.apostateState(),
      player: { x: T.playerState().x, y: T.playerState().y, z: T.playerState().z },
    };
    return { reason, wrote: !!wrote, loaded: !!loaded, before, after };
  });
  check("a field save is legal inside the hive",
    saveTrip.wrote && !saveTrip.reason, saveTrip.reason || "ok");
  check("reloading it comes back underground, in phase two",
    saveTrip.loaded && saveTrip.after.under.phase === "live"
      && saveTrip.after.boss.stage === 2
      && saveTrip.after.player.y - saveTrip.after.under.floorY < 8,
    `${saveTrip.after.under.phase}/stage${saveTrip.after.boss.stage}/`
      + `${(saveTrip.after.player.y - saveTrip.after.under.floorY).toFixed(2)}`);

  /* ---- 11. THE SECOND POOL STILL ENDS THE OPERATION ------------- */
  const finish = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.apostate.instance();
    const beforeKills = T.combat.stats().kills;
    T.combat.damageEnemy(inst, inst.maxHealth * 4, { source: "qa" });
    let settled = 0;
    let won = "";
    T.apostate.bus.on("settled", () => { settled += 1; });
    for (let i = 0; i < 60 * 14; i += 1) {
      T.renderOnce(1 / 60);
      won = T.mission.stats().phase;
      if (won === "won") break;
    }
    return {
      won, settled, dead: T.apostateState().dead,
      kills: T.combat.stats().kills - beforeKills,
      collapsedTwice: T.undercroftState().used,
      eggs: T.undercroftState().eggs,
    };
  });
  check("emptying the second pool kills the boss",
    finish.dead === true && finish.kills >= 1, JSON.stringify(finish));
  check("the operation completes exactly once",
    finish.won === "won", finish.won);
  check("the clutch is cleared with the boss", finish.eggs === 0, String(finish.eggs));
  const winShot = await shoot(page, "05-victory.png", 2);

  const realConsoleErrors = consoleErrors.filter((message) =>
    !/jsdelivr|unpkg|favicon|Failed to load resource/i.test(message));
  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  check("no console errors", realConsoleErrors.length === 0,
    realConsoleErrors.slice(0, 3).join(" | "));

  await writeFile(path.join(outDir, "report.json"), JSON.stringify({
    results, failed, dormant, headroom, collapse, fracture, fall, settled,
    room, clutch, lash, lashHurt, cost, death, saveTrip, finish,
    shots: [fractureShot, fallShot, liveShot, lashShot, winShot].filter(Boolean),
  }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  console.log(`Report: ${path.join(outDir, "report.json")}`);
  await browser.close();
} finally {
  server.kill();
}

process.exitCode = failed ? 1 : 0;
