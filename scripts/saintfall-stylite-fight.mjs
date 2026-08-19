#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Stylite encounter regression

   Proves the player-facing promises of the Choir's tenant:
     - it perches on the district's REAL needles, read from the world
       builder, high enough that the fight is vertical;
     - it ignores the player until they cross the aggro radius, and
       cannot be seen or damaged before it;
     - it rakes the ground with a led, travelling barrage rather than
       a hitscan tax;
     - it LEAPS: a visible coil, an arc that clears both crowns, and a
       landing on a different needle;
     - it STOOPS at a player who stands out of its arc;
     - THE GRIP is a second pool, worn only by damage landed while it
       is perched, and emptying it drops the animal off the rock;
     - the fall hurts IT - a real chunk of its own health - and leaves
       it stunned on the ground;
     - while perched no melee swing can touch it, and while grounded a
       swing is worth nearly three times a rifle shot;
     - the leash, a save/restore round trip, death, and the budget.

   Usage:
     node scripts/saintfall-stylite-fight.mjs [--out output/path]
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
const outDir = path.resolve(root, args.out || "output/saintfall/stylite-fight");
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
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  const assetFailures = [];
  const sameOrigin = (url) => url.startsWith(base);
  page.on("response", (r) => {
    if (r.status() >= 400 && sameOrigin(r.url())) assetFailures.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    if (sameOrigin(r.url())) assetFailures.push(`failed ${r.url()}`);
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
  });

  /* ---- THE ROSTER ------------------------------------------------------ */
  const roster = await page.evaluate(() => {
    const T = window.__SF;
    const by = (k) => T.ctx.mission.bosses.find((b) => b.key === k);
    return {
      choir: by("choir")?.enemyKey,
      choirName: by("choir")?.boss,
      reach: by("reach")?.enemyKey,
      reachName: by("reach")?.boss,
      generic: T.ctx.districtBosses.status().map((b) => b.key),
    };
  });
  check("the Choir Spires holds the Stylite",
    roster.choir === "stylite" && roster.choirName === "The Stylite",
    JSON.stringify(roster.choir));
  check("the Gilded Reach holds the Matriarch",
    roster.reach === "matriarch" && roster.reachName === "The Matriarch",
    JSON.stringify(roster.reach));
  check("the Choir left the shared-simulation roster",
    !roster.generic.includes("choir") && roster.generic.includes("reach"),
    roster.generic.join(" · "));

  /* ---- RIG ------------------------------------------------------------- */
  const rig = await page.evaluate(() => {
    const T = window.__SF;
    const s = T.styliteState();
    const inst = T.enemies.live.find((e) => e.key === "stylite");
    const perches = T.stylitePerches();
    return {
      spawned: !!s, phase: s?.phase, maxHealth: s?.maxHealth,
      perches: perches.length,
      lowest: Math.min(...perches.map((p) => p.y)),
      altitude: s?.altitude,
      noClips: inst?.actions?.size === 0,
      hidden: !!inst?.encounterHidden,
      targetable: T.combat.targetable(inst),
    };
  });
  check("spawns once, perched and dormant, with no .glb behind it",
    rig.spawned && rig.phase === "dormant" && rig.noClips);
  /* The perches are the district's OWN needles, published by the world
     builder - not invented here and not re-derived from a duplicated
     RNG seed, either of which would put the animal inside a spire the
     first time the field was re-laid. */
  check("it perches on the world's real needles", rig.perches >= 3,
    `${rig.perches} crowns, lowest at y=${Math.round(rig.lowest)}`);
  check("the fight is vertical", rig.altitude > 45,
    `${rig.altitude}m above the floor`);
  check("the dormant tenant cannot be seen or damaged",
    rig.hidden && !rig.targetable);

  /* ---- ROUSE ----------------------------------------------------------- */
  const rouse = await page.evaluate(() => {
    const T = window.__SF;
    T.resetStylite();
    T.teleportToStylite(50);
    const r = T.advanceToStylitePhase("rouse", 8);
    const p = T.advanceToStylitePhase("perched", 14);
    return { r, p, state: T.styliteState() };
  });
  check("crossing the aggro radius rouses it", rouse.r >= 0 && rouse.p >= 0,
    JSON.stringify({ rouse: rouse.r, perched: rouse.p }));
  await page.screenshot({ path: path.join(outDir, "01-perched.png") });

  /* ---- THE BARRAGE ----------------------------------------------------- */
  const barrage = await page.evaluate(() => {
    const T = window.__SF;
    let hits = 0;
    let shots = 0;
    const offShot = T.stylite.bus.on("shot", () => { shots += 1; });
    const offHit = T.stylite.bus.on("boltSplash", () => { hits += 1; });
    let peak = 0;
    for (let i = 0; i < 60 * 8; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      peak = Math.max(peak, T.styliteState().bolts);
    }
    offShot(); offHit();
    return { shots, hits, peak };
  });
  check("it rakes the ground beneath it", barrage.shots > 0,
    `${barrage.shots} bolts, ${barrage.hits} landed`);
  /* Travelling, not hitscan: bolts that exist in the world for long
     enough to be seen and walked out of. */
  check("the bolts travel rather than hitscan", barrage.peak > 0,
    `${barrage.peak} in the air at once`);

  /* ---- THE LEAP -------------------------------------------------------- */
  const leap = await page.evaluate(() => {
    const T = window.__SF;
    T.resetStylite();
    T.teleportToStylite(50);
    T.advanceToStylitePhase("perched", 16);
    const from = T.styliteState();
    const seen = [];
    let peakY = -Infinity;
    let sawCoil = 0;
    T.forceStyliteLeap();
    for (let i = 0; i < 260; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      const s = T.styliteState();
      if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
      peakY = Math.max(peakY, s.y);
      sawCoil = Math.max(sawCoil, s.coil);
      if (s.phase === "perched" && seen.includes("leap")) break;
    }
    const to = T.styliteState();
    return {
      seen, sawCoil, peakY,
      fromPerch: from.perch, toPerch: to.perch,
      fromY: from.y, toY: to.y,
      moved: Math.hypot(to.x - from.x, to.z - from.z),
    };
  });
  check("a leap visibly coils before it launches", leap.sawCoil > 0.9,
    `peak coil ${leap.sawCoil.toFixed(2)}`);
  check("...arcs above both crowns...",
    leap.peakY > Math.max(leap.fromY, leap.toY) + 6,
    `peaked at ${Math.round(leap.peakY)} between ${Math.round(leap.fromY)} and ${Math.round(leap.toY)}`);
  check("...and lands on a different needle",
    leap.toPerch !== leap.fromPerch && leap.moved > 20,
    `perch ${leap.fromPerch} -> ${leap.toPerch}, ${Math.round(leap.moved)}m`);

  const stoop = await page.evaluate(() => {
    const T = window.__SF;
    T.resetStylite();
    T.teleportToStylite(50);
    T.advanceToStylitePhase("perched", 16);
    const ps = T.player.state;
    T.invulnerable(false);
    T.combat.player.dead = false;
    T.combat.player.hp = T.combat.player.maxHp;
    let hurt = 0;
    const off = T.combat.bus.on("playerHurt", (e) => {
      if (e.source === "stylite-stoop") hurt += e.damage;
    });
    const mark = { x: ps.x, z: ps.z };
    T.forceStyliteStoop();
    for (let i = 0; i < 240; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      if (T.styliteState().phase === "perched") break;
    }
    off();
    const s = T.styliteState();
    T.invulnerable(true);
    return {
      hurt: Number(hurt.toFixed(1)),
      landedNear: Math.hypot(s.x - mark.x, s.z - mark.z),
      slowed: T.player.state.slowFor > 0,
    };
  });
  check("a stoop comes down on the player's ground",
    stoop.landedNear < 16 && stoop.hurt > 15,
    `landed ${Math.round(stoop.landedNear)}m off, ${stoop.hurt} damage`);

  /* ---- THE GRIP, AND THE FALL ------------------------------------------ */
  /* The mechanic. Shot through the production path, because "does
     shooting it bring it down" cannot be answered by a hook that sets
     the pool directly. */
  const grip = await page.evaluate(() => {
    const T = window.__SF;
    T.resetStylite();
    T.teleportToStylite(50);
    T.advanceToStylitePhase("perched", 16);
    const inst = T.enemies.live.find((e) => e.key === "stylite");
    const ps = T.player.state;
    const shootIt = () => {
      const s = T.styliteState();
      const o = { x: ps.x, y: ps.y + 1.5, z: ps.z };
      const d = Math.hypot(s.x - o.x, s.y - o.y, s.z - o.z);
      return T.combat.fire(o,
        { x: (s.x - o.x) / d, y: (s.y - o.y) / d, z: (s.z - o.z) / d },
        { damage: 40, range: 400 });
    };
    const start = T.styliteState().grip;
    let shots = 0;
    let hpStart = inst.health;
    for (let i = 0; i < 60; i += 1) {
      if (T.styliteState().phase !== "perched") break;
      if (shootIt()) shots += 1;
      T.advanceTime(1 / 60, 1 / 60);
    }
    const broke = T.styliteState();
    /* ...and while it is DOWN, shooting must not wear a grip it no
       longer has - the pool only exists on a rock. */
    T.advanceToStylitePhase("stunned", 6);
    const downGrip = T.styliteState().grip;
    shootIt();
    T.advanceTime(1 / 60, 1 / 60);
    return {
      start, shots, phase: broke.phase, grip: broke.grip,
      downGrip, downGripAfter: T.styliteState().grip,
      dealt: Math.round(hpStart - inst.health),
    };
  });
  check("shooting a perched Stylite wears its grip through",
    grip.phase === "plummet" && grip.shots > 4 && grip.shots < 45,
    `${grip.shots} shots emptied ${grip.start} of grip`);
  check("the grip cannot be worn while it is already down",
    grip.downGripAfter >= grip.downGrip,
    `${grip.downGrip} -> ${grip.downGripAfter}`);

  const fall = await page.evaluate(() => {
    const T = window.__SF;
    T.resetStylite();
    T.teleportToStylite(50);
    T.advanceToStylitePhase("perched", 16);
    const inst = T.enemies.live.find((e) => e.key === "stylite");
    const hpBefore = inst.health;
    const before = T.styliteState();
    const seen = [];
    T.forceStyliteFall();
    for (let i = 0; i < 300; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      const s = T.styliteState();
      if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
      if (s.phase === "stunned") break;
    }
    const after = T.styliteState();
    /* How much rock is between the fallen animal and open sand. The
       crowns are the tips of cones fifteen-odd metres wide at the
       ground, so this is measured against `baseRad` - the crown radius
       says a needle is four metres wide at the sand and it is not. */
    let intoRock = -Infinity;
    for (const n of T.stylitePerches()) {
      intoRock = Math.max(intoRock,
        n.baseRad - Math.hypot(n.x - after.x, n.z - after.z));
    }
    /* And whether the player can actually walk to it, through the
       collision that the needle really has. */
    const ps = T.player.state;
    /* Approach from the OPEN side: continue along the needle-to-crash
       bearing rather than a fixed +x. The fall's bearing is terrain-
       dependent (the m101 arena flattening changed it), and a fixed
       offset can teleport the probe into the very needle the animal
       just peeled off - which reads as "cannot reach the boss" when
       the boss is standing on open sand eleven metres away. */
    const perchList = T.stylitePerches();
    const fromPerch = perchList[T.ctx.stylite.status().perch] || null;
    let ax = 1;
    let az = 0;
    if (fromPerch) {
      const ddx = after.x - fromPerch.x;
      const ddz = after.z - fromPerch.z;
      const dl = Math.hypot(ddx, ddz);
      if (dl > 0.5) { ax = ddx / dl; az = ddz / dl; }
    }
    T._teleportRaw(after.x + ax * 14, after.z + az * 14, 0);
    T.advanceTime(2 / 60, 1 / 60);
    for (let i = 0; i < 90; i += 1) {
      const dx = after.x - ps.x;
      const dz = after.z - ps.z;
      const d = Math.hypot(dx, dz) || 1;
      /* `slide` takes the CANDIDATE position, not a delta, and hands
         back an [x, z] pair. */
      const [sx, sz] = T.ctx.collide.slide(ps.x, ps.z,
        ps.x + (dx / d) * 0.22, ps.z + (dz / d) * 0.22, ps.y);
      ps.x = sx;
      ps.z = sz;
      T.advanceTime(1 / 60, 1 / 60);
    }
    return {
      seen, altBefore: before.altitude, altAfter: after.altitude,
      grounded: after.grounded, falls: after.falls,
      selfDamage: Math.round(hpBefore - inst.health),
      gripRestored: after.grip,
      intoRock: Number(intoRock.toFixed(1)),
      walkedTo: Number(Math.hypot(ps.x - after.x, ps.z - after.z).toFixed(1)),
    };
  });
  check("breaking the grip drops it off the needle",
    fall.seen[0] === "plummet" && fall.altBefore > 45 && fall.altAfter < 3,
    `${Math.round(fall.altBefore)}m -> ${fall.altAfter}m`);
  /* It hurts ITSELF. An animal that falls ninety metres and stands up
     unmarked teaches the player that the mechanic is a formality. */
  check("the fall costs it real health", fall.selfDamage >= 400,
    `${fall.selfDamage} self-inflicted`);
  check("...and leaves it stunned on the ground",
    fall.seen.includes("stunned") && fall.grounded, fall.seen.join(" > "));
  /* THE LANDING HAS TO BE ON SAND. The first version dropped it down
     the needle's axis and buried it in the spire - zero metres from
     the centre of a cone fifteen metres wide - which left the reward
     for breaking the grip sealed inside the rock. Nothing else in the
     suite caught it, because every other promise about the fall was
     still true: it fell, it hurt itself, it was stunned and grounded.
     It was simply somewhere no player could reach. */
  check("the fall clears the needle it peeled off", fall.intoRock < -2,
    `${(-fall.intoRock).toFixed(1)}m clear of the widest spire`);
  check("...and a player can walk into melee range of where it lands",
    fall.walkedTo < 3.5, `closed to ${fall.walkedTo}m through real collision`);
  await page.screenshot({ path: path.join(outDir, "02-down.png") });

  /* ---- REACH ----------------------------------------------------------- */
  const reach = await page.evaluate(() => {
    const T = window.__SF;
    T.equipWeapon("glaive");
    const inst = T.enemies.live.find((e) => e.key === "stylite");
    const swingAt = () => {
      const s = T.styliteState();
      const ps = T.player.state;
      T._teleportRaw(s.x + 2.0, s.z, 0);
      ps.yaw = Math.atan2(s.x - ps.x, s.z - ps.z);
      T.advanceTime(1 / 60, 1 / 60);
      const before = inst.health;
      T.combat.meleeStrike(1, 2.4, false, 1, 1);
      return Math.round(before - inst.health);
    };
    // Grounded, in the window the player earned.
    const down = swingAt();
    // ...and back on a crown, standing directly underneath it.
    T.forceStylitePhase("perched");
    T.advanceTime(3 / 60, 1 / 60);
    const up = swingAt();
    const alt = T.styliteState().altitude;
    // A rifle shot for the comparison the multiplier is measured against.
    const s = T.styliteState();
    const ps = T.player.state;
    T._teleportRaw(s.x - 40, s.z, 0);
    T.advanceTime(1 / 60, 1 / 60);
    const o = { x: ps.x, y: ps.y + 1.5, z: ps.z };
    const d = Math.hypot(s.x - o.x, s.y - o.y, s.z - o.z);
    const hp = inst.health;
    T.combat.fire(o, { x: (s.x - o.x) / d, y: (s.y - o.y) / d, z: (s.z - o.z) / d },
      { damage: 70, range: 400 });
    const shot = Math.round(hp - inst.health);
    return { down, up, alt, shot };
  });
  /* THE POINT OF THE WHOLE FIGHT. Standing under a perched Stylite and
     swinging has to be worth exactly nothing, or the vertical fight is
     decoration. */
  check("no swing reaches it while it is perched", reach.up === 0,
    `${reach.alt}m overhead, ${reach.up} damage`);
  check("a swing in the downed window is worth far more than a shot",
    reach.down > reach.shot * 1.8,
    `${reach.down} melee vs ${reach.shot} for a 70-damage shot`);

  /* ---- THE LEASH ------------------------------------------------------- */
  const leash = await page.evaluate(() => {
    const T = window.__SF;
    T.resetStylite();
    T.teleportToStylite(50);
    T.advanceToStylitePhase("perched", 16);
    const inst = T.enemies.live.find((e) => e.key === "stylite");
    T.combat.damageEnemy(inst, 2000, { source: "qa-leash" });
    const wounded = inst.health;
    const s = T.styliteState();
    T._teleportRaw(s.x + 240, s.z, 0);
    const retire = T.advanceToStylitePhase("retire", 22);
    const dormant = T.advanceToStylitePhase("dormant", 14);
    return {
      wounded, retire, dormant, healed: inst.health, max: inst.maxHealth,
      bolts: T.styliteState().bolts,
    };
  });
  check("leaving the arena settles it back onto its needle",
    leash.retire >= 0 && leash.dormant >= 0, JSON.stringify(leash));
  check("the leash heals it and clears the air",
    leash.healed === leash.max && leash.bolts === 0, JSON.stringify(leash));

  const reaggro = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToStylite(50);
    const secs = T.advanceToStylitePhase("perched", 20);
    return { secs, free: !!T.player.state.free };
  });
  check("a fresh approach wakes it again, without a second camera steal",
    reaggro.secs >= 0 && !reaggro.free, JSON.stringify(reaggro));

  /* ---- SAVE / RESTORE -------------------------------------------------- */
  const saved = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "stylite");
    T.combat.damageEnemy(inst, 1200, { source: "qa-save" });
    T.forceStyliteLeap();
    for (let i = 0; i < 240; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      if (T.styliteState().phase === "perched") break;
    }
    const before = T.styliteState();
    const captured = T.saves.capture();
    const reason = T.saves.state?.().saveReason || "";
    T.combat.damageEnemy(inst, 500, { source: "qa-drift" });
    T.advanceTime(1.0, 1 / 60);
    const accepted = !!captured && T.saves.apply(captured);
    const after = T.styliteState();
    return { accepted: !!accepted, reason, before, after };
  });
  check("the encounter survives a save/restore round trip",
    saved.accepted && saved.after?.health === saved.before?.health
    && saved.after?.perch === saved.before?.perch,
    JSON.stringify({ accepted: saved.accepted, reason: saved.reason,
      hp: [saved.before?.health, saved.after?.health],
      perch: [saved.before?.perch, saved.after?.perch] }));

  /* ---- DEATH ----------------------------------------------------------- */
  const death = await page.evaluate(() => {
    const T = window.__SF;
    T.resetStylite();
    T.invulnerable(true);
    T.combat.player.dead = false;
    T.combat.player.hp = T.combat.player.maxHp;
    T.teleportToStylite(50);
    T.advanceToStylitePhase("perched", 18);
    const inst = T.enemies.live.find((e) => e.key === "stylite");
    let defeated = false;
    const off = T.stylite.bus.on("defeated", () => { defeated = true; });
    T.combat.damageEnemy(inst, 999999, { source: "qa" });
    for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);
    off();
    return { state: T.styliteState(), defeated };
  });
  check("lethal damage kills it and the encounter reports it",
    death.state.dead && death.defeated, JSON.stringify(death.state?.phase));

  /* ---- COST ------------------------------------------------------------ */
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    T.resetStylite();
    T.teleportToStylite(42);
    T.advanceToStylitePhase("perched", 18);
    T.advanceTime(3.0, 1 / 60);   // bolts in the air
    const N = 150;
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) T.renderOnce(1 / 60, true);
    return {
      msPerFrame: Number(((performance.now() - t0) / N).toFixed(2)),
      draws: T.report().render, state: T.styliteState(),
    };
  });
  check("the encounter renders inside budget", cost.msPerFrame < 9,
    `${cost.msPerFrame}ms/frame, ${cost.draws.calls} draws, ${cost.state.bolts} bolts`);

  /* AND IT COSTS NOTHING WHEN IT IS NOT THE FIGHT.

     A boss that sits dormant on a needle for the other five districts
     is still in the frame loop, and the first version posed its whole
     rig every frame from level load - eighteen damped joints and a
     recursive matrix update, running while the player was six hundred
     metres away fighting somebody else. It cost about 1.3ms a frame
     across the entire game and was invisible here, because this
     boss's own budget check only ever measures its own fight. It
     surfaced as the ABBESS's chamber going over budget, in a district
     that has nothing to do with it. Measured as a ratio rather than
     an absolute so the check survives a slower machine. */
  const idle = await page.evaluate(() => {
    const T = window.__SF;
    T.resetStylite();
    const s = T.styliteState();
    const sample = () => {
      const N = 90;
      const t0 = performance.now();
      for (let i = 0; i < N; i += 1) T.advanceTime(1 / 60, 1 / 60);
      return (performance.now() - t0) / N;
    };
    /* Far away, with the boss dormant and hidden - which is the state
       it is in for the other five districts. `resetStylite` puts it
       back on a perch AWAKE, so the phase has to be set explicitly. */
    T._teleportRaw(s.x + 900, s.z + 900, 0);
    T.forceStylitePhase("dormant");
    T.advanceTime(0.5, 1 / 60);
    const away = Math.min(sample(), sample());
    const hidden = !T.ctx.stylite.group.visible;
    return { away: Number(away.toFixed(3)), hidden,
      phase: T.styliteState().phase };
  });
  check("a dormant Stylite is not posed for the rest of the game",
    idle.hidden && idle.phase === "dormant" && idle.away < 2.2,
    `${idle.away}ms/frame of simulation with the player 1.2km away`);

  const realConsoleErrors = consoleErrors.filter((m) =>
    !/jsdelivr|unpkg|favicon|Failed to load resource/i.test(m));
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  check("no failed game-asset requests", assetFailures.length === 0,
    assetFailures.slice(0, 5).join(" | "));
  check("no console errors", realConsoleErrors.length === 0,
    realConsoleErrors.slice(0, 5).join(" | "));

  await writeFile(path.join(outDir, "report.json"),
    JSON.stringify({ results, failed, cost }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
} finally {
  server.kill();
}

process.exitCode = failed ? 1 : 0;
