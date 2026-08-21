#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Coulter encounter, checked

   The model can be reviewed from pictures. The FIGHT cannot, and this
   boss has more ways to be quietly broken than any other enemy in the
   game because most of it happens where the player cannot see:

     - a submerged worm that can still be shot has no hunt phase, and
       the whole encounter collapses into a stationary damage race;
     - a maw weak point that is live while the mouth is SHUT deletes the
       one decision the fight is built on;
     - a body laid along the wrong trail leaves the hit volumes
       somewhere the animal is not, so shots that visibly connect do
       nothing;
     - venom that outlives its pool, or damages through geometry, turns
       a denial hazard into an unfair one;
     - a body that snaps straight when it dies undoes the one thing the
       runtime spine exists for.

   None of these throw. Every one of them reads in a play session as
   "the boss feels wrong", which is the hardest class of bug to find.

   Usage:  node scripts/saintfall-coulter-fight.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/coulter");
const PORT = 49941;
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

const shot = async (page, file) => {
  const url = await page.evaluate(() => window.__SF.captureDataURL());
  await writeFile(path.join(OUT, file),
    Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
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
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
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

  /* ---------------- the model arrived at all ---------------- */
  console.log("\n=== RIG ===");
  const rig = await page.evaluate(() => {
    const T = window.__SF;
    T.advanceTime(0.1, 1 / 60);
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    let tris = 0;
    inst.root.traverse((o) => {
      if (o.isMesh && o.geometry.index) tris += o.geometry.index.count / 3;
    });
    const bodies = T.coulterBodies();
    return {
      species: T.listSpecies(),
      clips: [...inst.actions.keys()],
      spine: inst.spine.length,
      bones: inst.bones.size,
      legs: inst.legs.length,
      arcs: inst.spineArc.map((v) => +v.toFixed(2)),
      span: +inst.spineLength.toFixed(2),
      tris,
      body: bodies.find((body) => body.id === inst.id) || null,
      site: [inst.x, inst.z],
    };
  });
  console.log(`  ${rig.spine} vertebrae · ${rig.bones} bones · ${rig.tris} triangles `
    + `· ${rig.span}m long`);
  console.log(`  clips: ${rig.clips.join(", ")}`);
  console.log(`  joint arcs: ${rig.arcs.join(" ")}`);
  check(rig.species.includes("coulter"), "the Coulter is in the bestiary");
  check(rig.spine === 13, "the whole body chain resolved", `${rig.spine} vertebrae`);
  check(rig.legs === 0, "it has no leg chains to solve", `${rig.legs} found`);
  check(rig.clips.length === 6 && rig.clips.includes("spew"),
    "every clip loaded, including the spew", rig.clips.join(","));
  check(rig.span > 90 && rig.span < 125, "it is a hundred-metre landmark boss",
    `${rig.span}m from mouth to tail`);
  check(rig.arcs.every((v, i) => i === 0 || v > rig.arcs[i - 1]),
    "the joint arc lengths increase monotonically down the body");

  /* ---------------- it starts underground ---------------- */
  console.log("\n=== THE HUNT ===");
  const hunt = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const M = T.ctx.mission;
    for (const boss of M.bosses.filter((entry) => entry.stage !== "penultimate")) {
      if (!boss.done) M.completeDistrictBoss(boss.key);
    }
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    inst.health = 1e6;
    /* The authored district intro now owns the first eruption so the
       boss is visible during its name card. This section is about the
       repeatable HUNT loop, so finish that protected reveal and seed
       the same animal back into its ordinary deep burrow before taking
       the submerged baseline. */
    const siteStatus = T.ctx.districtBosses.status("saint");
    const site = [siteStatus.x, siteStatus.z];
    // Cross the real arena gate and let the one-shot reveal finish.
    T.player.spawn(site[0], site[1] + 70, Math.PI);
    T.advanceTime(5.2, 1 / 60);
    const depth = inst.body.depth || 16;
    const ground = T.ctx.collide.groundHeight(site[0], site[1]);
    T.ctx.enemies.seedBody(inst, site[0], ground - depth, site[1], inst.yaw, depth);
    inst.x = inst.body.head.x;
    inst.y = inst.body.head.y;
    inst.z = inst.body.head.z;
    inst.body.phase = "burrow";
    inst.body.timer = 3;
    inst.body.hidden = true;
    inst.coulterReveal = false;
    // The player remains well clear so the hunt phase has to travel.
    T.advanceTime(0.2, 1 / 60);
    const start = T.coulterState();

    /* Shooting a submerged animal. Fired straight DOWN at the ground
       above it, which is the shot a player who has worked out where it
       is will actually take. */
    const fireAt = (from, to, damage = 500) => {
      const o = new THREE.Vector3(...from);
      const d = new THREE.Vector3(...to).sub(o).normalize();
      const before = inst.health;
      const hit = T.ctx.combat.fire(o, d, { damage, range: 300 });
      return { dmg: +(before - inst.health).toFixed(1), hit: !!hit,
        weak: !!(hit && hit.weak) };
    };
    const b = T.coulterBodies().find((body) => body.id === inst.id);
    const overhead = fireAt([b.head[0], b.head[1] + 40, b.head[2]],
      [b.head[0], b.head[1], b.head[2]]);
    const direct = T.ctx.combat.damageEnemy(inst, 400, { source: "qa" });
    const blast = (() => {
      const before = inst.health;
      T.ctx.combat.explode(b.head[0], b.head[1] + 1, b.head[2], 30, 600);
      return +(before - inst.health).toFixed(1);
    })();

    // Then let the cycle run and record the order it goes in.
    const seen = [];
    let elapsed = 0;
    let returnedBurrow = null;
    let returnedDirect = null;
    while (elapsed < 46) {
      const phase = T.coulterState().phase;
      if (seen[seen.length - 1] !== phase) seen.push(phase);
      if (phase === "burrow" && seen.length >= 5 && returnedBurrow === null) {
        T.advanceTime(0.2, 1 / 60);
        returnedBurrow = T.coulterState();
        returnedDirect = T.ctx.combat.damageEnemy(inst, 400, { source: "qa-returned-burrow" });
      }
      if (seen.length >= 6) break;
      T.advanceTime(0.1, 1 / 60);
      elapsed += 0.1;
    }
    return {
      start, overhead, direct, blast, returnedBurrow, returnedDirect,
      seen, elapsed: +elapsed.toFixed(1),
      wake: (T.ctx.coulter.group.children || [])
        .filter((c) => c.name?.startsWith("sf-wake") && c.visible).length,
    };
  });
  console.log(`  at spawn: ${JSON.stringify(hunt.start)}`);
  console.log(`  shot from overhead: ${JSON.stringify(hunt.overhead)}`);
  console.log(`  direct damage call: ${hunt.direct} · 30m blast: ${hunt.blast}`);
  console.log(`  phase order over ${hunt.elapsed}s: ${hunt.seen.join(" -> ")}`);
  check(hunt.start.phase === "burrow" && hunt.start.submerged,
    "it arrives underground", JSON.stringify(hunt.start));
  check(hunt.start.depth > 3, "and deep enough to be gone",
    `${hunt.start.depth}m of sand over it`);
  check(!hunt.overhead.hit && hunt.overhead.dmg === 0,
    "a shot into the ground above it does nothing", JSON.stringify(hunt.overhead));
  check(hunt.direct === 0, "and neither does a direct damage call",
    `${hunt.direct} dealt while submerged`);
  check(hunt.blast === 0, "or a stratagem dropped on the wake",
    `${hunt.blast} dealt while submerged`);
  check(hunt.seen.slice(0, 4).join(",") === "burrow,rise,crest,dive",
    "the cycle runs burrow -> rise -> crest -> dive",
    hunt.seen.join(" -> "));
  check(hunt.seen.length >= 5 && hunt.seen[4] === "burrow",
    "and then goes back down to hunt again", hunt.seen.join(" -> "));
  check(hunt.returnedBurrow?.submerged && hunt.returnedDirect === 0,
    "the full giant body is untouchable again after its dive",
    `${JSON.stringify(hunt.returnedBurrow)} · ${hunt.returnedDirect} direct damage`);

  /* ---------------- the crest ---------------- */
  console.log("\n=== THE CREST ===");
  const crest = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    const waited = T.advanceToCoulterPhase("crest", 60);
    const b = T.coulterBodies().find((body) => body.id === inst.id);
    const ground = T.groundHeightAt(b.head[0], b.head[2]);
    const fireAt = (from, to, damage = 300) => {
      const o = new THREE.Vector3(...from);
      const d = new THREE.Vector3(...to).sub(o).normalize();
      const before = inst.health;
      const hit = T.ctx.combat.fire(o, d, { damage, range: 300 });
      return { dmg: +(before - inst.health).toFixed(1), hit: !!hit,
        weak: !!(hit && hit.weak) };
    };
    /* A level shot at the apex of the arch from 26m out, which is the
       shot a player actually takes at a reared worm: the body, well
       above the sand, not the mouth. Aimed at the highest joint rather
       than a fixed index - which vertebra is at the top depends on how
       steeply it came up. */
    const aimAt = (p, offset = 26) => {
      const dx = p[0] - inst.body.head.x;
      const dz = p[2] - inst.body.head.z;
      const len = Math.hypot(dx, dz) || 1;
      const ox = p[0] + (dx / len) * offset + offset * 0.5;
      const oz = p[2] + (dz / len) * offset;
      // Lifted clear of whatever dune the muzzle ends up standing on -
      // a shot that starts inside the terrain is stopped by the terrain
      // and proves nothing about the animal.
      const oy = Math.max(p[1], T.groundHeightAt(ox, oz) + 2.2);
      return fireAt([ox, oy, oz], p);
    };
    let apex = b.joints[0];
    let apexClear = -Infinity;
    for (const j of b.joints) {
      const clear = j[1] - T.groundHeightAt(j[0], j[2]);
      if (clear > apexClear) { apexClear = clear; apex = j; }
    }
    const bodyShot = aimAt(apex);
    const emptyAir = aimAt([b.head[0] + 60, b.head[1] + 30, b.head[2] + 60]);

    /* THE MAW. Shut first, then forced open, from the same place, with
       the same damage - so the only variable is the aperture. */
    const mawForward = 1.35 * (inst.spec.bodyHitScale || 1);
    const mawTargetX = inst.body.head.x + inst.body.dir.x * mawForward;
    const mawTargetY = inst.body.head.y + inst.body.dir.y * mawForward;
    const mawTargetZ = inst.body.head.z + inst.body.dir.z * mawForward;
    const heading = Math.atan2(inst.body.dir.x, inst.body.dir.z);
    let mawRay = null;
    for (const offset of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, Math.PI]) {
      const angle = heading + offset;
      const ox = mawTargetX + Math.sin(angle) * 30;
      const oz = mawTargetZ + Math.cos(angle) * 30;
      const oy = Math.max(mawTargetY + 8, T.groundHeightAt(ox, oz) + 3);
      const dx = mawTargetX - ox;
      const dy = mawTargetY - oy;
      const dz = mawTargetZ - oz;
      const distance = Math.hypot(dx, dy, dz);
      const wall = T.ctx.collide.rayBlock(ox, oy, oz,
        dx / distance, dy / distance, dz / distance, 300);
      const candidate = { origin: [ox, oy, oz], target: [mawTargetX, mawTargetY, mawTargetZ],
        wall, targetDistance: distance, dir: inst.body.dir.toArray() };
      if (!mawRay || wall > mawRay.wall) mawRay = candidate;
      if (wall >= distance - 0.05) { mawRay = candidate; break; }
    }
    inst.body.mawOpen = 0;
    const mouthShut = fireAt(
      mawRay.origin,
      [mawTargetX, mawTargetY, mawTargetZ]);
    inst.body.mawOpen = 1;
    const mouthOpen = fireAt(
      mawRay.origin,
      [mawTargetX, mawTargetY, mawTargetZ]);
    return {
      waited, aboveGround: b.aboveGround, joints: b.joints.length,
      clearance: +(b.head[1] - ground).toFixed(2),
      apexClear: +apexClear.toFixed(2),
      hidden: b.hidden,
      mawRay,
      bodyShot, emptyAir, mouthShut, mouthOpen,
      /* The chain's own integrity while it is arched: no two adjacent
         vertebrae may sit further apart than the segment length they
         were authored at, or the body has come apart at a seam.
         Measured vertebra to vertebra only - the mouth is 2.97m of
         rigid head and first segment ahead of joint 0, so including it
         measures the neck and calls it a break. */
      gap: +Math.max(...b.joints.slice(1).map((j, i) => Math.hypot(
        j[0] - b.joints[i][0], j[1] - b.joints[i][1], j[2] - b.joints[i][2],
      ))).toFixed(2),
      neck: +Math.hypot(b.joints[0][0] - b.head[0], b.joints[0][1] - b.head[1],
        b.joints[0][2] - b.head[2]).toFixed(2),
    };
  });
  console.log(`  crested after ${crest.waited}s · head ${crest.clearance}m clear of `
    + `the sand · ${crest.aboveGround}/${crest.joints} joints above ground`);
  console.log(`  apex joint ${crest.apexClear}m up · longest vertebra gap ${crest.gap}m `
    + `· neck ${crest.neck}m of 2.97m`);
  console.log(`  body shot: ${JSON.stringify(crest.bodyShot)}`);
  console.log(`  empty air: ${JSON.stringify(crest.emptyAir)}`);
  console.log(`  maw shut : ${JSON.stringify(crest.mouthShut)}`);
  console.log(`  maw open : ${JSON.stringify(crest.mouthOpen)}`);
  if (!crest.mouthOpen.hit) console.log(`  maw ray  : ${JSON.stringify(crest.mawRay)}`);
  check(crest.waited >= 0, "it surfaces on its own", `after ${crest.waited}s`);
  check(!crest.hidden, "and is no longer hidden once it is up");
  check(crest.clearance > 4, "it rears well clear of the sand",
    `${crest.clearance}m`);
  check(crest.aboveGround >= 2,
    "the colossal crest brings articulated body joints out with the head",
    `${crest.aboveGround} of ${crest.joints}`);
  check(crest.gap <= 8.1,
    "the body holds together: every vertebra stays a segment from the last",
    `longest gap ${crest.gap}m against a 7.98m scaled segment`);
  check(crest.neck <= 14.0 && crest.neck > 7,
    "and the mouth stays on the end of its own neck",
    `${crest.neck}m against 13.78m of scaled head plus first segment`);
  check(crest.bodyShot.hit && crest.bodyShot.dmg > 0,
    "the reared body can be shot", JSON.stringify(crest.bodyShot));
  check(!crest.emptyAir.hit && crest.emptyAir.dmg === 0,
    "and the air beside it cannot");
  check(crest.mouthShut.hit && !crest.mouthShut.weak,
    "a shot into a closed mouth is an ordinary hit",
    JSON.stringify(crest.mouthShut));
  check(crest.mouthOpen.weak
    && crest.mouthOpen.dmg > crest.mouthShut.dmg * 3.5,
    "an open maw is the weak point and is worth going for",
    `${crest.mouthOpen.dmg} open vs ${crest.mouthShut.dmg} shut`);

  await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    const b = T.coulterBodies().find((body) => body.id === inst.id);
    T.hidePlayer(true);
    T.lookAt([b.head[0] + 26, b.head[1] + 6, b.head[2] + 24],
      [b.head[0], b.head[1] - 3, b.head[2]], 46);
    for (let i = 0; i < 5; i += 1) T.renderStill();
  });
  await shot(page, "crest.png");

  /* ---------------- venom ---------------- */
  console.log("\n=== VENOM ===");
  const venom = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    /* THE PLAYER HAS TO BE IN THEIR OWN BODY TO BE HURT. The beauty
       shot above leaves the camera detached, and combat.js drops every
       point of damage while it is - deliberately, so a reveal hold
       cannot kill the trooper it is showing off. Nothing else here
       clears it, so the venom read as harmless: the pool was under the
       player, the toxin climbed to 1.0, and the hurt was thrown away at
       the gate. Measure hazards with the trooper in charge. */
    T.releaseCamera();
    T.autoPlayer();
    T.clearVenom();
    T.setToxin(0);
    T.invulnerable(false);
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;

    // Force a spew and follow the globules to the ground.
    T.setCoulterPhase("crest", 9);
    inst.body.spewsLeft = 4;
    inst.body.fireTimer = 0;
    inst.body.action = 0;
    // Player out of bite reach so it chooses the ranged attack.
    T.player.spawn(inst.body.head.x, inst.body.head.z + 34, Math.PI);
    let launched = 0;
    let pools = [];
    for (let i = 0; i < 300 && pools.length === 0; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      launched = Math.max(launched, T.coulterState().globules);
      pools = T.venomPools();
    }
    const hpBefore = T.ctx.combat.player.hp;
    const pool = pools[0];
    // Stand in it. Counted by SOURCE for the same reason the bite is:
    // the basin is garrisoned, and a Gleaner landing a bolt while the
    // player stands in a puddle would pass this check with the venom
    // doing nothing at all.
    const venomHits = [];
    const offVenom = T.ctx.combat.bus.on("playerHurt", (e) => {
      if (String(e.source).startsWith("venom")) {
        venomHits.push(+Number(e.damage || 0).toFixed(1));
      }
    });
    T.player.spawn(pool.x, pool.z, Math.PI);
    T.advanceTime(2.0, 1 / 60);
    if (offVenom) offVenom();
    const inside = {
      hp: +T.ctx.combat.player.hp.toFixed(1),
      venomDamage: +venomHits.reduce((sum, v) => sum + v, 0).toFixed(1),
      ticks: venomHits.length,
      toxin: T.coulterState().toxin,
      inVenom: T.coulterState().inVenom,
    };
    // And step out of it.
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    T.setToxin(0);
    T.player.spawn(pool.x + 26, pool.z + 26, Math.PI);
    T.advanceTime(2.0, 1 / 60);
    const outside = {
      hp: +T.ctx.combat.player.hp.toFixed(1),
      toxin: T.coulterState().toxin,
      inVenom: T.coulterState().inVenom,
    };
    /* The pool has to expire on its own - and the check has to be run
       with the animal PARKED, because a crested Coulter spends those
       same seconds throwing more venom and the population never drops.
       (It did not, the first time this ran, and the failure was the
       test's rather than the pool's.) */
    T.setCoulterPhase("burrow", 30);
    inst.body.parked = true;
    inst.body.spewsLeft = 0;
    T.player.spawn(0, -20, Math.PI);
    T.clearVenom();
    T.spillVenom(inst.body.head.x + 240, inst.body.head.z + 240);
    T.advanceTime(0.4, 1 / 60);
    const before = T.venomPools().length;
    T.advanceTime(T.ctx.coulter.config.poolSeconds + 2, 1 / 30);
    const after = T.venomPools().length;
    inst.body.parked = false;
    T.invulnerable(true);
    return { launched, poolCount: pools.length, hpBefore, inside, outside,
      before, after, config: T.ctx.coulter.config.poolSeconds };
  });
  console.log(`  ${venom.launched} globules in flight · ${venom.poolCount} pool(s) landed`);
  console.log(`  standing in it for 2s: ${JSON.stringify(venom.inside)}`);
  console.log(`  standing clear for 2s: ${JSON.stringify(venom.outside)}`);
  console.log(`  pools after ${venom.config}s+: ${venom.after} (from ${venom.before})`);
  check(venom.launched >= 3, "a spew throws a clutch of globules",
    `${venom.launched} at once`);
  check(venom.poolCount >= 1, "and they leave venom where they land");
  check(venom.inside.venomDamage > 0 && venom.inside.toxin > 0.2
    && venom.inside.inVenom,
    "standing in venom poisons and hurts the player",
    JSON.stringify(venom.inside));
  check(venom.outside.toxin === 0 && !venom.outside.inVenom,
    "standing clear of venom does not poison the player", JSON.stringify(venom.outside));
  check(venom.after === 0, "the venom expires on its own",
    `${venom.after} pools left after ${venom.config}s`);

  await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    const b = T.coulterBodies().find((body) => body.id === inst.id);
    T.clearVenom();
    for (let i = 0; i < 3; i += 1) {
      T.spillVenom(b.head[0] + 4 - i * 6, b.head[2] + 12 + i * 5);
    }
    T.advanceTime(0.9, 1 / 60);
    T.hidePlayer(true);
    T.lookAt([b.head[0] + 14, b.head[1] + 3, b.head[2] + 30],
      [b.head[0] + 1, b.head[1] - 6, b.head[2] + 12], 50);
    for (let i = 0; i < 5; i += 1) T.renderStill();
  });
  await shot(page, "venom.png");

  /* ---------------- the bite ---------------- */
  console.log("\n=== THE BITE ===");
  const bite = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    // Likewise, and for the venom photograph above: see THE VENOM.
    T.releaseCamera();
    T.autoPlayer();
    T.clearVenom();
    T.setToxin(0);
    T.invulnerable(false);
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    T.setCoulterPhase("crest", 9);
    inst.body.spewsLeft = 0;
    inst.body.fireTimer = 0;
    inst.body.action = 0;

    /* WHOSE DAMAGE IT WAS, not how much health went missing.
       The Fallen Saint's basin is garrisoned, and reading the
       player's HP counts a Gleaner's spinneret as a bite from a
       hundred-metre worm: this check was measuring 28 points of
       `enemy-fire` landing from 56m away and calling it a Coulter that
       could reach past its own reach. Sum only what the animal itself
       is credited with, which is the same distinction combat.js emits
       `enemyKey` for. */
    const tally = () => {
      const hits = [];
      const off = T.ctx.combat.bus.on("playerHurt", (e) => hits.push({
        source: e.source,
        damage: +Number(e.damage || 0).toFixed(1),
        dist: +Math.hypot(T.ctx.player.state.x - inst.body.head.x,
          T.ctx.player.state.z - inst.body.head.z).toFixed(1),
      }));
      return () => {
        if (off) off();
        const mine = hits.filter((h) => String(h.source).startsWith("coulter"));
        return {
          coulter: +mine.reduce((sum, h) => sum + h.damage, 0).toFixed(1),
          others: hits.filter((h) => !String(h.source).startsWith("coulter"))
            .map((h) => h.source),
          hits: mine,
        };
      };
    };

    /* Right under the mouth. `biteReach` is horizontal, so standing at
       the animal's feet is inside it - which is the point: closing on a
       reared Coulter to shoot the maw is supposed to be dangerous. */
    T.player.spawn(inst.body.head.x + 3, inst.body.head.z + 3, Math.PI);
    const hpBefore = T.ctx.combat.player.hp;
    const closeTally = tally();
    T.advanceTime(2.5, 1 / 60);
    const nearHits = closeTally();
    const near = +T.ctx.combat.player.hp.toFixed(1);
    // And then well outside it, where the bite must miss.
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    inst.body.fireTimer = 0;
    inst.body.action = 0;
    inst.body.spewsLeft = 0;
    T.player.spawn(inst.body.head.x + 40, inst.body.head.z + 40, Math.PI);
    const farTally = tally();
    T.advanceTime(2.5, 1 / 60);
    const farHits = farTally();
    const far = +T.ctx.combat.player.hp.toFixed(1);
    T.invulnerable(true);
    return { hpBefore, near, far, nearHits, farHits,
      /* The distance the far case actually stands at: the offset is
         applied on both axes, so "40m away" is 56.6m diagonally. */
      farDistance: +Math.hypot(40, 40).toFixed(1),
      reach: T.ctx.coulter.config.biteReach };
  });
  console.log(`  under the mouth: ${venomHp(bite.hpBefore)} -> ${bite.near} `
    + `· ${bite.nearHits.coulter} of it the Coulter's `
    + `(${bite.nearHits.hits.map((h) => h.source).join(",") || "none"})`);
  console.log(`  ${bite.farDistance}m away     : 150 -> ${bite.far} `
    + `· ${bite.farHits.coulter} of it the Coulter's`);
  if (bite.farHits.others.length) {
    console.log(`  garrison fire the far case ignored: `
      + `${bite.farHits.others.join(", ")}`);
  }
  check(bite.nearHits.coulter > 0, "it bites what is standing under it",
    `${bite.nearHits.coulter} damage from ${bite.nearHits.hits.length} bite(s)`);
  check(bite.farHits.coulter === 0, "and cannot reach past its own reach",
    `${bite.farHits.coulter} dealt at ${bite.farDistance}m `
    + `against a ${bite.reach}m reach`);

  /* ---------------- death ---------------- */
  console.log("\n=== DEATH ===");
  const death = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    T.setCoulterPhase("crest", 9);
    T.advanceTime(0.4, 1 / 60);
    const beforeBody = T.coulterBodies().find((body) => body.id === inst.id);
    const highBefore = Math.max(...beforeBody.joints.map(
      (j) => j[1] - T.groundHeightAt(j[0], j[2])));
    T.ctx.combat.damageEnemy(inst, 1e7, { source: "qa" });
    const state = inst.state;
    T.advanceTime(6, 1 / 60);
    const afterBody = T.coulterBodies().find((body) => body.id === inst.id);
    const highAfter = Math.max(...afterBody.joints.map(
      (j) => j[1] - T.groundHeightAt(j[0], j[2])));
    const spread = (b) => {
      let max = 0;
      for (let i = 1; i < b.joints.length; i += 1) {
        max = Math.max(max, Math.hypot(b.joints[i][0] - b.joints[i - 1][0],
          b.joints[i][1] - b.joints[i - 1][1], b.joints[i][2] - b.joints[i - 1][2]));
      }
      return +max.toFixed(2);
    };
    return {
      state, phase: afterBody.phase,
      highBefore: +highBefore.toFixed(2), highAfter: +highAfter.toFixed(2),
      segBefore: spread(beforeBody), segAfter: spread(afterBody),
    };
  });
  console.log(`  clip ${death.state} · phase ${death.phase}`);
  console.log(`  highest joint above sand: ${death.highBefore}m -> ${death.highAfter}m`);
  console.log(`  longest joint gap: ${death.segBefore}m -> ${death.segAfter}m`);
  check(death.state === "death", "the death clip plays");
  check(death.highAfter < death.highBefore * 0.5 + 1.0,
    "the body falls out of the air instead of snapping straight",
    `${death.highBefore}m -> ${death.highAfter}m`);
  check(death.segAfter < 12.1,
    "and stays a body: no joint pulls away from its neighbour",
    `longest gap ${death.segAfter}m`);

  await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    const b = T.coulterBodies().find((body) => body.id === inst.id);
    T.lookAt([b.joints[3][0] + 22, b.joints[3][1] + 9, b.joints[3][2] + 20],
      [b.joints[4][0], b.joints[4][1], b.joints[4][2]], 50);
    for (let i = 0; i < 5; i += 1) T.renderStill();
  });
  await shot(page, "death.png");

  /* ---------------- the Fallen Saint progression owns it ---------------- */
  console.log("\n=== PLACEMENT ===");
  const placed = await page.evaluate(() => {
    const T = window.__SF;
    T.clearVenom();
    const M = T.ctx.mission;
    M.state.phase = "districtBosses";
    M.state.bossesDone = 0;
    for (const boss of M.bosses) boss.done = false;
    const waves = T.ctx.breaches.waves.map((w) => ({
      name: w.name, boss: !!w.boss, bossKey: w.bossKey || null,
      roster: w.roster.map((r) => `${r.key}x${r.count}`).join("+"),
    }));
    for (const status of T.ctx.districtBosses.status()) {
      T.ctx.districtBosses.reset(status.key);
    }
    T.ctx.distaff.resetToLair();
    T.ctx.winnower.resetToPerch();
    const staged = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    const garrisoned = T.ctx.enemies.live.filter((e) => e.key === "coulter").length;
    const saint = T.ctx.districtBosses.status("saint");
    T.player.spawn(-350, 350, 0);
    T.startBreachWave(waves.length - 1, -350, 290, true);
    const members = T.ctx.breaches.members.map((m) => m.key);
    const warning = T.ctx.breaches.objective();
    // Past the warning countdown, where the order becomes the boss's.
    T.advanceTime(0.6, 1 / 60);
    const status = T.breachState();
    const objective = T.ctx.breaches.objective();
    return { waves, garrisoned, saint, stagedScale: staged?.root?.scale?.x || 0,
      members, status, objective, warning };
  });
  console.log(`  waves: ${placed.waves.map((w, i) => `${i + 1}. ${w.name}`
    + `${w.boss ? ` [boss:${w.bossKey}]` : ""}`).join("  ")}`);
  console.log(`  final roaming wave roster: ${placed.members.join(", ")}`);
  console.log(`  objective: ${placed.objective?.name} · boss bar `
    + `${placed.status.boss ? `${placed.status.boss.health}/${placed.status.boss.maxHealth}` : "none"}`);
  check(placed.garrisoned === 1 && placed.saint?.hidden && placed.saint?.locked
      && !placed.saint?.available,
    "the Coulter waits hidden beneath the locked Fallen Saint arena",
    `${placed.garrisoned} staged · available=${placed.saint?.available}`);
  check(placed.stagedScale >= 4.6,
    "the staged encounter keeps the colossal authored scale",
    `${placed.stagedScale.toFixed(2)}x root scale`);
  check(placed.waves.length === 6 && placed.waves.every((wave) => !wave.bossKey
      && !/coulter/i.test(wave.roster)),
    "the Coulter has been removed from every intermittent Bloom wave",
    placed.waves.map((w) => w.bossKey || "-").join(","));
  check(placed.members.length > 0 && !placed.members.includes("coulter"),
    "the last roaming wave contains only field castes", placed.members.join(","));
  check(!placed.status.boss && !/COULTER/.test(placed.objective?.name || ""),
    "roaming wave HUD state cannot impersonate the Fallen Saint boss",
    placed.objective?.name);

  /* ---------------- save state ---------------- */
  console.log("\n=== PERSISTENCE ===");
  const saved = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    /* A field save refuses while the review camera is detached from the
       trooper, which the beauty shots above leave it. Put the player
       back in charge of their own body first. */
    T.releaseCamera();
    T.autoPlayer();
    T.hidePlayer(false);
    T.player.spawn(inst.body.head.x + 30, inst.body.head.z + 30, Math.PI);
    T.advanceTime(0.5, 1 / 60);
    T.setCoulterPhase("crest", 4.25);
    inst.body.surfacings = 3;
    T.setToxin(0.4);
    T.advanceTime(0.2, 1 / 60);
    const snapshot = T.saves.capture();
    if (!snapshot) return { blocked: T.saves.saveReason() };
    const record = snapshot.enemies.live.find((e) => e.eventId === "district-boss:saint");
    const accepted = T.saves.apply(snapshot);
    const ids = new Set(snapshot.enemies.live.map((enemy) => enemy.id));
    const refs = [snapshot.distaff, snapshot.winnower,
      ...(snapshot.districtBosses?.bosses || [])]
      .filter((entry) => entry?.instanceId && !ids.has(entry.instanceId))
      .map((entry) => ({ key: entry.key || "dedicated", id: entry.instanceId }));
    const after = T.coulterState();
    const bodies = T.coulterBodies();
    return { record, coulter: snapshot.coulter, accepted, refs,
      mission: { phase: snapshot.mission.phase, bossesDone: snapshot.mission.bossesDone,
        done: snapshot.mission.bosses.filter((boss) => boss.done).map((boss) => boss.key) },
      breach: { phase: snapshot.breaches.phase, waveIndex: snapshot.breaches.waveIndex,
        members: snapshot.breaches.memberIds.length }, after,
      restored: bodies.length,
      span: bodies[0] ? +Math.hypot(
        bodies[0].joints[bodies[0].joints.length - 1][0] - bodies[0].head[0],
        bodies[0].joints[bodies[0].joints.length - 1][2] - bodies[0].head[2],
      ).toFixed(2) : 0 };
  });
  if (saved.blocked) console.log(`  save refused: ${saved.blocked}`);
  console.log(`  written: ${JSON.stringify(saved.record?.body)}`);
  console.log(`  venom:   ${JSON.stringify(saved.coulter)}`);
  console.log(`  reloaded: accepted=${saved.accepted} phase=${saved.after.phase} `
    + `surfacings=${saved.after.surfacings} body span ${saved.span}m`);
  if (!saved.accepted) console.log(`  invalid refs: ${JSON.stringify(saved.refs)} · `
    + `mission ${JSON.stringify(saved.mission)} · breach ${JSON.stringify(saved.breach)}`);
  check(!!saved.record?.body && saved.record.body.phase === "crest",
    "the cycle phase is written to the save", JSON.stringify(saved.record?.body));
  check(saved.accepted === true,
    "a save carrying a burrower passes validation");
  check(saved.restored === 1 && saved.after.phase === "crest"
    && saved.after.surfacings === 3,
    "and the phase, timer and surfacing count survive the round trip",
    JSON.stringify(saved.after));
  check(saved.span > 12,
    "the body is laid out straight again on load rather than balled up",
    `${saved.span}m end to end`);
  check(saved.coulter && Math.abs(saved.coulter.toxin - 0.4) < 0.05,
    "the player's venom load persists", JSON.stringify(saved.coulter));

  /* ---------------- cost ---------------- */
  console.log("\n=== COST ===");
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    T.setCoulterPhase("crest", 60);
    T.player.spawn(inst.body.head.x + 14, inst.body.head.z + 14, Math.PI);
    for (let i = 0; i < 6; i += 1) T.spillVenom(inst.body.head.x + i * 5 - 12,
      inst.body.head.z + 10 + i * 3);
    for (let i = 0; i < 30; i += 1) T.renderStill();
    const t0 = performance.now();
    for (let i = 0; i < 150; i += 1) T.renderStill();
    const ms = (performance.now() - t0) / 150;
    return { ms: +ms.toFixed(2), calls: T.report().render.calls,
      pools: T.venomPools().length };
  });
  console.log(`  giant boss crested at close range with ${cost.pools} pools: ${cost.ms}ms/frame `
    + `· ${cost.calls} draw calls`);
  check(cost.ms < 9, "the encounter renders at close range", `${cost.ms}ms/frame`);

  check(pageErrors.length === 0, "no page or console errors",
    pageErrors.slice(0, 3).join(" | "));

  console.log(findings.length
    ? `\n${findings.length} FAILED: ${findings.join(", ")}`
    : "\nthe encounter behaves");
  await browser.close();
  process.exitCode = findings.length ? 1 : 0;
} finally {
  server.kill("SIGTERM");
}

function venomHp(v) { return Number(v).toFixed(1); }
