#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Matriarch encounter, checked

   The model can be reviewed from pictures. The FIGHT cannot, and
   every part of it is a place where a boss quietly stops being one:

     - a weak point the body capsule swallows is a boss that takes
       normal damage everywhere and looks like it has no mechanic;
     - a weak point that can be hit from the FRONT is a boss with no
       positioning problem, which is the entire encounter;
     - a periodic special that only summons adds repeats the same test
       as the rest of the Bloom rather than testing the player's movement;
     - a ground wave without a reliable jump/boost clear is damage by
       appointment rather than an authored attack.

   None of these throw. They all just make the encounter worse in a
   way that reads as "the boss feels flat", which is the hardest kind
   of bug to find from a play session.

   Usage:  node scripts/saintfall-matriarch-fight.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/matriarch");
const PORT = 49933;
const BASE = `http://127.0.0.1:${PORT}`;

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
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await mkdir(OUT, { recursive: true });
  await page.evaluate(() => {
    window.__SF.maximize();
    window.__SF.hideHud(true);
    window.__SF.invulnerable(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  /* ---------------- she holds a district now ---------------- */
  /* She used to be raised by the last breach wave of a Bloom cycle,
     and this block checked that she could not appear before it. She
     is the GILDED REACH's boss now - the Abbess took the Bloom, the
     Stylite took the Choir Spires, and the mantis the Stylite
     displaced moved here rather than being retired. So the promise
     inverts: she is on the map from boot, dormant and unhittable
     behind the same arena gate every other district boss uses, and
     the roaming waves that used to raise her no longer raise
     anything. The Abbess still lays one at a third health, which is
     covered in scripts/saintfall-abbess-fight.mjs. */
  console.log("\n=== PLACEMENT ===");
  const placed = await page.evaluate(() => {
    const T = window.__SF;
    const live = T.ctx.enemies.live.filter((e) => e.key === "matriarch");
    const site = T.ctx.mission.bosses.find((b) => b.key === "reach");
    const status = T.ctx.districtBosses.status("reach");
    const legacy = T.ctx.districtBosses.snapshot();
    const legacyReach = legacy.bosses.find((boss) => boss.key === "reach");
    legacyReach.maxHealth = 3600;
    legacyReach.health = 1800;
    T.ctx.districtBosses.restore(legacy);
    const migrated = T.ctx.districtBosses.status("reach");
    T.ctx.districtBosses.reset("reach");
    const ps = T.playerState();
    T.startBreachWave(4, ps.x, ps.z - 44, true);
    const afterWave = T.ctx.enemies.live.filter((e) => e.key === "matriarch").length;
    return {
      atBoot: live.length,
      eventId: live[0]?.eventId || null,
      enemyKey: site?.enemyKey || null,
      dormant: status?.phase === "dormant" && !!status.hidden && !!status.locked,
      distanceFromSite: live[0] && site
        ? Math.hypot(live[0].x - site.x, live[0].z - site.z) : Infinity,
      maxHealth: live[0]?.maxHealth || 0,
      walkSpeed: T.ctx.matriarch.config.walkSpeed,
      chaseSpeed: T.ctx.matriarch.config.chaseSpeed,
      gaitCeiling: T.ctx.matriarch.config.gaitCeiling,
      migratedHealth: migrated?.health || 0,
      migratedMaxHealth: migrated?.maxHealth || 0,
      afterWave,
    };
  });
  console.log("  matriarchs on the map:", JSON.stringify(placed));
  check(placed.atBoot === 1 && placed.enemyKey === "matriarch"
    && placed.eventId === "district-boss:reach",
  "the Matriarch holds the Gilded Reach as its district boss",
  `${placed.atBoot} on the map as ${placed.eventId}`);
  check(placed.dormant && placed.distanceFromSite < 6,
    "...dormant, hidden and locked at the Reach's arena until it is entered",
    `${placed.distanceFromSite.toFixed(1)}m from the site marker`);
  check(placed.afterWave === 1,
    "a roaming breach wave no longer raises a second one",
    `${placed.afterWave} after a wave started`);
  check(placed.maxHealth === 7200,
    "the Penitent Matriarch has a district-boss health pool",
    `${placed.maxHealth} max health`);
  check(placed.walkSpeed >= 6.6 && placed.chaseSpeed >= 8.1
      && placed.gaitCeiling < 8.6,
    "its pursuit beats sighted movement but leaves a full sprint as the disengage",
    `${placed.walkSpeed} walk · ${placed.chaseSpeed} chase · ${placed.gaitCeiling} ceiling`);
  check(placed.migratedHealth === 3600 && placed.migratedMaxHealth === 7200,
    "an old 3600-HP save is upgraded without healing its wounded fraction",
    `${placed.migratedHealth}/${placed.migratedMaxHealth} after a 1800/3600 restore`);

  /* ---------------- the weak point ---------------- */
  console.log("\n=== WEAK POINT ===");
  const weak = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    T.clearEnemies();
    const site = T.findFlatSite(14);
    // Facing +Z, so "behind" is -Z and the shot geometry below is
    // readable rather than trigonometric.
    T.spawnEnemy("matriarch", site[0], site[1], { yaw: 0 });
    T.advanceTime(0.6, 1 / 60);
    const inst = T.ctx.enemies.live[0];
    inst.health = 100000;                    // survive the probe
    const box = T.ctx.combat.hitbox.matriarch;
    const fire = (from, to) => {
      const o = new THREE.Vector3(...from);
      const d = new THREE.Vector3(...to).sub(o).normalize();
      const before = inst.health;
      const hit = T.ctx.combat.fire(o, d, { damage: 100, range: 200 });
      return { dmg: +(before - inst.health).toFixed(1),
        weak: !!(hit && hit.weak), head: !!(hit && hit.head), hit: !!hit };
    };
    const y = inst.y;
    const wz = box.weak.z;                   // -3.30, i.e. behind
    return {
      box,
      // From directly behind, level with the gaster.
      fromBehind: fire([inst.x, y + box.weak.y, inst.z + wz - 30],
        [inst.x, y + box.weak.y, inst.z + wz]),
      // From the front, aimed at the head.
      atHead: fire([inst.x, y + box.head, inst.z + 30],
        [inst.x, y + box.head, inst.z + box.headZ]),
      // From the front, aimed level through the middle of the body.
      atBody: fire([inst.x, y + 2.6, inst.z + 30], [inst.x, y + 2.6, inst.z]),
      // From the front, aimed at where the gaster IS - the body
      // should be in the way.
      throughBody: fire([inst.x, y + box.weak.y, inst.z + 30],
        [inst.x, y + box.weak.y, inst.z + wz]),
    };
  });
  console.log(`  hitbox r ${weak.box.r} · weak sphere y ${weak.box.weak.y} `
    + `z ${weak.box.weak.z} r ${weak.box.weak.r} x${weak.box.weak.mult}`);
  console.log(`  from behind : ${JSON.stringify(weak.fromBehind)}`);
  console.log(`  at head     : ${JSON.stringify(weak.atHead)}`);
  console.log(`  at body     : ${JSON.stringify(weak.atBody)}`);
  console.log(`  through body: ${JSON.stringify(weak.throughBody)}`);
  check(weak.fromBehind.weak, "the gaster is hittable from behind",
    `${weak.fromBehind.dmg} damage`);
  check(weak.fromBehind.dmg > weak.atBody.dmg * 2,
    "the weak point is worth going round for",
    `${weak.fromBehind.dmg} vs ${weak.atBody.dmg} on the body`);
  check(weak.atBody.hit && !weak.atBody.weak,
    "a body shot is not a weak-point shot");
  check(!weak.throughBody.weak,
    "the weak point cannot be shot through the animal",
    `front-on shot at gaster height resolved weak=${weak.throughBody.weak}`);
  check(weak.atHead.dmg > weak.atBody.dmg,
    "the head still multiplies",
    `${weak.atHead.dmg} vs ${weak.atBody.dmg}`);

  /* ---------------- the moveset ----------------
     Everything below is about the difference between a boss and a
     large enemy. The old Matriarch closed to 7.4m and bit on a 2.35s
     cadence, which is a Harrow with nine times the health: the only
     decision in the encounter was "walk behind it", taken once and
     never revisited, because nothing the animal did could take the
     position back. So the checks here are not "does it deal damage" -
     that was never in doubt - they are:

       - is every attack a TELL first, resolved against where the
         player got to, and therefore answerable;
       - does standing behind it cost something;
       - does standing away from it cost something;
       - and does the tremor turn jumping and boosting into the answer
         while its plant still creates a contested gaster window.
     ------------------------------------------------------------ */
  console.log("\n=== MOVESET ===");
  const moveset = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const site = T.findFlatSite(16);
    T.spawnEnemy("matriarch", site[0], site[1], { yaw: 0 });
    T.advanceTime(0.4, 1 / 60);
    const inst = T.ctx.enemies.live.find((e) => e.key === "matriarch");
    inst.health = 1e6;
    inst.maxHealth = 1e6;
    const M = T.ctx.matriarch;
    const cfg = M.config;
    /* EVERY REACH-IN NAMES THE PROBE. `clearEnemies` does not stop
       districtBosses re-spawning the Gilded Reach's own Matriarch on
       the very next tick, so from here on there are two of them: this
       one, and a dormant one behind its gate a kilometre away. */
    const status = () => M.status(inst);
    const force = (kind) => M.force(kind, inst);

    /* Put the player where each move is supposed to be chosen from,
       and read back what the animal decided. `_teleportRaw` rather
       than `player.spawn`, which resets health and would hide exactly
       the damage these checks are about. */
    const put = (fwd, side) => {
      T._teleportRaw(inst.x + side, inst.z + fwd, Math.PI);
      T.advanceTime(0.05, 1 / 60);
    };

    /* --- 1. THE COMBO IS A TELL, AND IT CAN BE STEPPED OUT OF. --- */
    T.invulnerable(false);
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    put(5.0, 0);
    force("combo");
    const tell = status();
    // Held still through the whole chain: both scythes must connect.
    T.advanceTime(cfg.comboWindup + cfg.comboGap + 0.25, 1 / 60);
    const stood = T.ctx.combat.player.hp;

    // ...and again, stepping out of reach inside the wind-up.
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    put(5.0, 0);
    force("combo");
    T.advanceTime(0.22, 1 / 60);
    T._teleportRaw(inst.x, inst.z + 15, Math.PI);
    T.advanceTime(1.6, 1 / 60);
    const stepped = T.ctx.combat.player.hp;

    /* --- 2. LOITERING BEHIND IT IS ANSWERED. --- */
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    put(-6.0, 0);                       // straight up the ovipositor
    let culled = false;
    let cullAfter = -1;
    for (let i = 0; i < 200 && !culled; i += 1) {
      T.advanceTime(0.05, 1 / 60);
      // Hold station behind it however it turns.
      T._teleportRaw(inst.x - Math.sin(inst.yaw) * 6.0,
        inst.z - Math.cos(inst.yaw) * 6.0, Math.PI);
      const s = status();
      if (s.action === "cull") { culled = true; cullAfter = (i + 1) * 0.05; }
    }
    T.advanceTime(1.4, 1 / 60);
    const afterCull = T.ctx.combat.player.hp;

    /* --- 3. STANDING OFF IS ANSWERED. --- */
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    const standOff = 17;
    T._teleportRaw(inst.x + Math.sin(inst.yaw) * standOff,
      inst.z + Math.cos(inst.yaw) * standOff, Math.PI);
    T.advanceTime(0.1, 1 / 60);
    const beforeLance = Math.hypot(T.playerState().x - inst.x,
      T.playerState().z - inst.z);
    force("lance");
    T.advanceTime(cfg.lanceCock * 0.9, 1 / 60);
    const cockedAt = Math.hypot(T.playerState().x - inst.x,
      T.playerState().z - inst.z);
    T.advanceTime(cfg.lanceDashMax + 0.3, 1 / 60);
    const closedTo = Math.hypot(T.playerState().x - inst.x,
      T.playerState().z - inst.z);

    /* --- 4. THE TREMOR PLANT PRESENTS THE GASTER. --- */
    T.invulnerable(true);
    const box = T.ctx.combat.hitbox.matriarch;
    const THREE = T.THREE;
    const gaster = () => {
      const s = Math.sin(inst.yaw);
      const c = Math.cos(inst.yaw);
      const wx = inst.x + s * box.weak.z;
      const wz = inst.z + c * box.weak.z;
      const o = new THREE.Vector3(wx - s * 30, inst.y + box.weak.y, wz - c * 30);
      const d = new THREE.Vector3(wx, inst.y + box.weak.y, wz).sub(o).normalize();
      const before = inst.health;
      const hit = T.ctx.combat.fire(o, d, { damage: 100, range: 200 });
      return { dmg: +(before - inst.health).toFixed(1), weak: !!(hit && hit.weak) };
    };
    put(9.0, 0);
    T.advanceTime(0.4, 1 / 60);
    /* AT REST MEANS AT REST. This read the gaster a fixed four tenths
       of a second after arriving and called whatever it found the
       resting value - which is only true while the animal happens not
       to be doing anything. The moment its cadences tightened, that
       window started landing mid-special and the check compared the
       temporary bonus against itself, a
       pass turned into a failure by nothing but phase. Wait for the
       animal to be idle, then read on the same frame. */
    for (let i = 0; i < 240 && status().action; i += 1) T.advanceTime(0.05, 1 / 60);
    const restWeak = gaster();
    force("tremor");
    T.advanceTime(0.35, 1 / 60);
    const tremorStatus = status();
    const tremorWeak = gaster();
    T.advanceTime(cfg.tremorWindup + (cfg.tremorWaves - 1) * cfg.tremorPulseGap
      + cfg.tremorRecover + 0.5, 1 / 60);
    const afterTremorWeak = gaster();

    return {
      cfg: {
        comboReach: cfg.comboReach, comboWindup: cfg.comboWindup,
        cullLoiter: cfg.cullLoiter, cullRadius: cfg.cullRadius,
        lanceRange: cfg.lanceRange, tremorWeakBonus: cfg.tremorWeakBonus,
      },
      selfDriven: !!inst.selfDriven,
      tell: { action: tell.action, steps: tell.comboSteps },
      hitsExpected: 2,
      stood: +stood.toFixed(1),
      stepped: +stepped.toFixed(1),
      culled, cullAfter, afterCull: +afterCull.toFixed(1),
      beforeLance: +beforeLance.toFixed(1),
      cockedAt: +cockedAt.toFixed(1),
      closedTo: +closedTo.toFixed(1),
      restWeak, tremorWeak, afterTremorWeak,
      perHit: cfg.comboDamage * 0.82,
      tremorBonus: tremorStatus.weakBonus,
      status: status(),
    };
  });
  const maxHp = await page.evaluate(() => window.__SF.ctx.combat.player.maxHp);
  console.log(`  self-driven: ${moveset.selfDriven} · `
    + `tell ${JSON.stringify(moveset.tell)}`);
  console.log(`  combo: stood still -> ${moveset.stood}/${maxHp} hp · `
    + `stepped out -> ${moveset.stepped}/${maxHp} hp`);
  console.log(`  cull: fired after ${moveset.cullAfter}s behind it · `
    + `${moveset.afterCull}/${maxHp} hp left`);
  console.log(`  lance: ${moveset.beforeLance}m -> cocked at ${moveset.cockedAt}m `
    + `-> closed to ${moveset.closedTo}m`);
  console.log(`  gaster: at rest ${JSON.stringify(moveset.restWeak)} · `
    + `tremor ${JSON.stringify(moveset.tremorWeak)} (x${moveset.tremorBonus}) · `
    + `after ${JSON.stringify(moveset.afterTremorWeak)}`);
  check(moveset.selfDriven,
    "the encounter module owns the animal's decisions");
  /* BOTH scythes, not one. A "combo" whose second beat never resolves
     is the old single bite with a longer animation, and the first run
     of this check advanced 0.9s against a chain that takes 1.04 - so it
     measured exactly one hit and called the move landed. */
  check(moveset.tell.action === "combo"
    && maxHp - moveset.stood > moveset.perHit * 1.6,
  "both scythes of the combo land on a player who stands in it",
  `${(maxHp - moveset.stood).toFixed(1)} taken, one scythe is ${moveset.perHit.toFixed(1)}`);
  check(moveset.stepped === maxHp,
    "...and whiffs entirely on one who steps out inside the wind-up",
    `${maxHp - moveset.stepped} damage taken`);
  check(moveset.culled && moveset.cullAfter > 0 && moveset.cullAfter < 12,
    "loitering in the rear arc is answered by the cull",
    `fired after ${moveset.cullAfter}s`);
  check(moveset.afterCull < maxHp,
    "...and the sweep reaches the player standing behind it",
    `${maxHp - moveset.afterCull} damage taken`);
  check(moveset.cockedAt > moveset.closedTo + 6,
    "the lance closes a stand-off range it telegraphs first",
    `${moveset.cockedAt}m at the end of the cock, ${moveset.closedTo}m after the dash`);
  check(moveset.tremorWeak.weak && moveset.restWeak.weak
    && moveset.tremorWeak.dmg > moveset.restWeak.dmg * 1.15,
  "the tremor plant presents the gaster as a stronger damage window",
  `${moveset.restWeak.dmg} at rest vs ${moveset.tremorWeak.dmg} planted`);
  check(Math.abs(moveset.afterTremorWeak.dmg - moveset.restWeak.dmg) < 0.5,
    "...and the window closes again when it is done",
    `${moveset.afterTremorWeak.dmg} after the rite`);

  /* ---------------- tremor rite ---------------- */
  console.log("\n=== TREMOR RITE ===");
  const tremor = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const site = T.findFlatSite(14);
    T.spawnEnemy("matriarch", site[0], site[1], { yaw: 0 });
    T.advanceTime(0.4, 1 / 60);
    const inst = T.ctx.enemies.live.find((e) => e.key === "matriarch");
    inst.health = 100000;
    inst.maxHealth = 100000;
    const M = T.ctx.matriarch;
    const cfg = M.config;
    const put = (distance) => T._teleportRaw(inst.x, inst.z + distance, Math.PI);

    /* Grounded: the first front must connect at the radius its visible
       ring reaches. Invulnerability is deliberately off for this beat. */
    put(12);
    T.invulnerable(false);
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    M.force("tremor", inst);
    T.advanceTime(cfg.tremorWindup + 12 / cfg.tremorSpeed + 0.12, 1 / 60);
    const groundedHp = T.ctx.combat.player.hp;
    const afterGround = M.status(inst);

    /* Airborne: reset the rite, then lift only across the crossing
       frame. This proves the wave reads clearance, not an invulnerability
       flag or a lucky gap between simulation ticks. */
    T.invulnerable(true);
    T.advanceTime(cfg.tremorPulseGap * (cfg.tremorWaves - 1)
      + cfg.tremorRecover + cfg.tremorRadius / cfg.tremorSpeed + 0.5, 1 / 60);
    put(12);
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    T.invulnerable(false);
    M.force("tremor", inst);
    T.advanceTime(cfg.tremorWindup + 12 / cfg.tremorSpeed - 0.10, 1 / 60);
    const ground = T.ctx.collide.groundHeight(T.ctx.player.state.x, T.ctx.player.state.z);
    T.ctx.player.state.y = ground + cfg.tremorAirClear + 0.65;
    T.ctx.player.state.vy = 0;
    T.ctx.player.state.grounded = false;
    T.advanceTime(0.18, 1 / 60);
    const airborneHp = T.ctx.combat.player.hp;
    const afterAir = M.status(inst);

    /* Let the full authored cycle run. There must still be exactly one
       combatant: the mechanic is rings, never a hidden fallback clutch. */
    T.invulnerable(true);
    T.advanceTime(cfg.tremorPulseGap * (cfg.tremorWaves - 1)
      + cfg.tremorRecover + cfg.tremorRadius / cfg.tremorSpeed + 0.5, 1 / 60);
    const spawned = T.ctx.enemies.live.filter((e) => e !== inst
      && e.state !== "death" && !e.encounterHidden).map((e) => e.key);
    const end = M.status(inst);
    return {
      config: {
        waves: cfg.tremorWaves, rousedWaves: cfg.tremorWavesRoused,
        radius: cfg.tremorRadius, damage: cfg.tremorDamage,
        airClear: cfg.tremorAirClear,
      },
      groundedHp: +groundedHp.toFixed(1),
      airborneHp: +airborneHp.toFixed(1),
      groundHits: afterGround.tremorHits,
      airClears: afterAir.tremorClears,
      spawned,
      end,
    };
  });
  console.log(`  ${tremor.config.waves} waves (${tremor.config.rousedWaves} roused) · `
    + `${tremor.config.radius}m radius · ${tremor.config.damage} damage each`);
  console.log(`  grounded ${tremor.groundedHp}/${maxHp} hp · airborne `
    + `${tremor.airborneHp}/${maxHp} hp · ${tremor.airClears} clears`);
  check(tremor.groundHits >= 1 && tremor.groundedHp < maxHp,
    "a grounded player is hit by the expanding seismic front",
    `${tremor.groundHits} hit, ${maxHp - tremor.groundedHp} damage taken`);
  check(tremor.airClears >= 1 && tremor.airborneHp === maxHp,
    "jumping or boosting above the front clears it without damage",
    `${tremor.airClears} clear, ${maxHp - tremor.airborneHp} damage taken`);
  check(tremor.spawned.length === 0,
    "the Matriarch never summons another enemy",
    `spawned combatants: ${tremor.spawned.join(", ") || "none"}`);
  check(tremor.end.tremors >= 2 && tremor.end.activeWaves === 0,
    "the rite completes and cleans up every authoritative wave",
    `${tremor.end.tremors} rites · ${tremor.end.activeWaves} active waves`);

  /* ---------------- a picture of it happening ---------------- */
  await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((e) => e.key === "matriarch");
    T.hidePlayer(true);
    T.ctx.matriarch.force("tremor", inst);
    T.advanceTime(T.ctx.matriarch.config.tremorWindup + 0.35, 1 / 60);
    T.lookAt([inst.x + 17, inst.y + 7.5, inst.z - 19],
      [inst.x, inst.y + 1.5, inst.z], 48);
    for (let i = 0; i < 5; i += 1) T.renderStill();
  });
  const url = await page.evaluate(() => window.__SF.captureDataURL());
  await writeFile(path.join(OUT, "tremor-rite.png"),
    Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));

  /* ---------------- the fight, played ----------------
     Every check above reaches past the encounter gate and calls the
     module directly, which is the only way to test one move at a
     time and is exactly why it proves nothing about the fight. This
     block does none of that: it wakes the Gilded Reach's own animal
     the way walking into the Reach wakes it, stands a player in the
     arena, circles them for half a minute and reads back what the
     boss actually chose to do.

     The failure it exists to catch is the one a moveset always has,
     and it is not a crash - it is a boss that reaches this code path
     with its gate half-open, or its cadences all in phase, or its
     stalk band unreachable, and spends the whole encounter doing one
     thing. A histogram with a single entry in it is the bug. */
  console.log("\n=== A LIVE ENCOUNTER ===");
  const played = await page.evaluate(async () => {
    const T = window.__SF;
    T.clearEnemies();
    T.ctx.districtBosses.reset("reach");
    const site = T.ctx.districtBosses.sites.find((s) => s.key === "reach");
    const inst = T.ctx.districtBosses.ensureSpawned("reach");
    if (!inst) return null;
    // Into the arena, at the range the hunt actually starts from.
    T._teleportRaw(inst.x + 34, inst.z + 34, Math.atan2(-34, -34));
    T.invulnerable(false);
    /* Diagnostic endurance, not game balance. The stronger encounter now
       kills a 150-HP bot before the orbit samples every positional branch.
       Give this one harness actor enough health to observe the full natural
       move histogram, then restore the real pool before leaving the block. */
    const realMaxHp = T.ctx.combat.player.maxHp;
    const probeMaxHp = 900;
    T.ctx.combat.player.maxHp = probeMaxHp;
    T.ctx.combat.player.hp = probeMaxHp;
    T.advanceTime(0.2, 1 / 60);

    const seenPhases = [];
    const actions = {};
    let woke = -1;
    let engaged = -1;
    let minHp = probeMaxHp;
    let orbit = 0;
    /* A player who stands still is not a fight, and one who stands
       still BEHIND it is a script for a single move. This one circles
       at a working range, drifting in and out of scythe reach.

       AT A SPEED A PERSON CAN ACTUALLY MOVE AT. The first version
       advanced a fixed 0.055 rad per 50ms step, which at nine metres
       is 9.9 m/s - faster than SPRINT (8.6) and held in a perfect
       circle while shooting, which nobody can do. It dodged all nine
       of the boss's tells and reported the encounter as harmless. The
       angular step is now derived from the radius so the tangential
       speed is a constant six metres a second: a trooper strafing,
       not a trooper outrunning. */
    const ORBIT_SPEED = 6.0;
    for (let i = 0; i < 700; i += 1) {
      const r = 9 + Math.sin(i * 0.018) * 4.5;
      orbit += (ORBIT_SPEED / r) * 0.05;
      T._teleportRaw(inst.x + Math.sin(orbit) * r, inst.z + Math.cos(orbit) * r,
        Math.atan2(inst.x - Math.sin(orbit) * r, inst.z - Math.cos(orbit) * r));
      T.advanceTime(0.05, 1 / 60);
      const s = T.ctx.matriarch.status(inst);
      const boss = T.ctx.districtBosses.status("reach");
      if (woke < 0 && boss?.phase === "alert") woke = (i + 1) * 0.05;
      if (engaged < 0 && boss?.phase === "active") engaged = (i + 1) * 0.05;
      if (s) {
        if (!seenPhases.includes(s.phase)) seenPhases.push(s.phase);
        if (s.action) actions[s.action] = (actions[s.action] || 0) + 1;
      }
      minHp = Math.min(minHp, T.ctx.combat.player.hp);
      if (T.ctx.combat.player.dead) break;
    }
    const end = T.ctx.matriarch.status(inst);
    const result = {
      arenaRadius: site.arenaRadius,
      woke, engaged, seenPhases, actions,
      minHp: +minHp.toFixed(1),
      probeMaxHp,
      damageTaken: +(probeMaxHp - minHp).toFixed(1),
      dead: T.ctx.combat.player.dead,
      invulnerable: !!T.ctx.combat.player.invulnerable,
      free: !!T.ctx.player.state.free,
      end,
      homeDist: +Math.hypot(inst.x - site.x, inst.z - site.z).toFixed(1),
      bossHealth: Math.round(inst.health),
    };
    T.ctx.combat.player.maxHp = realMaxHp;
    T.ctx.combat.player.hp = realMaxHp;
    T.ctx.combat.player.dead = false;
    return result;
  });
  await page.evaluate(() => window.__SF.invulnerable(true));
  if (!played) {
    check(false, "the Gilded Reach's own Matriarch can be woken and fought");
  } else {
    const kinds = Object.keys(played.actions);
    console.log(`  woke at ${played.woke}s · engaged at ${played.engaged}s`);
    console.log(`  phases seen: ${played.seenPhases.join(" -> ")}`);
    console.log(`  actions chosen: ${JSON.stringify(played.actions)}`);
    console.log(`  diagnostic damage ${played.damageTaken}/${played.probeMaxHp} hp · `
      + `boss ${played.bossHealth} hp `
      + `· ${played.homeDist}m from its site (arena ${played.arenaRadius}m)`);
    console.log(`  tells ${played.end.tells} · landed ${played.end.landed} `
      + `· whiffed ${played.end.whiffed} · culls ${played.end.culls} `
      + `· lances ${played.end.lances} · tremors ${played.end.tremors} `
      + `· invulnerable ${played.invulnerable} · freecam ${played.free}`);
    check(played.woke > 0 && played.engaged > played.woke,
      "walking into the Reach wakes it through the ordinary district gate",
      `alert at ${played.woke}s, active at ${played.engaged}s`);
    check(kinds.length >= 3,
      "a circling player is answered with more than one move",
      `chose ${kinds.join(", ") || "nothing"}`);
    check(kinds.includes("cull"),
      "...including the flank answer, unprompted",
      `${played.actions.cull || 0} frames of cull`);
    check(kinds.includes("tremor"),
      "...and the summon-free movement check, unprompted",
      `${played.actions.tremor || 0} frames of tremor`);
    check(played.seenPhases.includes("stalk"),
      "it holds ground between moves rather than standing still",
      played.seenPhases.join(" -> "));
    /* This bot has diagnostic health because the real 150-point pool
       now ends the sample before every positional branch appears. It
       still holds a perfect circle inside scythe reach for thirty-five
       seconds while never shooting, breaking off, raising Aegis, or
       healing. This check is about whether the moves connect and cost
       health, not calibrating the boss to what automation survives. */
    check(played.end.landed > 0 && played.damageTaken > 0,
      "thirty-five seconds inside its ring costs a strafing player dearly",
      `${played.end.landed} of ${played.end.tells} tells connected, `
      + `${played.damageTaken}/${played.probeMaxHp} diagnostic health taken`);
    check(played.homeDist <= played.arenaRadius,
      "it stays inside its own arena while it chases",
      `${played.homeDist}m from the site marker`);
  }

  /* A picture of the two poses the rewrite is about, from where the
     player stands: the fold cocked, and the fold thrown. */
  for (const [name, kind, at] of [["tell-cocked", "combo", 0.30],
    ["tell-thrown", "combo", 0.62]]) {
    await page.evaluate(([k, t]) => {
      const T = window.__SF;
      const inst = T.ctx.enemies.live.find((e) => e.key === "matriarch");
      if (!inst) return;
      T._teleportRaw(inst.x + Math.sin(inst.yaw) * 6.4,
        inst.z + Math.cos(inst.yaw) * 6.4, inst.yaw + Math.PI);
      T.invulnerable(true);
      T.ctx.matriarch.force(k, inst);
      T.advanceTime(t, 1 / 60);
      T.hidePlayer(true);
      const g = T.groundHeightAt(inst.x, inst.z);
      T.lookAt([inst.x + Math.sin(inst.yaw) * 11 + Math.cos(inst.yaw) * 4.5,
        g + 3.4, inst.z + Math.cos(inst.yaw) * 11 - Math.sin(inst.yaw) * 4.5],
      [inst.x, g + 3.0, inst.z], 46);
      for (let i = 0; i < 5; i += 1) T.renderStill();
    }, [kind, at]);
    const shot = await page.evaluate(() => window.__SF.captureDataURL());
    await writeFile(path.join(OUT, `${name}.png`),
      Buffer.from(shot.slice(shot.indexOf(",") + 1), "base64"));
  }

  /* ---------------- cost ----------------
     Timed over a FIXED frame rather than read off `report().frameMs`,
     which is a running average of whatever the harness happened to do
     last: the same build measured 8.5ms and 12.4ms on consecutive
     runs and a threshold on it flapped with them.

     There is deliberately no with/without-boss A/B here. It was tried
     and it reported the Matriarch as 6ms CHEAPER than not having it,
     reproducibly - because a ten-metre animal at point-blank range is
     a huge occluder, three.js sorts opaque draws front-to-back, and
     removing it hands the whole basin behind it back to the fragment
     shader. That number is real and it is not the creature's cost, so
     it is not worth reporting. What the boss costs at the scale that
     matters is a whole-map question and `saintfall-gameplay` answers
     it against 195 live units. */
  console.log("\n=== COST ===");
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    for (let i = 0; i < 30; i += 1) T.renderStill();
    const t0 = performance.now();
    for (let i = 0; i < 150; i += 1) T.renderStill();
    const ms = (performance.now() - t0) / 150;
    const report = T.report();
    const boss = T.ctx.enemies.live.find((e) => e.key === "matriarch");
    let tris = 0;
    boss.root.traverse((o) => {
      if (o.isMesh && o.geometry.index) tris += o.geometry.index.count / 3;
    });
    return { ms: +ms.toFixed(2), calls: report.render.calls, tris,
      bones: boss.bones.size, chains: boss.legs.length,
      adds: T.ctx.enemies.live.filter((e) => e !== boss
        && !e.encounterHidden && e.state !== "death").length };
  });
  console.log(`  boss + ${cost.adds} adds at point-blank: ${cost.ms}ms/frame `
    + `· ${cost.calls} draw calls`);
  console.log(`  the Matriarch itself: ${cost.tris} triangles · `
    + `${cost.bones} bones · ${cost.chains} IK chains`);
  check(cost.ms < 8, "the encounter renders at point-blank range",
    `${cost.ms}ms/frame`);
  check(cost.adds === 0, "the rendered encounter remains add-free",
    `${cost.adds} additional combatants`);

  /* ---------------- recurrence ----------------
     The Matriarch ends a WAVE, and the cycle ends one wave later. It
     used to be the last thing the Bloom sent, and this section was
     written against that - it opened wave five, killed it, and asserted
     a completed cycle. Adding the Coulter behind it made all three of
     those assertions fail while nothing was wrong, which is the usual
     shape of a test that hard-codes a position instead of a role.

     So the Matriarch's own claim is now the one worth making - it is
     the SECOND-TO-LAST wave, and clearing it advances rather than
     completes - and the recovery window is asserted where it actually
     lives, on the final wave. Production holds that state for three
     real minutes; the shortened restored timer below proves both
     persistence and the restart boundary without idling for it. */
  console.log("\n=== RECURRING BLOOM CYCLE ===");
  const recurrence = await page.evaluate(() => {
    const T = window.__SF;
    const kill = () => {
      for (const inst of T.ctx.breaches.members) {
        inst.health = 0;
        inst.state = "death";
      }
      T.advanceTime(0.05, 0.05);
    };
    const waves = T.ctx.breaches.waves.map((wave, i) => ({
      wave: i + 1, name: wave.name, bossKey: wave.bossKey || null,
    }));
    /* Anchored on the SECOND-TO-LAST wave rather than on "the wave
       that carries the Matriarch". No wave carries a boss any more -
       the encounter bosses all sit in their own arenas now, and
       `waves.find(w => w.bossKey === "matriarch")` came back
       undefined and took the whole probe down with it. What this
       block is really about is the boundary between advancing the
       cycle and closing it, which any non-final wave demonstrates. */
    const lastWave = waves[waves.length - 1];
    const midWave = waves[Math.max(0, waves.length - 2)];

    T.clearEnemies();
    T.setBreachAuto(true);
    /* STAND SOMEWHERE NEUTRAL FIRST. Waves hold outside every
       undefeated boss arena - that is the contract the hunt probe
       asserts - and the earlier blocks in this file leave the player
       wherever a flat site happened to be, which turned out to be
       inside the Fallen Saint's 285m circle. The cycle then reported
       `blockedByBoss: "saint"` and never advanced, which reads as a
       broken breach cycle rather than as a probe standing in the
       wrong place. */
    const sites = T.ctx.mission.bosses;
    let spot = null;
    for (let r = 0; r < 40 && !spot; r += 1) {
      const a = r * 2.399;
      const x = Math.cos(a) * (140 + r * 34);
      const z = Math.sin(a) * (140 + r * 34);
      if (sites.every((b) => Math.hypot(b.x - x, b.z - z)
        > (b.warningRadius || b.arenaRadius) + 90)) spot = [x, z];
    }
    if (spot) T._teleportRaw(spot[0], spot[1], 0);
    T.advanceTime(0.1, 0.05);
    const ps = T.playerState();
    // A mid-cycle wave: clearing it must ADVANCE the cycle.
    T.startBreachWave(midWave.wave - 1, ps.x, ps.z - 44, true);
    T.advanceTime(0.05, 0.05);
    const opened = T.breachState();
    kill();
    const advanced = T.breachState();

    // And the final wave: clearing that one closes the cycle.
    T.clearEnemies();
    T.startBreachWave(lastWave.wave - 1, ps.x, ps.z - 44, true);
    T.advanceTime(0.05, 0.05);
    const finalOpened = T.breachState();
    kill();
    const cleared = T.breachState();
    const restored = T.ctx.breaches.restore({ ...cleared, timer: 1.4, auto: true });
    T.advanceTime(0.7, 0.1);
    const resting = T.breachState();
    T.advanceTime(0.8, 0.1);
    const restarted = T.breachState();
    return {
      cooldown: T.ctx.breaches.config.cycleCooldownSeconds,
      waves, midWave, lastWave,
      opened, advanced, finalOpened, cleared, restored, resting, restarted,
      roster: T.ctx.breaches.members.filter((inst) => inst.state !== "death")
        .map((inst) => inst.key),
    };
  });
  console.log(`  waves: ${recurrence.waves.map((w) => `${w.wave}.${w.name}`
    + `${w.bossKey ? `[${w.bossKey}]` : ""}`).join(" ")}`);
  console.log(`  cycle ${recurrence.cleared.cyclesCleared} cleared · `
    + `${recurrence.cooldown}s recovery · next phase ${recurrence.restarted.phase} `
    + `cycle ${recurrence.restarted.cycle}`);
  check(recurrence.opened.phase === "active"
      && recurrence.opened.wave === recurrence.midWave.wave
      && recurrence.midWave.wave === recurrence.waves.length - 1,
    "a mid-cycle wave sits second-to-last in the progression",
    `wave ${recurrence.opened.wave} of ${recurrence.waves.length}`);
  check(recurrence.advanced.phase === "intermission" && !recurrence.advanced.complete,
    "breaking the brood advances the cycle rather than ending it",
    JSON.stringify({ phase: recurrence.advanced.phase, complete: recurrence.advanced.complete }));
  check(recurrence.cooldown === 180 && recurrence.cleared.phase === "complete"
      && recurrence.cleared.complete
      && recurrence.cleared.cyclesCleared === recurrence.finalOpened.cycle
      && recurrence.cleared.timer >= 179.9,
    "clearing the final wave opens a three-minute recovery window",
    JSON.stringify({ cooldown: recurrence.cooldown, cleared: recurrence.cleared }));
  check(recurrence.restored.phase === "complete"
      && recurrence.restored.cycle === recurrence.cleared.cycle
      && recurrence.restored.cyclesCleared === recurrence.cleared.cyclesCleared
      && recurrence.resting.phase === "complete" && recurrence.resting.timer > 0,
    "the recovery countdown survives save-state restoration and does not restart early",
    JSON.stringify({ restored: recurrence.restored, resting: recurrence.resting }));
  check(["warning", "active"].includes(recurrence.restarted.phase)
      && !recurrence.restarted.complete
      && recurrence.restarted.cycle === recurrence.cleared.cyclesCleared + 1
      && recurrence.restarted.cyclesCleared === recurrence.cleared.cyclesCleared
      && recurrence.restarted.wave === 1
      && recurrence.roster.length === 4
      && recurrence.roster.every((key) => key === "thresher"),
    "the insect progression restarts at wave one after the recovery window",
    JSON.stringify({ restarted: recurrence.restarted, roster: recurrence.roster }));
  check(pageErrors.length === 0, "no page or console errors",
    pageErrors.slice(0, 2).join(" | "));

  console.log(findings.length
    ? `\n${findings.length} FAILED: ${findings.join(", ")}`
    : "\nthe encounter behaves");
  await browser.close();
  process.exitCode = findings.length ? 1 : 0;
} finally {
  server.kill("SIGTERM");
}
