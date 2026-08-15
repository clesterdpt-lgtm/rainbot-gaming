#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Garner encounter regression

   Proves the player-facing promises of the Ossuary's pit:
     - it ignores the player until they cross the aggro radius, and
       cannot be seen or damaged before it does;
     - approaching COLLAPSES the ground: one animated scalar carries
       the pan from sealed to open and the mouth from the bottom of
       the shaft to standing proud of it;
     - a lash is a readable sequence - erupt, rear, strike - and its
       outcome is decided at the CONTACT frame, so moving during the
       telegraph is the answer to it;
     - A MISS IS THE POINT: the limb falls across the sand, lies
       there, and drags itself home, and while it is down a polearm
       reaches it. While it is UP, a polearm reaches only its base;
     - each limb is its own target with its own pool, cut through the
       same per-limb path the Distaff's legs use, and cutting enough
       of them forces the gorge window;
     - the gorge exposes the gullet: weak to a shot, weaker to a
       swing, and it regrows the limbs on the way out;
     - the inhale drags the player toward the throat and reaching it
       costs most of a life and a throw back to the rim - and nothing
       walks over the open mouth at any other time;
     - walking away leashes it: full heal, the pan closes, and a fresh
       fight for the next approach;
     - it survives a save/restore round trip, and the whole encounter
       renders inside its performance budget.

   Usage:
     node scripts/saintfall-garner-fight.mjs [--out output/path]
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
const outDir = path.resolve(root, args.out || "output/saintfall/garner-fight");
const port = 51900 + (process.pid % 6000);
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
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  /* Failed requests are tracked BY URL rather than by console text -
     see the Distaff harness for why the browser's own 404 line cannot
     tell a flaky CDN probe from a missing game asset. */
  const assetFailures = [];
  const sameOrigin = (url) => url.startsWith(base);
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

  /* ---- RIG ------------------------------------------------------------- */
  const rig = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(true);
    const g = T.garnerState();
    const inst = T.enemies.live.find((e) => e.key === "garner");
    return {
      spawned: !!g,
      phase: g?.phase,
      health: g?.health,
      /* The limbs satisfy combat.js's per-limb contract from a rig that
         has no skeleton at all - four live nodes, a pool each. */
      limbs: inst?.legs?.length,
      pools: inst?.legHp?.length,
      chains: inst?.legs?.every((l) => Array.isArray(l.chain) && l.chain.length === 4),
      bodyNodes: ["garner_throat", "garner_lip"].every((n) => inst?.bones?.has(n)),
      noClips: inst?.actions?.size === 0,
      hidden: !!inst?.encounterHidden,
      targetable: T.combat.targetable(inst),
    };
  });
  check("spawns once, dormant, with no .glb behind it",
    rig.spawned && rig.phase === "dormant" && rig.noClips);
  check("six limbs, each with its own pool and its own four hit nodes",
    rig.limbs === 6 && rig.pools === 6 && rig.chains);
  check("the mouth's two live hit nodes resolve", rig.bodyNodes);
  check("the dormant pit cannot be seen or damaged", rig.hidden && !rig.targetable);

  /* ---- THE COLLAPSE ---------------------------------------------------- */
  const breach = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToGarner(40);
    const secs = T.advanceToGarnerPhase("breach", 8);
    const mid = T.garnerState();
    const feed = T.advanceToGarnerPhase("feeding", 14);
    const open = T.garnerState();
    T.renderOnce(1 / 60);
    return { secs, midOpen: mid?.open, feed, open: open?.open, phase: open?.phase };
  });
  check("crossing the aggro radius collapses the ground", breach.secs >= 0);
  check("the pit opens progressively rather than snapping",
    breach.midOpen < 0.35 && breach.open === 1, JSON.stringify(breach));
  check("the collapse hands control back to the fight", breach.phase === "feeding");
  await page.screenshot({ path: path.join(outDir, "01-open.png") });

  /* ---- THE LASH -------------------------------------------------------- */
  const lash = await page.evaluate(() => {
    const T = window.__SF;
    const seen = [];
    T.forceGarnerLash(0);
    for (let i = 0; i < 260; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      const p = T.garnerState().armPhases[0];
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    const nodes = T.garnerArmNodes(0);
    // The limb's own length, measured off the nodes combat.js reads.
    const span = nodes.reduce((sum, n, i) => i === 0 ? 0
      : sum + Math.hypot(n.x - nodes[i - 1].x, n.y - nodes[i - 1].y,
        n.z - nodes[i - 1].z), 0);
    return { seen, span: Number(span.toFixed(2)) };
  });
  check("a limb erupts, rears, strikes and then resolves",
    lash.seen[0] === "erupt" && lash.seen[1] === "rear" && lash.seen[2] === "lash",
    lash.seen.join(" -> "));
  /* THE COLLAPSED-CHAIN REGRESSION. The first solver laid the nodes
     evenly between anchor and target and then enforced link length
     forward, which folds the whole limb into a ball at its own root
     whenever the target is nearer than the limb is long - i.e. always.
     Twelve metres of span across four sampled nodes is the cheap,
     unambiguous test that the FABRIK pass is doing its job. */
  check("a reaching limb keeps its length instead of folding up",
    lash.span > 12, `${lash.span}m across the four hit nodes`);

  /* A player standing still is seized; a player who moves during the
     telegraph is not - the contact frame is what decides. */
  const dodge = await page.evaluate(() => {
    const T = window.__SF;
    const out = {};
    for (const move of [false, true]) {
      T.resetGarner();
      T.teleportToGarner(40);
      T.advanceToGarnerPhase("feeding", 14);
      T.forceGarnerLash(0);
      /* Through the erupt and PAST the point where the limb stops
         tracking, then step aside. This is the window the fight is
         built on: the aim locks halfway through the rear, so a move
         after that must miss and a player who stands still must not. */
      T.advanceTime(1.35, 1 / 60);
      if (move) {
        const ps = T.player.state;
        T._teleportRaw(ps.x + 11, ps.z + 11, 0);
      }
      T.advanceTime(1.2, 1 / 60);
      const g = T.garnerState();
      out[move ? "moved" : "still"] = g.armPhases[0];
    }
    return out;
  });
  check("standing in the strike is seized", dodge.still === "seize", JSON.stringify(dodge));
  check("moving out of it during the telegraph is not",
    dodge.moved !== "seize", JSON.stringify(dodge));

  /* ---- THE MELEE WINDOW ------------------------------------------------ */
  const window_ = await page.evaluate(() => {
    const T = window.__SF;
    T.equipWeapon("glaive");
    const inst = T.enemies.live.find((e) => e.key === "garner");
    /* Where a swing actually LANDED, off the authoritative melee event
       rather than off the limb's own pose. `meleeReachY` is a gate on
       the hit point, so the hit point is the thing to measure. */
    /* Swung from four sides. The limb comes up at a random bearing and
       the Ossuary pan is littered with bone props that are in the
       collision grid, so any ONE approach can legitimately be blocked
       by cover - and a check that fails because the harness happened to
       stand behind a vertebra is measuring the litter. */
    const swingAt = (node) => {
      const ps = T.player.state;
      let best = { dealt: 0, hitY: null, feetY: 0 };
      for (const [ox, oz] of [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]]) {
        T._teleportRaw(node.x + ox, node.z + oz, 0);
        ps.yaw = Math.atan2(node.x - ps.x, node.z - ps.z);
        T.advanceTime(1 / 60, 1 / 60);
        let landed = null;
        const off = T.combat.bus.on("melee", (e) => {
          landed = (e.targets || []).find((t) => t.key === "garner") || null;
        });
        const before = inst.legHp[0];
        T.combat.meleeStrike(1, 2.4, false, 1, 1);
        off();
        const dealt = before - inst.legHp[0];
        if (landed || dealt > best.dealt) {
          best = {
            dealt: Math.max(best.dealt, dealt),
            hitY: landed ? Number(landed.y.toFixed(2)) : best.hitY,
            feetY: Number(ps.y.toFixed(2)),
          };
        }
        if (best.dealt > 0) break;
        best.feetY = Number(ps.y.toFixed(2));
      }
      return best;
    };
    // A limb lying on the sand: reachable, and the hit is at knee height.
    T.forceGarnerArmDown(0);
    T.advanceTime(1 / 60, 1 / 60);
    const down = T.garnerArmNodes(0);
    const flat = swingAt(down[2]);
    /* ...and the same limb raised. Its BASE is still there at ground
       level and a player standing on it may legitimately cut that -
       rushing an erupting limb is a real, dangerous option - but the
       eleven metres of it overhead must never be swingable at. So the
       claim under test is the gate itself: whatever a swing connects
       with, it connects with it BELOW `meleeReachY`. */
    T.forceGarnerLash(0);
    T.advanceTime(1.2, 1 / 60);
    const up = T.garnerArmNodes(0);
    const raised = swingAt(up[2]);
    return { flat, raised, upMidY: Number(up[2].y.toFixed(2)) };
  });
  check("a limb on the sand can be cut along its length", window_.flat.dealt > 0,
    `${window_.flat.dealt} damage at y=${window_.flat.hitY}`);
  check("no swing ever reaches a limb raised over the player's head",
    window_.raised.hitY === null
    || window_.raised.hitY <= window_.raised.feetY + 3.0,
    `mid-span at y=${window_.upMidY}, swing landed at y=${window_.raised.hitY}`);

  /* ---- LIMBS AND THE GORGE --------------------------------------------- */
  const gorge = await page.evaluate(() => {
    const T = window.__SF;
    T.resetGarner();
    T.teleportToGarner(40);
    T.advanceToGarnerPhase("feeding", 14);
    const inst = T.enemies.live.find((e) => e.key === "garner");
    const healthBefore = inst.health;
    /* Cut three limbs through combat.js's own per-limb path - the same
       function a shot or a swing calls - and let the encounter notice. */
    for (let i = 0; i < 3; i += 1) {
      T.forceGarnerLash(i);
      T.advanceTime(0.9, 1 / 60);
      T.breakGarnerArm(i);
      T.advanceTime(0.3, 1 / 60);
    }
    const cut = T.garnerState();
    const reached = T.advanceToGarnerPhase("gorge", 8);
    // A second into the window, because the mouth OPENS into it rather
    // than snapping - the aperture is damped, and reading it on the
    // frame the phase flips measures the transition, not the state.
    T.advanceTime(1.6, 1 / 60);
    const open = T.garnerState();
    const exposed = inst.collapsed;
    // The window ends, and the limbs come back with it.
    const back = T.advanceToGarnerPhase("feeding", 16);
    const after = T.garnerState();
    return {
      severed: cut.armsSevered,
      bonus: healthBefore - inst.health,
      reached, gorging: open.gorging, exposed, mawOpen: open.mawOpen,
      back, regrown: after.armsSevered,
    };
  });
  check("cutting a limb pays real damage into the main pool", gorge.bonus > 0,
    `${Math.round(gorge.bonus)} from three limbs`);
  check("cutting enough limbs forces the gorge window",
    gorge.reached >= 0 && gorge.gorging, JSON.stringify(gorge));
  check("the gorge exposes the mouth as a weak target",
    gorge.exposed && gorge.mawOpen > 0.85, JSON.stringify(gorge));
  check("the limbs regrow when the window closes",
    gorge.back >= 0 && gorge.regrown === 0, JSON.stringify(gorge));
  await page.screenshot({ path: path.join(outDir, "02-gorge.png") });

  /* The mouth is a ranged target in every phase and a melee target
     while the gullet is open - the two halves of HITBOX.garner's
     `bodyBones` capsule. */
  const mouth = await page.evaluate(() => {
    const T = window.__SF;
    const g = T.garnerState();
    const inst = T.enemies.live.find((e) => e.key === "garner");
    const shootIt = () => {
      T._teleportRaw(g.x - 30, g.z, 0);
      T.advanceTime(1 / 60, 1 / 60);
      const ps = T.player.state;
      const o = { x: ps.x, y: ps.y + 1.5, z: ps.z };
      const t = { x: g.x, y: inst.y + 1.0, z: g.z };
      const d = Math.hypot(t.x - o.x, t.y - o.y, t.z - o.z);
      const hp = inst.health;
      const hit = T.combat.fire(o,
        { x: (t.x - o.x) / d, y: (t.y - o.y) / d, z: (t.z - o.z) / d },
        { damage: 40, range: 220 });
      return { legIndex: hit?.legIndex ?? null, weak: !!hit?.weak, dealt: hp - inst.health };
    };
    T.forceGarnerPhase("feeding");
    const feeding = shootIt();
    T.forceGarnerPhase("gorge", 9);
    T.advanceTime(0.6, 1 / 60);
    const gorging = shootIt();
    // ...and a swing from where the animal holds the player off.
    T.equipWeapon("glaive");
    const ps = T.player.state;
    T._teleportRaw(g.x - 40, g.z, 0);
    for (let i = 0; i < 90; i += 1) T.advanceTime(1 / 60, 1 / 60);
    // Walk in until the keep-out wall stops us, then swing at the mouth.
    for (let i = 0; i < 240; i += 1) {
      ps.x += 0.25;
      T.advanceTime(1 / 60, 1 / 60);
    }
    ps.yaw = Math.atan2(g.x - ps.x, g.z - ps.z);
    const held = Math.hypot(ps.x - g.x, ps.z - g.z);
    const hp = T.enemies.live.find((e) => e.key === "garner").health;
    T.combat.meleeStrike(1, 2.4, false, 1, 1);
    const swung = hp - T.enemies.live.find((e) => e.key === "garner").health;
    return { feeding, gorging, held: Number(held.toFixed(2)), swung };
  });
  check("the mouth is a ranged target in every phase",
    mouth.feeding.legIndex === -1 && mouth.feeding.dealt > 0, JSON.stringify(mouth.feeding));
  check("and a WEAK ranged target once the gullet is open",
    mouth.gorging.weak && mouth.gorging.dealt > mouth.feeding.dealt,
    JSON.stringify(mouth.gorging));
  /* THE PAYOFF, and it is an arithmetic contract between two files:
     garner.js's `keepOutScale` decides where the player is stopped and
     combat.js's `bodyRadius` decides whether a lance reaches from
     there. Either one drifting silently turns the gorge window into a
     ranged-only phase. */
  check("the player can reach the open gullet with a polearm from the lip",
    mouth.swung > 0, `held at ${mouth.held}m, dealt ${Math.round(mouth.swung)}`);

  /* ---- NOTHING WALKS OVER THE MOUTH ------------------------------------ */
  const keepOut = await page.evaluate(() => {
    const T = window.__SF;
    T.forceGarnerPhase("feeding");
    const g = T.garnerState();
    const ps = T.player.state;
    T._teleportRaw(g.x - 30, g.z, 0);
    T.advanceTime(1 / 60, 1 / 60);
    // Drive straight at the throat for four seconds.
    for (let i = 0; i < 240; i += 1) {
      ps.x += 0.25;
      T.advanceTime(1 / 60, 1 / 60);
    }
    const held = Math.hypot(ps.x - g.x, ps.z - g.z);
    /* ...and the same walk WHILE it is drawing breath, which is the one
       way in and costs most of a life. Measured over ONE crossing and
       then stopped: left running, the walk loop simply feeds the player
       back into the mouth every time it throws them clear, which kills
       them and measures the respawn instead of the mechanic. */
    /* The damage is read off the authoritative hurt bus and filtered to
       the devour's own source, rather than by differencing the player's
       health. Health is the wrong instrument here: regeneration, the
       Bloom's own wandering castes and a respawn all move it, and any
       of them turns "did the mouth hurt me" into a number that is
       right for the wrong reason. */
    let devourDamage = 0;
    const offHurt = T.combat.bus.on("playerHurt", (e) => {
      if (e.source === "garner-devour") devourDamage += e.damage;
    });
    T.invulnerable(false);
    /* Backed off before the draw starts. Held exactly ON the keep-out
       wall, the very frame the breath begins is a crossing, and the
       swallow is spent before the walk under test starts. */
    T._teleportRaw(g.x - 30, g.z, 0);
    T.forceGarnerInhale();
    T.advanceTime(2.0, 1 / 60);
    const drawing = T.garnerState().inhaling;
    let thrown = Math.hypot(ps.x - g.x, ps.z - g.z);
    let devoured = false;
    for (let i = 0; i < 180; i += 1) {
      ps.x += 0.25;
      T.advanceTime(1 / 60, 1 / 60);
      const d = Math.hypot(ps.x - g.x, ps.z - g.z);
      // The throw itself: the frame the distance jumps back outward.
      if (d > thrown + 3) { thrown = d; devoured = true; break; }
      thrown = d;
    }
    offHurt();
    T.invulnerable(true);
    return {
      held: Number(held.toFixed(2)), thrown: Number(thrown.toFixed(2)),
      hurt: Number(devourDamage.toFixed(1)), drawing, devoured,
    };
  });
  /* Held just outside the collar - close enough to swing into the
     gullet, and never over it. The mouth is 9.1m in radius at its
     widest, so anything under about 9 would be standing inside the
     animal and anything over ~10 is out of a lance's reach. */
  check("the mouth holds the player off its own throat",
    keepOut.held > 9 && keepOut.held < 10.5, `stopped at ${keepOut.held}m`);
  /* Most of a life, and NOT more than one life: the lockout is what
     stops a single bad approach resolving as two or three swallows
     while the same breath is still running. */
  check("reaching the throat while it draws costs a life and a throw clear",
    keepOut.devoured && keepOut.hurt > 30 && keepOut.hurt < 90
    && keepOut.thrown > keepOut.held, JSON.stringify(keepOut));

  /* ---- THE LEASH ------------------------------------------------------- */
  const leash = await page.evaluate(() => {
    const T = window.__SF;
    // From a clean, live fight - the devour test above can leave the
    // player dead and respawned somewhere else entirely.
    T.resetGarner();
    T.combat.player.hp = T.combat.player.maxHp;
    T.teleportToGarner(40);
    T.advanceToGarnerPhase("feeding", 16);
    const inst = T.enemies.live.find((e) => e.key === "garner");
    T.combat.damageEnemy(inst, 2000, { source: "qa-leash" });
    const wounded = inst.health;
    const g = T.garnerState();
    T._teleportRaw(g.x + 200, g.z, 0);
    const sealing = T.advanceToGarnerPhase("sealing", 22);
    const healed = inst.health;
    const dormant = T.advanceToGarnerPhase("dormant", 14);
    const back = T.garnerState();
    return {
      wounded, sealing, healed, dormant,
      open: back.open, phase: back.phase, max: inst.maxHealth,
    };
  });
  check("leaving the arena seals the pit", leash.sealing >= 0 && leash.dormant >= 0,
    JSON.stringify(leash));
  check("the leash heals it on the spot and closes the pan",
    leash.healed === leash.max && leash.open === 0, JSON.stringify(leash));

  const reaggro = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToGarner(40);
    const secs = T.advanceToGarnerPhase("feeding", 18);
    return { secs, free: !!T.player.state.free };
  });
  check("a fresh approach opens it again, without a second camera steal",
    reaggro.secs >= 0 && !reaggro.free, JSON.stringify(reaggro));

  /* ---- SAVE / RESTORE -------------------------------------------------- */
  const saved = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "garner");
    T.forceGarnerLash(2);
    T.advanceTime(0.9, 1 / 60);
    T.breakGarnerArm(2);
    T.advanceTime(0.4, 1 / 60);
    T.combat.damageEnemy(inst, 1500, { source: "qa-save" });
    const before = T.garnerState();
    const captured = T.saves.capture();
    /* Move the world away from the saved point first, so a restore that
       silently did nothing cannot pass by accident. */
    T.combat.damageEnemy(inst, 900, { source: "qa-drift" });
    T.advanceTime(1.2, 1 / 60);
    const accepted = !!captured && T.saves.apply(captured);
    const after = T.garnerState();
    return { accepted: !!accepted, before, after };
  });
  check("the encounter survives a save/restore round trip",
    saved.accepted && saved.after && saved.after.phase === saved.before.phase
    && saved.after.health === saved.before.health
    && saved.after.armsSevered === saved.before.armsSevered,
    JSON.stringify({ before: saved.before?.phase, after: saved.after?.phase,
      hp: [saved.before?.health, saved.after?.health],
      cut: [saved.before?.armsSevered, saved.after?.armsSevered] }));

  /* ---- DEATH ----------------------------------------------------------- */
  const death = await page.evaluate(() => {
    const T = window.__SF;
    T.resetGarner();
    /* Alive and at full health first. The devour check above deliberately
       drops invulnerability, and a dead player is one the pit will not
       wake up for - `stepInstance` refuses to breach for a corpse. */
    T.invulnerable(true);
    T.combat.player.dead = false;
    T.combat.player.hp = T.combat.player.maxHp;
    T.teleportToGarner(40);
    T.advanceToGarnerPhase("feeding", 16);
    // Belt and braces: the kill is what is under test, not the approach.
    if (T.garnerState().phase !== "feeding") T.forceGarnerPhase("feeding");
    const inst = T.enemies.live.find((e) => e.key === "garner");
    let defeated = null;
    const off = T.garner.bus.on("defeated", (e) => { defeated = e; });
    T.combat.damageEnemy(inst, 999999, { source: "qa" });
    for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);
    off();
    return { state: T.garnerState(), defeated: !!defeated };
  });
  check("lethal damage kills it and the encounter reports it",
    death.state.dead && death.defeated, JSON.stringify(death.state?.phase));

  /* ---- COST ------------------------------------------------------------ */
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    T.resetGarner();
    T.teleportToGarner(30);
    T.advanceToGarnerPhase("feeding", 16);
    // The worst frame this encounter has: every limb live, the mouth
    // working, and a volley of shards in the air.
    for (let i = 0; i < 6; i += 1) T.forceGarnerLash(i);
    T.forceGarnerVolley();
    const N = 150;
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) T.renderOnce(1 / 60, true);
    const ms = (performance.now() - t0) / N;
    return {
      msPerFrame: Number(ms.toFixed(2)),
      draws: T.report().render,
      state: T.garnerState(),
    };
  });
  check("every limb live at once still renders inside budget",
    cost.msPerFrame < 9,
    `${cost.msPerFrame}ms/frame, ${cost.draws.calls} draw calls, ${cost.state.armsUp} limbs up`);

  const realConsoleErrors = consoleErrors.filter((message) =>
    !/jsdelivr|unpkg|favicon|Failed to load resource/i.test(message));
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  check("no failed game-asset requests", assetFailures.length === 0,
    assetFailures.slice(0, 5).join(" | "));
  check("no console errors", realConsoleErrors.length === 0,
    realConsoleErrors.slice(0, 5).join(" | "));

  await writeFile(path.join(outDir, "report.json"),
    JSON.stringify({ results, failed, cost }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  console.log(`Report: ${path.join(outDir, "report.json")}`);
  await browser.close();
} finally {
  server.kill();
}

process.exitCode = failed ? 1 : 0;
