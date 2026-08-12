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
    T.clearEnemies();
    const site = T.findFlatSite(18);
    T.spawnEnemy("coulter", site[0], site[1], { yaw: 0 });
    T.advanceTime(0.1, 1 / 60);
    const inst = T.ctx.enemies.live[0];
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
      body: bodies[0] || null,
      site,
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
  check(rig.span > 20 && rig.span < 30, "it is a landmark-sized animal",
    `${rig.span}m from mouth to tail`);
  check(rig.arcs.every((v, i) => i === 0 || v > rig.arcs[i - 1]),
    "the joint arc lengths increase monotonically down the body");

  /* ---------------- it starts underground ---------------- */
  console.log("\n=== THE HUNT ===");
  const hunt = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const inst = T.ctx.enemies.live[0];
    inst.health = 1e6;
    const site = [inst.body.head.x, inst.body.head.z];
    // Stand the player well clear so the hunt phase has to travel.
    T.player.spawn(site[0], site[1] + 70, Math.PI);
    T.advanceTime(0.3, 1 / 60);
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
    const b = T.coulterBodies()[0];
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
    while (elapsed < 46) {
      const phase = T.coulterState().phase;
      if (seen[seen.length - 1] !== phase) seen.push(phase);
      if (seen.length >= 6) break;
      T.advanceTime(0.1, 1 / 60);
      elapsed += 0.1;
    }
    return {
      start, overhead, direct, blast, seen, elapsed: +elapsed.toFixed(1),
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

  /* ---------------- the crest ---------------- */
  console.log("\n=== THE CREST ===");
  const crest = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const inst = T.ctx.enemies.live[0];
    const waited = T.advanceToCoulterPhase("crest", 60);
    const b = T.coulterBodies()[0];
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
    inst.body.mawOpen = 0;
    const mouthShut = fireAt(
      [inst.body.head.x + inst.body.dir.x * 26, inst.body.head.y + 0.2,
        inst.body.head.z + inst.body.dir.z * 26],
      [inst.body.head.x + inst.body.dir.x * 1.35, inst.body.head.y,
        inst.body.head.z + inst.body.dir.z * 1.35]);
    inst.body.mawOpen = 1;
    const mouthOpen = fireAt(
      [inst.body.head.x + inst.body.dir.x * 26, inst.body.head.y + 0.2,
        inst.body.head.z + inst.body.dir.z * 26],
      [inst.body.head.x + inst.body.dir.x * 1.35, inst.body.head.y,
        inst.body.head.z + inst.body.dir.z * 1.35]);
    return {
      waited, aboveGround: b.aboveGround, joints: b.joints.length,
      clearance: +(b.head[1] - ground).toFixed(2),
      apexClear: +apexClear.toFixed(2),
      hidden: b.hidden,
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
  check(crest.waited >= 0, "it surfaces on its own", `after ${crest.waited}s`);
  check(!crest.hidden, "and is no longer hidden once it is up");
  check(crest.clearance > 4, "it rears well clear of the sand",
    `${crest.clearance}m`);
  check(crest.aboveGround >= 3,
    "several body joints are out of the ground, not just the head",
    `${crest.aboveGround} of ${crest.joints}`);
  check(crest.gap <= 1.9,
    "the body holds together: every vertebra stays a segment from the last",
    `longest gap ${crest.gap}m against a 1.72m segment`);
  check(crest.neck <= 3.1 && crest.neck > 1.5,
    "and the mouth stays on the end of its own neck",
    `${crest.neck}m against 2.97m of head plus first segment`);
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
    const b = T.coulterBodies()[0];
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
    const inst = T.ctx.enemies.live[0];
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
    // Stand in it.
    T.player.spawn(pool.x, pool.z, Math.PI);
    T.advanceTime(2.0, 1 / 60);
    const inside = {
      hp: +T.ctx.combat.player.hp.toFixed(1),
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
    inst.body.spewsLeft = 0;
    T.player.spawn(inst.body.head.x + 260, inst.body.head.z + 260, Math.PI);
    T.clearVenom();
    T.spillVenom(inst.body.head.x + 240, inst.body.head.z + 240);
    T.advanceTime(0.4, 1 / 60);
    const before = T.venomPools().length;
    T.advanceTime(T.ctx.coulter.config.poolSeconds + 2, 1 / 30);
    const after = T.venomPools().length;
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
  check(venom.inside.hp < venom.hpBefore && venom.inside.toxin > 0.2
    && venom.inside.inVenom,
    "standing in venom poisons and hurts the player",
    JSON.stringify(venom.inside));
  check(venom.outside.hp === 150 && !venom.outside.inVenom,
    "standing clear of it does neither", JSON.stringify(venom.outside));
  check(venom.after === 0, "the venom expires on its own",
    `${venom.after} pools left after ${venom.config}s`);

  await page.evaluate(() => {
    const T = window.__SF;
    const b = T.coulterBodies()[0];
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
    const inst = T.ctx.enemies.live[0];
    T.clearVenom();
    T.setToxin(0);
    T.invulnerable(false);
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    T.setCoulterPhase("crest", 9);
    inst.body.spewsLeft = 0;
    inst.body.fireTimer = 0;
    inst.body.action = 0;
    /* Right under the mouth. `biteReach` is horizontal, so standing at
       the animal's feet is inside it - which is the point: closing on a
       reared Coulter to shoot the maw is supposed to be dangerous. */
    T.player.spawn(inst.body.head.x + 3, inst.body.head.z + 3, Math.PI);
    const hpBefore = T.ctx.combat.player.hp;
    T.advanceTime(2.5, 1 / 60);
    const near = +T.ctx.combat.player.hp.toFixed(1);
    // And then well outside it, where the bite must miss.
    T.ctx.combat.player.hp = T.ctx.combat.player.maxHp;
    inst.body.fireTimer = 0;
    inst.body.action = 0;
    inst.body.spewsLeft = 0;
    T.player.spawn(inst.body.head.x + 40, inst.body.head.z + 40, Math.PI);
    T.advanceTime(2.5, 1 / 60);
    const far = +T.ctx.combat.player.hp.toFixed(1);
    T.invulnerable(true);
    return { hpBefore, near, far, reach: T.ctx.coulter.config.biteReach };
  });
  console.log(`  under the mouth: ${venomHp(bite.hpBefore)} -> ${bite.near}`);
  console.log(`  40m away       : 150 -> ${bite.far}`);
  check(bite.near < bite.hpBefore, "it bites what is standing under it",
    `${bite.hpBefore} -> ${bite.near}`);
  check(bite.far === 150, "and cannot reach past its own reach",
    `${bite.far} at 40m against a ${bite.reach}m reach`);

  /* ---------------- death ---------------- */
  console.log("\n=== DEATH ===");
  const death = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live[0];
    T.setCoulterPhase("crest", 9);
    T.advanceTime(0.4, 1 / 60);
    const beforeBody = T.coulterBodies()[0];
    const highBefore = Math.max(...beforeBody.joints.map(
      (j) => j[1] - T.groundHeightAt(j[0], j[2])));
    T.ctx.combat.damageEnemy(inst, 1e7, { source: "qa" });
    const state = inst.state;
    T.advanceTime(6, 1 / 60);
    const afterBody = T.coulterBodies()[0];
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
  check(death.segAfter < 2.6,
    "and stays a body: no joint pulls away from its neighbour",
    `longest gap ${death.segAfter}m`);

  await page.evaluate(() => {
    const T = window.__SF;
    const b = T.coulterBodies()[0];
    T.lookAt([b.joints[3][0] + 22, b.joints[3][1] + 9, b.joints[3][2] + 20],
      [b.joints[4][0], b.joints[4][1], b.joints[4][2]], 50);
    for (let i = 0; i < 5; i += 1) T.renderStill();
  });
  await shot(page, "death.png");

  /* ---------------- the breach progression owns it ---------------- */
  console.log("\n=== PLACEMENT ===");
  const placed = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.clearVenom();
    const waves = T.ctx.breaches.waves.map((w) => ({
      name: w.name, boss: !!w.boss, bossKey: w.bossKey || null,
      roster: w.roster.map((r) => `${r.key}x${r.count}`).join("+"),
    }));
    const garrisoned = T.ctx.enemies.live.filter((e) => e.key === "coulter").length;
    const ps = T.playerState();
    T.startBreachWave(waves.length - 1, ps.x, ps.z - 60, true);
    const members = T.ctx.breaches.members.map((m) => m.key);
    const warning = T.ctx.breaches.objective();
    // Past the warning countdown, where the order becomes the boss's.
    T.advanceTime(0.6, 1 / 60);
    const status = T.breachState();
    const objective = T.ctx.breaches.objective();
    return { waves, garrisoned, members, status, objective, warning };
  });
  console.log(`  waves: ${placed.waves.map((w, i) => `${i + 1}. ${w.name}`
    + `${w.boss ? ` [boss:${w.bossKey}]` : ""}`).join("  ")}`);
  console.log(`  final wave roster: ${placed.members.join(", ")}`);
  console.log(`  objective: ${placed.objective?.name} · boss bar `
    + `${placed.status.boss ? `${placed.status.boss.health}/${placed.status.boss.maxHealth}` : "none"}`);
  check(placed.garrisoned === 0,
    "no Coulter is garrisoned on the map: it is earned",
    `${placed.garrisoned} found at boot`);
  check(placed.waves.length === 6 && placed.waves[5].bossKey === "coulter",
    "it is the last wave of the breach cycle",
    placed.waves.map((w) => w.bossKey || "-").join(","));
  check(placed.members.length === 1 && placed.members[0] === "coulter",
    "and it arrives alone", placed.members.join(","));
  check(!!placed.status.boss && placed.status.boss.maxHealth >= 5000,
    "the boss bar binds to it, not just to the Matriarch",
    JSON.stringify(placed.status.boss));
  check(/COULTER/.test(placed.objective?.name || ""),
    "the field order names it", placed.objective?.name);

  /* ---------------- save state ---------------- */
  console.log("\n=== PERSISTENCE ===");
  const saved = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((e) => e.body);
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
    const record = snapshot.enemies.live.find((e) => e.key === "coulter");
    const accepted = T.saves.apply(snapshot);
    const after = T.coulterState();
    const bodies = T.coulterBodies();
    return { record, coulter: snapshot.coulter, accepted, after,
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
    const inst = T.ctx.enemies.live.find((e) => e.body);
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
  console.log(`  boss crested at 20m with ${cost.pools} pools: ${cost.ms}ms/frame `
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
