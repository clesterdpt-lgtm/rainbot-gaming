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
      maxHealth: w?.maxHealth,
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
  check("the expanded Winnower pool is live", rig.maxHealth === 7800,
    `${rig.maxHealth} max health`);

  /* ---- AGGRO -------------------------------------------------------- */
  const far = await page.evaluate(() => {
    const T = window.__SF;
    const w = T.winnowerState();
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    // Outside the 78m arena gate but inside the 180m minimap range.
    T._teleportRaw(w.x - 110, w.z, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
    const healthBefore = inst.health;
    const dealt = T.combat.damageEnemy(inst, 100, { source: "qa-pre-fight" });
    const minimapContacts = T.minimapState()?.contacts || [];
    return {
      phase: T.winnowerState().phase,
      hidden: !inst.root.visible,
      minimapHidden: !minimapContacts.some((contact) => contact.species === "winnower"),
      targetable: T.combat.targetable(inst),
      dealt,
      healthBefore,
      healthAfter: inst.health,
    };
  });
  check("ignores the player outside the aggro radius", far.phase === "dormant",
    `phase=${far.phase}`);
  check("the dormant boss cannot be seen before the Censer Works arena",
    far.hidden && far.minimapHidden, JSON.stringify(far));
  check("the dormant boss cannot be damaged before the Censer Works arena",
    !far.targetable && far.dealt === 0 && far.healthAfter === far.healthBefore,
    JSON.stringify(far));

  const aggroStart = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToWinnower(40);
    const secs = T.advanceToWinnowerPhase("alert", 5);
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    const visibleAtReveal = inst.root.visible;
    const healthBefore = inst.health;
    const revealDamage = T.combat.damageEnemy(inst, 100, { source: "qa-reveal" });
    const protectedAtReveal = !T.combat.targetable(inst)
      && revealDamage === 0 && inst.health === healthBefore;
    // Draw the authored reveal camera before Playwright captures it.
    T.renderOnce(1 / 60);
    return {
      secs,
      visibleAtReveal,
      protectedAtReveal,
      revealBudget: T.winnower.config.alertSeconds,
    };
  });
  await page.screenshot({ path: path.join(outDir, "winnower-reveal.png") });
  const aggroEnd = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    let revealSeconds = 0;
    let cameraSeconds = 0;
    let cameraStayedOn = true;
    while (T.winnowerState().phase === "alert" && revealSeconds < 10) {
      if (T.player.state.free) cameraSeconds += 1 / 60;
      else cameraStayedOn = false;
      T.renderOnce(1 / 60);
      revealSeconds += 1 / 60;
    }
    return {
      revealSeconds: Number(revealSeconds.toFixed(2)),
      cameraSeconds: Number(cameraSeconds.toFixed(2)),
      cameraStayedOn,
      state: T.winnowerState(),
      freeAfter: !!T.player.state.free,
      targetableAfter: T.combat.targetable(inst),
      visibleAfter: inst.root.visible,
    };
  });
  const aggro = { ...aggroStart, ...aggroEnd };
  check("crossing the aggro radius wakes it into flight",
    aggro.secs >= 0 && aggro.state.phase === "soar", `${aggro.secs}s`);
  check("the reveal shows the boss but protects it until combat begins",
    aggro.visibleAtReveal && aggro.protectedAtReveal, JSON.stringify(aggro));
  check("the Censer Works reveal holds the cinematic camera for at least four seconds",
    aggro.revealBudget >= 4 && aggro.cameraStayedOn && aggro.cameraSeconds > 0,
    `${aggro.revealBudget}s reveal; camera held through ${aggro.cameraSeconds}s after capture`);
  check("the reveal hands back a visible, targetable soaring fight",
    !aggro.freeAfter && aggro.targetableAfter && aggro.visibleAfter,
    JSON.stringify(aggro));

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

  const bombardGrowth = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.winnower.instance();
    const counts = [];
    const off = T.winnower.bus.on("bombard", (e) => { counts.push(e.count); });
    const fireAt = (fraction) => {
      T.forceWinnowerPhase("soar", 20);
      inst.health = inst.maxHealth * fraction;
      T.winnower.primeBombard();
      T.advanceTime(T.winnower.config.bombardContact + 0.08, 1 / 60);
      return counts[counts.length - 1];
    };
    const full = fireAt(1);
    T.advanceTime(2.3, 1 / 60);
    const brink = fireAt(0.08);
    off();
    return { full, brink, max: T.winnower.config.bombardCountRoused };
  });
  check("its bombard grows as the health bar is spent",
    bombardGrowth.full === 4 && bombardGrowth.brink === bombardGrowth.max
      && bombardGrowth.brink > bombardGrowth.full,
    JSON.stringify(bombardGrowth));

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

  /* ---- THE RING AND THE LEASH -----------------------------------------
     TWO DIFFERENT PROMISES, AND THEY FIRE IN A FIXED ORDER.

     The Censer Works carries a 98m arena ring (district-bosses.js) and
     the animal carries its own 300m/16s disengage. A player who walks
     away crosses the ring first, always - 98 is a long way inside 300 -
     so the RING is what production actually runs, and the module's
     leash is the fallback for the cases the boundary machinery is not
     watching: a save restored mid-flight, or a site it has stood down.
     That order is by design and is the same one the Garner records.

     This section used to assert only the second one, and it did it by
     teleporting the player 600m out and waiting for `return`. That can
     never happen: the ring reset lands at metre 98 and snaps the animal
     home dormant before the disengage timer has counted a single
     second, so the check measured the ring, called it the leash, and
     failed. Both are asserted now, and separately. */
  const ring = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    const site = T.mission.bosses.find((b) => b.key === "censer");
    // A clean live fight, walked into rather than forced, then wounded.
    T.winnower.resetToPerch();
    T.teleportToWinnower(40);
    T.advanceToWinnowerPhase("soar", 30);
    inst.health = inst.maxHealth * 0.35;
    // Step out over the ring, the way a player leaving the district does.
    T._teleportRaw(site.x + site.arenaRadius + 40, site.z, 0);
    for (let f = 0; f < 60 * 4; f += 1) T.renderOnce(1 / 60);
    const st = T.winnowerState();
    return {
      phase: st.phase, hidden: st.hidden,
      healed: st.health === st.maxHealth && st.lift === st.maxLift,
      siteDist: Number(Math.hypot(st.x - site.x, st.z - site.z).toFixed(0)),
    };
  });
  check("crossing the arena ring resets the fight and sends it home healed",
    ring.phase === "dormant" && ring.healed && ring.hidden,
    JSON.stringify(ring));

  const leash = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    const site = T.mission.bosses.find((b) => b.key === "censer");
    const C = T.winnower.config;
    /* STAND THE RING DOWN, or this measures the ring a second time.
       `updateArenaBoundaries` skips a site whose mission boss is
       already finished, and that flag is the only switch it has. */
    const wasDone = site.done;
    site.done = true;
    try {
      T.winnower.resetToPerch();
      T.teleportToWinnower(40);
      T.advanceToWinnowerPhase("soar", 30);
      inst.health = inst.maxHealth * 0.35;

      /* WHERE THE PLAYER STANDS, measured from the TERRITORY rather
         than from the animal - because both ends of the window that
         makes this test possible are. It must be far enough that the
         boss, which patrols the territory boundary NEAREST the player
         instead of chasing, still sits outside its own 300m disengage;
         and near enough that the whole flight home stays inside the
         700m simRange gate, or `update` returns early and the animal
         freezes in mid-air and never arrives. That leaves roughly
         564..668m from the centroid, and this is the middle of it. */
      const tx = C.stacks.reduce((a, s) => a + s.x, 0) / C.stacks.length;
      const tz = C.stacks.reduce((a, s) => a + s.z, 0) / C.stacks.length;
      T._teleportRaw(tx + 610, tz, 0);

      let sawReturn = false;
      let healedAtStart = false;
      let roam = 0;
      let secs = null;
      for (let f = 0; f < 60 * 75; f += 1) {
        T.renderOnce(1 / 60);
        const st = T.winnowerState();
        // How far it ever gets from the works it is supposed to patrol.
        roam = Math.max(roam, Math.hypot(st.x - tx, st.z - tz));
        if (st.phase === "return" && !sawReturn) {
          sawReturn = true;
          healedAtStart = st.health === st.maxHealth && st.lift === st.maxLift;
        }
        if (sawReturn && st.phase === "dormant") { secs = f / 60; break; }
      }
      const st = T.winnowerState();
      return {
        sawReturn, healedAtStart, done: secs !== null,
        secs: secs === null ? null : Number(secs.toFixed(1)),
        phase: st.phase,
        roam: Number(roam.toFixed(0)),
        territory: C.territoryRadius + C.orbitRadius,
        perchDist: Number(Math.hypot(st.x - site.x, st.z - site.z).toFixed(0)),
      };
    } finally {
      site.done = wasDone;
    }
  });
  check("it will not follow a leaving player out of its territory",
    leash.roam <= leash.territory + 12,
    `roamed ${leash.roam}m from the works; territory+orbit is ${leash.territory}m`);
  check("abandoned, it heals in the air and flies home",
    leash.sawReturn && leash.healedAtStart, JSON.stringify(leash));
  check("the flight home ends dormant at the perch", leash.done === true,
    `${leash.secs}s`);

  /* ---- COST --------------------------------------------------------------
     MEASURED ON A LIVE FIGHT, AND IT HAS ITS OWN SETUP. Both halves of
     that are the point.

     This check inherited whatever state the section above it happened
     to leave, and for most of this file's life that was an empty
     district: the leash section left the animal gated - hidden, never
     drawn - the death section then failed to kill something it could
     not touch, and the budget was measured on a frame with no
     encounter in it. 82 draw calls, against the ~126 a drawn one costs.
     So the number moved whenever anything above it was fixed, which is
     the opposite of what a budget is for.

     It runs BEFORE the death section because this is the only place a
     LIVE Winnower can be measured: `resetToPerch` heals the animal but
     does not un-kill it, so once the corpse exists every later setup
     silently measures a corpse.

     THE THRESHOLD IS LEFT AT 9ms - the same one the Distaff, the Garner
     and the Stylite are held to - and the encounter does not currently
     meet it: about 10.3ms, against the Stylite's 5.6ms on the same
     machine and with FEWER draw calls, which points at fill rather than
     at the scene graph. That is a real result and it is left visible.
     Picking a threshold that happens to pass would only re-hide what
     this check spent its whole life failing to see. */
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    T.winnower.resetToPerch();
    T.teleportToWinnower(40);
    T.advanceToWinnowerPhase("soar", 30);
    T.forceWinnowerPhase("soar", 60);
    // Long enough for the bombard cadence to put real ash on the sand.
    for (let i = 0; i < 60 * 8; i += 1) T.renderOnce(1 / 60);
    const N = 150;
    const batches = [];
    for (let b = 0; b < 5; b += 1) {
      const t0 = performance.now();
      for (let i = 0; i < N; i += 1) T.renderOnce(1 / 60, true);
      batches.push(Number(((performance.now() - t0) / N).toFixed(2)));
    }
    const ms = batches.slice().sort((a, b) => a - b)[Math.floor(batches.length / 2)];
    const w = T.winnowerState();
    return {
      msPerFrame: Number(ms.toFixed(2)), batches, draws: T.report().render,
      phase: w.phase, hidden: w.hidden, ashFields: w.ashFields, embers: w.embers,
    };
  });
  check("the encounter renders inside budget", cost.msPerFrame < 9 && !cost.hidden,
    `${cost.msPerFrame}ms/frame over ${cost.draws.calls} draw calls with `
    + `${cost.ashFields} ash fields live in phase ${cost.phase} `
    + `(batches ${cost.batches.join("/")})`);

  /* ---- DEATH ------------------------------------------------------------ */
  const death = await page.evaluate(() => {
    const T = window.__SF;
    /* FROM A CLEAN, LIVE FIGHT, and the reason is the section above.
       The leash leaves the player 600m out with the animal asleep at
       its perch - and an animal that has gone back to sleep is GATED:
       hidden and damage-locked. Lethal damage fired at it from out
       there is silently absorbed, nothing dies, and the two checks
       below fail describing a corpse that would not fall when the real
       fault was that it was never killed. Walking back in first is the
       difference. */
    T.winnower.resetToPerch();
    T.teleportToWinnower(40);
    T.advanceToWinnowerPhase("soar", 30);
    T.forceWinnowerPhase("soar", 60);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
    const before = T.winnowerState();
    const inst = T.enemies.live.find((e) => e.key === "winnower");
    let crashed = null;
    const off = T.winnower.bus.on("crash", (e) => { crashed = e; });
    const dealt = T.combat.damageEnemy(inst, 999999, { source: "qa" });
    for (let i = 0; i < 240; i += 1) T.renderOnce(1 / 60);
    off();
    const w = T.winnowerState();
    return {
      airborne: before.altitude, locked: before.locked, hidden: before.hidden, dealt,
      finalAltitude: w.altitude, dead: w.dead, crashed: !!crashed,
    };
  });
  check("a kill in the air brings the body down", death.dead && death.finalAltitude < 1.5,
    `${death.airborne}m -> ${death.finalAltitude}m (${JSON.stringify(death)})`);
  check("the impact is reported", death.crashed);

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
