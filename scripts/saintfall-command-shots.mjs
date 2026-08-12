#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the three field commands, checked and photographed

   All three used to resolve to the same hundred motes, so the only
   thing separating an orbital lance from a supply drop was a cooldown.
   This is the sheet that says whether they are three different events
   now, plus the assertions that keep them honest:

     - the lance's beam, ring and dust must arrive in that ORDER;
     - a salvo must be eleven detonations walking outward, not one;
     - the Gilding Rite must actually gild - more damage out, less heat
       in - and must expire on its own clock.

   Usage:  node scripts/saintfall-command-shots.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/commands");
const PORT = 49951;
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
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();
  const errors = [];
  /* Third-party fetches are not this harness's subject. The page pulls
     its display faces from fonts.gstatic.com, and that 404s often enough
     from a headless run to fail a suite that has nothing to do with
     type - which trains everyone to ignore the one check that would
     have caught a real page error. */
  const ours = (text) => !/fonts\.gstatic\.com|fonts\.googleapis\.com|cdn\.jsdelivr\.net|unpkg\.com/.test(text);
  page.on("pageerror", (e) => { if (ours(e.message)) errors.push(e.message); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text().slice(0, 200);
    if (!ours(text) || /Failed to load resource/.test(text)) return;
    errors.push(text);
  });
  page.on("requestfailed", (r) => {
    if (ours(r.url())) errors.push(`request failed ${r.url()}`);
  });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await mkdir(OUT, { recursive: true });
  await page.evaluate(() => {
    window.__SF.maximize();
    window.__SF.hideHud(true);
    window.__SF.invulnerable(true);
    window.__SF.hidePlayer(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  const grab = async (file) => {
    const url = await page.evaluate(() => window.__SF.captureDataURL());
    await writeFile(path.join(OUT, file),
      Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    console.log(`  wrote ${file}`);
  };

  /* Stage: a flat site, a camera that can see the whole radius, and a
     handful of Threshers to be underneath it. */
  const stage = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.clearVenom?.();
    const site = T.findFlatSite(34);
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      T.spawnEnemy("thresher", site[0] + Math.cos(a) * (5 + i), site[1] + Math.sin(a) * (5 + i));
    }
    T.player.spawn(site[0], site[1] + 40, Math.PI);
    return { site, ground: T.groundHeightAt(site[0], site[1]) };
  });
  const [cx, cz] = stage.site;
  const gy = stage.ground;
  const look = async (p, t, fov = 46) => {
    await page.evaluate(([a, b, f]) => window.__SF.lookAt(a, b, f), [p, t, fov]);
  };

  /* ---------------- the lance ---------------- */
  console.log("\n=== ORBITAL LANCE ===");
  await look([cx + 40, gy + 16, cz + 44], [cx, gy + 6, cz], 48);
  const lance = await page.evaluate(([x, z]) => {
    const T = window.__SF;
    const frames = [];
    const live = T.ctx.enemies.live.filter((e) => e.state !== "death").length;
    T.ctx.mission.call("orbital");
    // Straight to the arrival: the flight is a beacon and a countdown,
    // and neither is what this sheet is about.
    const shot = T.ctx.mission.pending()[0];
    T.ctx.mission.state.elapsed += 0;
    for (const record of T.ctx.mission.pending()) void record;
    const pendingShots = T.ctx.mission.pending();
    T.advanceTime(Math.max(0, (pendingShots[0]?.remaining || 4) - 0.35), 1 / 60);
    for (let i = 0; i < 44; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      frames.push({ t: +(i / 60).toFixed(3), ...T.ordnanceState() });
    }
    return {
      shot, frames,
      target: [shot.x, shot.z, T.groundHeightAt(shot.x, shot.z)],
      liveBefore: live,
      liveAfter: T.ctx.enemies.live.filter((e) => e.state !== "death").length,
    };
  }, [cx, cz]);
  const firstWith = (frames, key) => frames.findIndex((f) => f[key] > 0);
  console.log(`  beams first at frame ${firstWith(lance.frames, "beams")}, `
    + `rings at ${firstWith(lance.frames, "rings")}, `
    + `domes at ${firstWith(lance.frames, "domes")}, `
    + `scorch at ${firstWith(lance.frames, "scorches")}`);
  console.log(`  peak meshes on screen: `
    + `${Math.max(...lance.frames.map((f) => f.visible))}`);
  check(firstWith(lance.frames, "beams") >= 0, "the lance draws a beam");
  check(firstWith(lance.frames, "rings") > firstWith(lance.frames, "beams"),
    "the light arrives before the ground answers",
    `beam frame ${firstWith(lance.frames, "beams")} vs ring frame `
    + `${firstWith(lance.frames, "rings")}`);
  check(firstWith(lance.frames, "scorches") > firstWith(lance.frames, "rings"),
    "and the scar is burned in after the blast, not with it");
  check(lance.liveAfter < lance.liveBefore, "it still kills what it lands on",
    `${lance.liveBefore} -> ${lance.liveAfter}`);
  {
    const [lx, lz, ly] = lance.target;
    await look([lx + 34, ly + 15, lz + 36], [lx, ly + 5, lz], 48);
    await grab("01-lance.png");
    await page.evaluate(() => window.__SF.advanceTime(0.5, 1 / 60));
    await grab("02-lance-wave.png");
    await page.evaluate(() => window.__SF.advanceTime(2.2, 1 / 60));
    await look([lx + 22, ly + 20, lz + 24], [lx, ly, lz], 50);
    await grab("03-lance-scar.png");
  }

  /* ---------------- the salvo ---------------- */
  console.log("\n=== CLUSTER SALVO ===");
  const salvo = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const site = T.findFlatSite(34);
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      T.spawnEnemy("thresher", site[0] + Math.cos(a) * (4 + i), site[1] + Math.sin(a) * (4 + i));
    }
    T.player.spawn(site[0], site[1] + 40, Math.PI);
    T.ctx.mission.cooldowns.cluster = 0;
    const live = T.ctx.enemies.live.filter((e) => e.state !== "death").length;
    T.ctx.mission.call("cluster");
    const pendingShots = T.ctx.mission.pending();
    T.advanceTime(Math.max(0, (pendingShots[0]?.remaining || 2.4) - 0.7), 1 / 60);
    const frames = [];
    for (let i = 0; i < 90; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      frames.push({ t: +(i / 60).toFixed(3), ...T.ordnanceState() });
    }
    return {
      site, frames,
      liveBefore: live,
      liveAfter: T.ctx.enemies.live.filter((e) => e.state !== "death").length,
    };
  });
  // Every frame a new ring appears is a bomblet going off.
  let pops = 0;
  for (let i = 1; i < salvo.frames.length; i += 1) {
    if (salvo.frames[i].rings > salvo.frames[i - 1].rings) pops += 1;
  }
  const spread = salvo.frames.filter((f) => f.rings > 0).length;
  console.log(`  ${pops} separate detonations over ${(spread / 60).toFixed(2)}s `
    + `· peak ${Math.max(...salvo.frames.map((f) => f.rings))} rings at once`);
  check(pops >= 5, "the salvo detonates many times, not once",
    `${pops} distinct ring spawns`);
  check(spread / 60 > 0.5, "and walks across the target over a second",
    `${(spread / 60).toFixed(2)}s of live rings`);
  check(salvo.liveAfter < salvo.liveBefore, "it still clears what is under it",
    `${salvo.liveBefore} -> ${salvo.liveAfter}`);
  {
    const [sx, sz] = salvo.site;
    await look([sx + 34, gy + 13, sz + 38], [sx, gy + 3, sz], 50);
  }
  await grab("04-salvo-after.png");
  // ...and again, caught in the middle of the carpet rather than after
  // it: the sequence IS the effect, so a frame of the aftermath is a
  // photograph of the wrong thing.
  await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const site = T.findFlatSite(34);
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      T.spawnEnemy("thresher", site[0] + Math.cos(a) * (4 + i), site[1] + Math.sin(a) * (4 + i));
    }
    T.ctx.mission.cooldowns.cluster = 0;
    T.player.spawn(site[0], site[1] + 40, Math.PI);
    T.ctx.mission.call("cluster");
    const shots = T.ctx.mission.pending();
    T.advanceTime(Math.max(0, (shots[0]?.remaining || 2.4) - 0.62), 1 / 60);
    T.advanceTime(0.52, 1 / 60);
    window.__SF_SALVO = T.ctx.mission.pending()[0] || site;
  });
  await grab("04-salvo.png");

  /* ---------------- the rite ---------------- */
  console.log("\n=== GILDING RITE ===");
  const rite = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const site = T.findFlatSite(30);
    T.spawnEnemy("harrow", site[0], site[1] - 16, { yaw: 0 });
    T.player.spawn(site[0], site[1], Math.PI);
    const spec = T.ctx.mission.stratagems.resupply;
    const target = T.ctx.enemies.live[0];

    /* What a shot is worth, measured against a target that is put BACK
       every time. A wounded Harrow charges at 5.4m/s, and three seconds
       of stratagem flight is eighteen metres of it - far enough to walk
       behind the dune the test is shooting across, which reads as "the
       blessing does nothing" rather than as "the target left". */
    const measure = () => {
      const THREE = T.THREE;
      target.x = site[0];
      target.z = site[1] - 16;
      target.y = T.groundHeightAt(target.x, target.z);
      /* And FACING the muzzle. A creature's head is a sphere placed
         forward of its body axis and rotated by its yaw, which is
         random at spawn - so the same shot at the same height is a
         headshot or a body shot depending on which way the animal
         happened to be looking, and the multiplier under test is 1.4
         against a headshot bonus of 2.6. */
      target.yaw = 0;
      target.root.position.set(target.x, target.y, target.z);
      target.root.rotation.y = 0;
      target.health = 1e6;
      target.state = "idle";
      const box = T.ctx.combat.hitbox.harrow;
      const eye = target.y + box.head;
      const o = new THREE.Vector3(target.x, eye, target.z + 22);
      const d = new THREE.Vector3(target.x, eye, target.z).sub(o).normalize();
      const before = target.health;
      const hit = T.ctx.combat.fire(o, d, { damage: 100, range: 120 });
      return { dealt: +(before - target.health).toFixed(2), hit: !!hit };
    };
    const plain = measure();
    const heatPlain = (() => {
      T.ctx.weapons.setHeat?.(0, { reason: "qa" });
      const start = T.ctx.weapons.heatState().heat;
      T.ctx.weapons.fireWeapon ? null : null;
      T.fireWeapon(1);
      return +(T.ctx.weapons.heatState().heat - start).toFixed(5);
    })();

    T.ctx.mission.cooldowns.resupply = 0;
    T.ctx.combat.player.hp = 40;
    T.ctx.jetpack.state.fuel = 5;
    T.ctx.mission.call("resupply");
    const pendingShots = T.ctx.mission.pending();
    T.advanceTime(Math.max(0, (pendingShots[0]?.remaining || 3) - 0.35), 1 / 60);
    const duringArrival = [];
    for (let i = 0; i < 40; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      duringArrival.push(T.ordnanceState().visible);
    }
    const boon = T.boonState();
    const hp = T.ctx.combat.player.hp;
    const fuel = T.ctx.jetpack.state.fuel;
    const gilded = measure();
    const heatGilded = (() => {
      T.ctx.weapons.setHeat?.(0, { reason: "qa" });
      const start = T.ctx.weapons.heatState().heat;
      T.fireWeapon(1);
      return +(T.ctx.weapons.heatState().heat - start).toFixed(5);
    })();
    // ...and after it runs out.
    T.advanceTime(boon.remaining + 0.6, 1 / 30);
    const after = T.boonState();
    const plainAgain = measure();
    return {
      spec: { name: spec.name, boon: spec.boon, reinforcements: spec.reinforcements },
      plain: plain.dealt, gilded: gilded.dealt, plainAgain: plainAgain.dealt,
      hits: [plain.hit, gilded.hit, plainAgain.hit],
      heatPlain, heatGilded,
      boon, after, hp, fuel,
      maxHp: T.ctx.combat.player.maxHp,
      maxFuel: T.ctx.jetpack.config.maxFuel,
      arrivalPeak: Math.max(...duringArrival),
      site,
    };
  });
  console.log(`  "${rite.spec.name}" · ${JSON.stringify(rite.spec.boon)}`);
  console.log(`  damage per shot: ${rite.plain} -> ${rite.gilded} gilded `
    + `-> ${rite.plainAgain} after it lapses`);
  console.log(`  heat per shot:   ${rite.heatPlain} -> ${rite.heatGilded} gilded`);
  console.log(`  delivery: hp ${rite.hp}/${rite.maxHp} · charge `
    + `${Math.round(rite.fuel)}/${rite.maxFuel} · ${rite.arrivalPeak} meshes on screen`);
  check(rite.spec.name === "Gilding Rite" && rite.spec.reinforcements === 0,
    "the drop is a blessing rather than a resupply", rite.spec.name);
  check(rite.hp === rite.maxHp && rite.fuel >= rite.maxFuel - 0.01,
    "it still puts the trooper back on their feet",
    `hp ${rite.hp} fuel ${rite.fuel}`);
  check(rite.boon.active && rite.boon.remaining > 15,
    "and lights a blessing with a clock on it", JSON.stringify(rite.boon));
  check(rite.hits.every(Boolean), "the probe shots all connected",
    JSON.stringify(rite.hits));
  check(rite.gilded > rite.plain * 1.3,
    "a gilded shot hits harder", `${rite.plain} -> ${rite.gilded}`);
  check(rite.heatGilded < rite.heatPlain * 0.75,
    "and costs less heat", `${rite.heatPlain} -> ${rite.heatGilded}`);
  check(!rite.after.active && Math.abs(rite.plainAgain - rite.plain) < 0.01,
    "the blessing expires on its own and takes the multiplier with it",
    `${rite.plainAgain} vs ${rite.plain} unblessed`);
  check(rite.arrivalPeak > 0, "the rite draws something on arrival",
    `${rite.arrivalPeak} meshes`);

  await page.evaluate(() => {
    const T = window.__SF;
    T.ctx.mission.cooldowns.resupply = 0;
    T.ctx.mission.call("resupply");
    const pendingShots = T.ctx.mission.pending();
    T.advanceTime(Math.max(0, (pendingShots[0]?.remaining || 3) - 0.28), 1 / 60);
    T.advanceTime(0.34, 1 / 60);
  });
  {
    const [rx, rz] = rite.site;
    await look([rx + 15, gy + 6, rz + 17], [rx, gy + 4, rz], 50);
  }
  await grab("05-rite.png");

  check(errors.length === 0, "no page or console errors", errors.slice(0, 3).join(" | "));
  console.log(findings.length
    ? `\n${findings.length} FAILED: ${findings.join(", ")}`
    : "\nthe commands behave");
  await browser.close();
  process.exitCode = findings.length ? 1 : 0;
} finally {
  server.kill("SIGTERM");
}
