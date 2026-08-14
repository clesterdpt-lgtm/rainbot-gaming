#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Winnower encounter regression

   Proves the player-facing promises of the Censer Works' flyer, and
   one of them matters more than all the others put together:

     THE MELEE WINDOW ARRIVES ON ITS OWN. A player who owns nothing
     but a censer-lance must get a reachable, grounded boss on a
     timer, without landing a single shot on it. That guarantee has
     already been broken once by a plausible-looking refactor - every
     strafing run re-entered `soar`, which reset the phase timer, so
     the furnace refilled itself every twelve seconds and the animal
     never came down. The check below would have caught it, and it is
     the reason this file exists.

   Also covered: that it genuinely flies (and is unreachable while it
   does), that shooting the heat sacs buys the window early, that a
   kill in the air arrives on the ground, and that it renders inside
   budget with its hazards live.

   Usage:
     node scripts/saintfall-winnower-fight.mjs [--out output/path]
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
const outDir = path.resolve(root, args.out || "output/saintfall/winnower-fight");
const port = 52600 + (process.pid % 5000);
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
  /* Failed requests are tracked BY URL rather than by console text.
     The browser logs its own "Failed to load resource: ... 404" line
     with no URL in it, so a text filter cannot tell a flaky CDN probe
     from a genuinely missing game asset - and boot.js deliberately
     probes jsdelivr before falling back to unpkg, so that line shows
     up intermittently on a perfectly healthy run. Same-origin
     failures are the ones that mean something. */
  const assetFailures = [];
  const sameOrigin = (url) => url.startsWith(base);
  page.on("response", (response) => {
    if (response.status() >= 400 && sameOrigin(response.url())) {
      assetFailures.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (sameOrigin(request.url())) {
      assetFailures.push(`failed ${request.url()}`);
    }
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
  });

  /* ---- RIG --------------------------------------------------------- */
  const rig = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(true);
    const w = T.winnowerState();
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    return {
      spawned: !!w,
      phase: w?.phase,
      airborne: w?.altitude,
      grounded: w?.grounded,
      bones: ["thorax", "head", "heart", "wing0_L", "wing2_R",
        "censer0", "censer2",
        // The insect anatomy: second wing pair, gaster, antennae, a
        // third leg pair. Their absence is the difference between an
        // insect and an aircraft.
        "hindwing_L", "hindwing_R", "abdomen1", "abdomen2",
        "antenna_L", "antenna_R", "perch2_L", "perch2b_R",
      ].every((n) => inst?.bones?.has(n)),
      /* "sweep" is listed because it once existed in the model and
         NOT here - and this list is what makes clips into actions, so
         the grounded attack animated nothing and nothing failed. */
      clips: ["idle", "alert", "bombard", "strain", "land", "stoke",
        "launch", "sweep", "flinch", "death"].every((c) => inst?.actions?.has(c)),
      lift: w?.lift,
      // No leg chains: a flyer's limbs are owned by its clips.
      legs: inst?.legs?.length,
    };
  });
  check("spawns once, dormant, and already in the air",
    rig.spawned && rig.phase === "dormant" && rig.airborne > 15,
    `${rig.airborne}m up`);
  check("named body, wing and censer bones resolve", rig.bones);
  check("every authored clip loaded", rig.clips);
  check("carries no IK leg chains", rig.legs === 0);
  check("starts with a full lift pool", rig.lift > 0, `lift=${rig.lift}`);

  /* ---- AGGRO -------------------------------------------------------- */
  const far = await page.evaluate(() => {
    const T = window.__SF;
    const w = T.winnowerState();
    T._teleportRaw(w.x - 220, w.z, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
    return T.winnowerState().phase;
  });
  check("ignores the player outside the aggro radius", far === "dormant", `phase=${far}`);

  const aggro = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToWinnower(40);
    const secs = T.advanceToWinnowerPhase("soar", 20);
    return { secs, state: T.winnowerState() };
  });
  check("crossing the aggro radius wakes it into flight",
    aggro.secs >= 0 && aggro.state.phase === "soar", `${aggro.secs}s`);

  /* ---- UNREACHABLE WHILE AIRBORNE ------------------------------------ */
  const unreachable = await page.evaluate(() => {
    const T = window.__SF;
    T.autoStow(false);
    const w = T.winnowerState();
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    // Stand directly underneath it and swing.
    T._teleportRaw(w.x, w.z, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
    const before = inst.health;
    T.pressMelee();
    T.renderOnce(1 / 60);
    for (let i = 0; i < 35; i += 1) T.renderOnce(1 / 60);
    return { altitude: T.winnowerState().altitude, dealt: before - inst.health };
  });
  check("a lance cannot reach it while it flies",
    unreachable.dealt === 0 && unreachable.altitude > 10,
    `${unreachable.altitude}m up, ${unreachable.dealt} dealt`);

  /* ---- AIRBORNE ATTACKS ---------------------------------------------- */
  const attacks = await page.evaluate(() => {
    const T = window.__SF;
    const ev = { bombard: 0, ash: 0, strafeTelegraph: 0, landing: 0, stoke: 0 };
    const offs = Object.keys(ev).map((k) => T.winnower.bus.on(k, () => { ev[k] += 1; }));
    for (let i = 0; i < 1500; i += 1) T.renderOnce(1 / 60); // 25s
    offs.forEach((f) => f());
    return ev;
  });
  check("it bombards from the air", attacks.bombard > 0, JSON.stringify(attacks));
  check("bombardment leaves burning ground", attacks.ash > 0);
  check("it makes strafing runs", attacks.strafeTelegraph > 0);

  /* ---- THE GUARANTEE -------------------------------------------------
     The single most important check in this file: the window arrives
     on a timer, with the player doing nothing at all. */
  check("the furnace burns down and it lands WITHOUT being shot",
    attacks.landing > 0 && attacks.stoke > 0,
    `${attacks.landing} landings, ${attacks.stoke} stokes in 25s`);

  const window = await page.evaluate(() => {
    const T = window.__SF;
    const secs = T.advanceToWinnowerPhase("stoke", 45);
    const w = T.winnowerState();
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    T._teleportRaw(w.x, w.z - 3.0, 0);
    T.setBodyHeading(0);
    T.renderOnce(1 / 60);
    const before = inst.health;
    T.pressMelee();
    T.renderOnce(1 / 60);
    for (let i = 0; i < 35; i += 1) T.renderOnce(1 / 60);
    return {
      secs, altitude: w.altitude, grounded: w.grounded,
      dealt: before - inst.health,
    };
  });
  /* It STANDS on its landing limbs rather than lying on its belly -
     see `landedLift` - so "down" is a body a couple of metres up with
     its gut at knee height, not a body at zero. */
  check("the grounded window puts it within a lance's reach",
    window.grounded && window.altitude < 3.2, `body ${window.altitude}m up`);
  check("melee connects during the window", window.dealt > 0, `${window.dealt} dealt`);

  /* ---- THE LIFT POOL -------------------------------------------------- */
  const stall = await page.evaluate(() => {
    const T = window.__SF;
    // Put it back up with a full tank, then shoot the sacs out.
    T.forceWinnowerPhase("soar", 60);
    T.teleportToWinnower(40);
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
    const beforeLift = T.winnowerState().lift;
    let burstEvents = 0;
    const off = T.combat.bus.on("liftDrained", (e) => { if (e.burst) burstEvents += 1; });
    for (let i = 0; i < 4; i += 1) T.drainWinnowerLift(1, i % 2);
    const secs = T.advanceToWinnowerPhase("stoke", 25);
    off();
    const w = T.winnowerState();
    /* THE CRASH IS THE REWARD: it arrives KNOCKED OUT. Stand right
       beside it through the whole grace window and count what it does
       back - the answer must be nothing: no sweeps, no damage. */
    T._teleportRaw(w.x + 4, w.z, 0);
    T.setBodyHeading(0);
    let sweepsDuringStun = 0;
    let stunFrames = 0;
    const offSweep = T.winnower.bus.on("sweepTelegraph", () => {
      if (T.winnowerState().stunned) sweepsDuringStun += 1;
    });
    const hpAtCrash = T.combat.player.hp;
    for (let i = 0; i < 60 * 6; i += 1) {
      T.renderOnce(1 / 60);
      if (T.winnowerState().stunned) stunFrames += 1;
    }
    offSweep();
    return {
      beforeLift, secs, stalled: w.stalled, grounded: w.grounded, burstEvents,
      stunnedAtLanding: w.stunned,
      stunSecs: Number((stunFrames / 60).toFixed(2)),
      sweepsDuringStun,
      hpLost: hpAtCrash - T.combat.player.hp,
    };
  });
  check("draining the lift pool forces an early landing",
    stall.secs >= 0 && stall.secs < 18 && stall.grounded,
    `${stall.secs}s after a full drain`);
  check("a forced landing is a STALL, not a chosen stoke", stall.stalled);
  check("the crash arrives knocked out - a free window, not a trade",
    stall.stunnedAtLanding && stall.stunSecs > 3.2 && stall.sweepsDuringStun === 0,
    `${stall.stunSecs}s stunned, ${stall.sweepsDuringStun} sweeps`);
  check("the crash itself never damages the player", stall.hpLost === 0,
    `${stall.hpLost} hp lost standing beside it`);
  check("heat sacs burst as the pool empties", stall.burstEvents > 0,
    `${stall.burstEvents} bursts`);

  const refuel = await page.evaluate(() => {
    const T = window.__SF;
    const secs = T.advanceToWinnowerPhase("soar", 40);
    const w = T.winnowerState();
    return { secs, lift: w.lift, sacBurst: w.sacBurst, fuel: w.fuel };
  });
  check("it re-lights and repairs its sacs only after taking off again",
    refuel.secs >= 0 && refuel.lift > 0 && refuel.sacBurst.every((b) => !b),
    `lift=${refuel.lift}, fuel=${refuel.fuel}`);

  /* ---- GEOMETRY CONTRACTS --------------------------------------------
     Three defects shipped in one build because nothing asserted that
     the ART and the RULES agreed: the heat sacs had hit volumes and
     no geometry, the heart's hit sphere sat a metre below the visible
     furnace, and every censer hung four metres underground whenever
     the animal landed. All three were invisible to a behavioural
     test and obvious in a screenshot, so they are pinned here. */
  const contracts = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    const box = T.combat.hitbox.winnower;
    const V3 = (b) => b.getWorldPosition(
      new (Object.getPrototypeOf(b.position).constructor)());
    T.forceWinnowerPhase("stoke", 30);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
    const ground = T.collide.groundHeight(inst.x, inst.z);

    // Every censer bowl, at its lowest authored point, while landed.
    let lowestCenser = Infinity;
    for (let k = 0; k < 3; k += 1) {
      const bone = inst.bones.get(`censer${k}c`);
      if (bone) lowestCenser = Math.min(lowestCenser, V3(bone).y - ground);
    }
    /* The heart check is FUNCTIONAL now: the game reads the hit
       sphere off the live bone, so the only honest assertion is to
       fire at the visible furnace and require the weak hit. */
    const heartBone = inst.bones.get("heart");
    const heartWorld = heartBone ? V3(heartBone) : null;
    /* From the FRONT - the angle a player in the window actually
       has. Fired from behind, the ray crosses seven metres of gaster
       first and the gaster correctly wins; that is the game being
       right, not the heart being wrong. */
    let heartHit = null;
    if (heartWorld) {
      const fx = Math.sin(inst.yaw);
      const fz = Math.cos(inst.yaw);
      heartHit = T.combat.raycastEnemies(
        heartWorld.x + fx * 24, heartWorld.y, heartWorld.z + fz * 24,
        -fx, 0, -fz, 60);
    }
    return {
      lowestCenser: Number(lowestCenser.toFixed(2)),
      heartBoneAboveGround: heartWorld ? Number((heartWorld.y - ground).toFixed(2)) : null,
      heartHit: !!heartHit,
      heartWeak: heartHit ? heartHit.weak : null,
    };
  });

  /* Fired at the sacs where they can actually be SEEN, rather than
     comparing two sets of coordinates - a coordinate check passes the
     moment both sides read the same wrong number, and what matters is
     that a player aiming at the visible bladder hits it. */
  const sacAim = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    T.forceWinnowerPhase("soar", 60);
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
    const out = [];
    for (const name of ["sac_L", "sac_R"]) {
      const bone = inst.bones.get(name);
      if (!bone) { out.push({ name, hit: false, reason: "no bone" }); continue; }
      bone.updateWorldMatrix(true, false);
      const w = bone.getWorldPosition(
        new (Object.getPrototypeOf(bone.position).constructor)());
      // Straight down onto the visible bladder from well above it.
      const hit = T.combat.fire({ x: w.x, y: w.y + 40, z: w.z },
        { x: 0, y: -1, z: 0 }, { damage: 1 });
      out.push({
        name,
        hit: !!hit,
        sacIndex: hit ? hit.sacIndex : null,
        onSac: !!hit && hit.sacIndex >= 0,
      });
    }
    return out;
  });
  check("a shot at the VISIBLE heat sac registers as a sac hit",
    sacAim.every((r) => r.onSac), JSON.stringify(sacAim));

  check("the censers stay above ground while it is landed",
    contracts.lowestCenser > -0.4, `lowest bowl ${contracts.lowestCenser}m`);
  check("a shot at the visible furnace lands as the weak hit",
    contracts.heartHit && contracts.heartWeak === true,
    `bone ${contracts.heartBoneAboveGround}m up`);

  /* The gaster: seven metres of glowing abdomen must be shootable. */
  const gaster = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    T.forceWinnowerPhase("soar", 40);
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
    const bone = inst.bones.get("abdomen2");
    bone.updateWorldMatrix(true, false);
    const w = bone.getWorldPosition(
      new (Object.getPrototypeOf(bone.position).constructor)());
    const hpBefore = inst.health;
    const hit = T.combat.fire({ x: w.x, y: w.y + 40, z: w.z },
      { x: 0, y: -1, z: 0 }, { damage: 60 });
    return {
      hit: !!hit, weak: hit ? hit.weak : null, sacIndex: hit ? hit.sacIndex : null,
      dealt: Number((hpBefore - inst.health).toFixed(0)),
    };
  });
  check("a shot at the glowing gaster lands as plain body damage",
    gaster.hit && gaster.dealt > 0 && gaster.weak === false && gaster.sacIndex < 0,
    JSON.stringify(gaster));

  /* ---- THE LEASH AND THE TERRITORY ----------------------------------- */
  const leash = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    inst.health = inst.maxHealth * 0.35;
    T.forceWinnowerPhase("soar", 30);
    const start = { x: inst.x, z: inst.z };
    T._teleportRaw(inst.x + 600, inst.z, 0);
    let sawReturn = false;
    let healedAtStart = false;
    let maxChase = 0;
    for (let f = 0; f < 60 * 60; f += 1) {
      T.renderOnce(1 / 60);
      const st = T.winnowerState();
      const chase = Math.hypot(T.player.state.x - st.x, T.player.state.z - st.z);
      maxChase = Math.max(maxChase, 600 - chase);
      if (st.phase === "return" && !sawReturn) {
        sawReturn = true;
        healedAtStart = st.health === st.maxHealth && st.lift === st.maxLift;
      }
      if (sawReturn && st.phase === "dormant") {
        return {
          sawReturn, healedAtStart, done: true,
          secs: Number((f / 60).toFixed(1)), maxChase: Number(maxChase.toFixed(0)),
        };
      }
    }
    void start;
    return { sawReturn, healedAtStart, done: false,
      phase: T.winnowerState().phase, maxChase: Number(maxChase.toFixed(0)) };
  });
  check("it will not follow a leaving player out of its territory",
    leash.maxChase < 420, `closed at most ${leash.maxChase}m of a 600m retreat`);
  check("abandoned, it heals in the air and flies home",
    leash.sawReturn && leash.healedAtStart, JSON.stringify(leash));
  check("the flight home ends dormant at the perch", leash.done === true,
    `${leash.secs}s`);

  /* ---- DEATH ------------------------------------------------------------ */
  const death = await page.evaluate(() => {
    const T = window.__SF;
    T.forceWinnowerPhase("soar", 60);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
    const airborne = T.winnowerState().altitude;
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    let crashed = null;
    const off = T.winnower.bus.on("crash", (e) => { crashed = e; });
    T.combat.damageEnemy(inst, 999999, { source: "qa" });
    for (let i = 0; i < 240; i += 1) T.renderOnce(1 / 60);
    off();
    const w = T.winnowerState();
    return { airborne, finalAltitude: w.altitude, dead: w.dead, crashed: !!crashed };
  });
  check("a kill in the air brings the body down", death.dead && death.finalAltitude < 1.5,
    `${death.airborne}m -> ${death.finalAltitude}m`);
  check("the impact is reported", death.crashed);

  /* ---- COST -------------------------------------------------------------- */
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    const N = 150;
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) T.renderOnce(1 / 60, true);
    const ms = (performance.now() - t0) / N;
    return { msPerFrame: Number(ms.toFixed(2)), draws: T.report().render };
  });
  check("the encounter renders inside budget", cost.msPerFrame < 9,
    `${cost.msPerFrame}ms/frame, ${cost.draws.calls} draw calls`);

  /* Console text is filtered only for the CDN probe's own noise;
     what actually gates the run is `assetFailures`, which is
     origin-scoped and therefore cannot be flaky. */
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
