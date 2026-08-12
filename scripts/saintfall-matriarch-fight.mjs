#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Matriarch encounter, checked

   The model can be reviewed from pictures. The FIGHT cannot, and
   every part of it is a place where a boss quietly stops being one:

     - a weak point the body capsule swallows is a boss that takes
       normal damage everywhere and looks like it has no mechanic;
     - a weak point that can be hit from the FRONT is a boss with no
       positioning problem, which is the entire encounter;
     - a brood that ignores its cap turns a long fight into a solid
       floor of Threshers;
     - a brood that spawns in front of the boss is a wall between the
       player and the fight rather than the cost of getting to it.

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

  /* ---------------- it is earned by the breach progression ---------------- */
  console.log("\n=== PLACEMENT ===");
  const placed = await page.evaluate(() => {
    const T = window.__SF;
    const initial = T.ctx.enemies.live.filter((e) => e.key === "matriarch").length;
    const ps = T.playerState();
    T.startBreachWave(4, ps.x, ps.z - 44, true);
    const all = T.ctx.enemies.live.filter((e) => e.key === "matriarch");
    return { initial, spawned: all.map((e) => ({ x: +e.x.toFixed(1), z: +e.z.toFixed(1),
      hp: e.health, state: e.state, emerging: !!e.emerging?.active })) };
  });
  console.log("  matriarchs on the map:", JSON.stringify(placed));
  check(placed.initial === 0, "the Matriarch is absent before the final breach",
    `${placed.initial} found at boot`);
  check(placed.spawned.length === 1 && placed.spawned[0].emerging,
    "the final breach raises exactly one Matriarch",
    `${placed.spawned.length} found after the event started`);

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

  /* ---------------- brooding ---------------- */
  console.log("\n=== BROOD ===");
  const brood = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const site = T.findFlatSite(14);
    T.spawnEnemy("matriarch", site[0], site[1], { yaw: 0 });
    const inst = T.ctx.enemies.live[0];
    inst.health = 100000;
    // Stand the player where it can be seen, but out of scythe reach.
    T.player.spawn(site[0], site[1] + 26, Math.PI);
    T.invulnerable(true);
    const samples = [];
    let firstBroodAt = -1;
    /* Positions are captured on the frame the clutch APPEARS, not at
       the end of the run. The children are born awake and charge at
       7.4m/s, so a second later they are past the boss and around it
       - which is correct behaviour and made the first version of this
       check report every clutch as spawning in front. */
    let rel = null;
    for (let s = 0; s < 520; s += 1) {
      T.advanceTime(0.25, 1 / 60);
      const kids = T.ctx.enemies.live.filter(
        (e) => e.key === "thresher" && e.state !== "death");
      if (firstBroodAt < 0 && kids.length > 0) {
        firstBroodAt = (s + 1) * 0.25;
        rel = kids.map((k) => ({
          fwd: +(k.z - inst.z).toFixed(1), side: +(k.x - inst.x).toFixed(1),
          awake: !!k.alerted,
        }));
      }
      if (s % 80 === 79) samples.push({ t: (s + 1) * 0.25, kids: kids.length });
    }
    const kids = T.ctx.enemies.live.filter(
      (e) => e.key === "thresher" && e.state !== "death");
    return { firstBroodAt, samples, count: kids.length, rel: rel || [] };
  });
  console.log(`  first clutch after ${brood.firstBroodAt}s`);
  console.log(`  population: ${JSON.stringify(brood.samples)}`);
  console.log(`  final ${brood.count} children`);
  console.log(`  positions in the boss's frame: `
    + JSON.stringify(brood.rel.slice(0, 6)));
  check(brood.firstBroodAt > 0 && brood.firstBroodAt <= 20,
    "it broods on its own clock", `first clutch at ${brood.firstBroodAt}s`);
  check(brood.count > 0 && brood.count <= 12,
    "the brood cap holds over a long fight", `${brood.count} live children`);
  check(brood.rel.every((r) => r.fwd < 0),
    "the clutch lands BEHIND the boss, not between it and the player",
    brood.rel.filter((r) => r.fwd >= 0).length + " landed in front");
  check(brood.rel.every((r) => r.awake),
    "children are born awake");

  /* ---------------- a picture of it happening ---------------- */
  await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live.find((e) => e.key === "matriarch");
    T.hidePlayer(true);
    T.lookAt([inst.x + 15, inst.y + 6.5, inst.z - 17],
      [inst.x, inst.y + 2.2, inst.z - 3], 44);
    for (let i = 0; i < 5; i += 1) T.renderStill();
  });
  const url = await page.evaluate(() => window.__SF.captureDataURL());
  await writeFile(path.join(OUT, "brood-clutch.png"),
    Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));

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
      kids: T.ctx.enemies.live.filter((e) => e.key === "thresher").length };
  });
  console.log(`  boss + ${cost.kids} children at point-blank: ${cost.ms}ms/frame `
    + `· ${cost.calls} draw calls`);
  console.log(`  the Matriarch itself: ${cost.tris} triangles · `
    + `${cost.bones} bones · ${cost.chains} IK chains`);
  check(cost.ms < 8, "the encounter renders at point-blank range",
    `${cost.ms}ms/frame`);

  /* ---------------- recurrence ----------------
     The Matriarch ends a cycle, not the ecosystem. Production holds
     this state for three real minutes; the shortened restored timer
     below proves both persistence and the restart boundary without
     making the focused test idle for the full recovery window. */
  console.log("\n=== RECURRING BLOOM CYCLE ===");
  const recurrence = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.setBreachAuto(true);
    const ps = T.playerState();
    T.startBreachWave(4, ps.x, ps.z - 44, true);
    T.advanceTime(0.05, 0.05);
    const opened = T.breachState();
    for (const inst of T.ctx.breaches.members) {
      inst.health = 0;
      inst.state = "death";
    }
    T.advanceTime(0.05, 0.05);
    const cleared = T.breachState();
    const restored = T.ctx.breaches.restore({ ...cleared, timer: 1.4, auto: true });
    T.advanceTime(0.7, 0.1);
    const resting = T.breachState();
    T.advanceTime(0.8, 0.1);
    const restarted = T.breachState();
    return {
      cooldown: T.ctx.breaches.config.cycleCooldownSeconds,
      opened, cleared, restored, resting, restarted,
      roster: T.ctx.breaches.members.filter((inst) => inst.state !== "death")
        .map((inst) => inst.key),
    };
  });
  console.log(`  cycle ${recurrence.cleared.cyclesCleared} cleared · `
    + `${recurrence.cooldown}s recovery · next phase ${recurrence.restarted.phase} `
    + `cycle ${recurrence.restarted.cycle}`);
  check(recurrence.opened.phase === "active" && recurrence.opened.wave === 5,
    "the Matriarch remains the final wave of each cycle",
    `phase=${recurrence.opened.phase} wave=${recurrence.opened.wave}`);
  check(recurrence.cooldown === 180 && recurrence.cleared.phase === "complete"
      && recurrence.cleared.complete
      && recurrence.cleared.cyclesCleared === recurrence.opened.cycle
      && recurrence.cleared.timer >= 179.9,
    "defeating the Matriarch opens a three-minute recovery window",
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
