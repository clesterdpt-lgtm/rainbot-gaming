#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Distaff, played with the lance

   The fight harness proves each mechanism does what it says. This
   proves the thing the mechanisms were changed FOR: that a trooper
   who chooses the lance against the Glass Scar's guardian has a
   fight rather than a tax. A bot plays it the way a person would -
   walk to the nearest reachable tarsus, swing, keep swinging, step
   off the line of a web bolt, sprint out of the ring on a slam tell,
   and once the body is down, work it from a rear quarter where the
   mouth cannot reach - and the run is scored on damage dealt per
   point of vitality lost, legs broken, collapses reached, and whether
   it died.

   Two numbers matter and both are printed: the DEALT/LOST ratio and
   the time to first collapse. Run it against another checkout with
   --root to compare a build against this one.

   Usage:
     node scripts/saintfall-distaff-melee-probe.mjs [--seconds 150] [--root /path/to/checkout]
                                                    [--out output/path] [--label name]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((part) => part.trim().split(/\s+/)).map(([key, value]) => [key, value ?? true])
);
const root = path.resolve(args.root && args.root !== true ? args.root : here);
const seconds = Number(args.seconds) || 150;
/* How long the bot takes to ANSWER a tell it has seen. 0 is a bot with
   the bus wired to its feet; 0.3 is a person who has learned the fight;
   0.6 is a person who has not. The tells (0.9s slam, 0.78s bolt) are
   sized for the middle one. */
const reaction = Number.isFinite(Number(args.reaction)) ? Number(args.reaction) : 0;
/* --solo clears every other creature in the district first. The Scar
   carries a Thresher garrison that will happily eat a trooper whose
   whole attention is on the boss, and a run that dies to THEM says
   nothing about the boss. Both numbers are worth having; this flag
   picks which one is being measured. */
const solo = !!args.solo;
/* --ranged plays the Volley instead: holds outside the slam ring, shoots
   the nearest knee (the joint), and the body once it is down. The same
   dodges. Its number is the yardstick the lance's is read against. */
const ranged = !!args.ranged;
const label = args.label && args.label !== true ? args.label : path.basename(root);
const outDir = path.resolve(here, args.out && args.out !== true ? args.out : "output/saintfall/distaff-melee-probe");
const port = 52900 + (process.pid % 6000);
const base = `http://127.0.0.1:${port}`;

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
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
  });

  const result = await page.evaluate(async ({ seconds, reaction, solo, ranged }) => {
    const T = window.__SF;
    const dt = 1 / 60;
    T.invulnerable(false);
    T.autoStow?.(false);
    /* The garrison. Every ordinary caste goes; the district guardians
       (all self-driven, all dormant but the one under test) stay, since
       their modules hold references the removal would leave dangling.
       Swept again periodically because breach waves respawn. */
    const BOSSES = new Set(["distaff", "winnower", "garner", "abbess", "stylite", "coulter",
      "apostate", "matriarch"]);
    const clearGarrison = () => {
      if (!solo) return 0;
      let n = 0;
      for (const e of [...T.enemies.live]) {
        if (BOSSES.has(e.key) || e.spec?.selfDriven || e.body) continue;
        T.enemies.remove(e);
        n += 1;
      }
      return n;
    };
    let garrisonCleared = clearGarrison();
    // Deterministic-ish: the animal's own strafe flips are random.
    let seed = 1234567;
    Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

    T.teleportToDistaff(30);
    T.advanceToDistaffPhase("standing", 12);
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const ps = T.player.state;
    const combat = T.combat;
    T.equipWeapon(ranged ? "autogun" : "glaive");
    const V3 = () => new (Object.getPrototypeOf(inst.root.position).constructor)();
    const world = (bone, out) => { bone.updateWorldMatrix(true, false); return bone.getWorldPosition(out || V3()); };
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const tmp = V3();

    const ev = { slamTelegraph: 0, slam: 0, slamMiss: 0, webCastTelegraph: 0, webHit: 0,
      reelTelegraph: 0, reelHit: 0, lungeTelegraph: 0, biteTelegraph: 0, bite: 0, biteMiss: 0,
      collapse: 0, recover: 0, legBroken: 0, stagger: 0, defeated: 0 };
    let dodgeUntil = -1;
    let dodgeFrom = Infinity;   // the dodge starts once t passes this
    /* WHERE THE STAMP IS ABOUT TO LAND. The build stamps the FOOT
       nearest the trooper, not its own centre (`slamAtFoot`), so a bot
       that measures the ring from the body is a bot standing at a
       tarsus twelve metres out deciding it is safe - it took twelve
       stamps out of thirteen without moving once, and that measured
       the harness rather than the boss. The telegraph carries the
       epicentre; run from that. */
    let slamX = 0;
    let slamZ = 0;
    let sideUntil = -1;
    let sideFrom = Infinity;
    let sideDir = 1;
    const offs = Object.keys(ev).map((k) => T.distaff.bus.on(k, (e) => {
      ev[k] += 1;
      if (k === "slamTelegraph") {
        slamX = Number.isFinite(e?.x) ? e.x : inst.x;
        slamZ = Number.isFinite(e?.z) ? e.z : inst.z;
        const d = Math.hypot(ps.x - slamX, ps.z - slamZ);
        // Only worth running if inside the ring (read off the build's
        // own config, so the bot dodges the slam THIS build throws); the
        // tell is 0.9s and the sprint is 8.6 m/s - after the reaction
        // delay.
        const ring = (T.distaff.config.slamRadius || 9.5) + 1.5;
        if (d < ring) { dodgeFrom = t + reaction; dodgeUntil = t + reaction + 1.05; }
      }
      if (k === "webCastTelegraph" || k === "reelTelegraph") {
        // Step off the line: sideways through the tell and the flight.
        sideFrom = t + reaction;
        sideUntil = t + reaction + 1.6;
        sideDir = Math.random() < 0.5 ? 1 : -1;
      }
    }));

    // Where the vitality went, by source - so a run that loses HP to
    // something other than the boss says so.
    const hurtBy = {};
    const offHurt = combat.bus.on("playerHurt", (e) => {
      hurtBy[e.source] = (hurtBy[e.source] || 0) + (Number(e.damage) || 0);
    });

    let t = 0;
    let hpLost = 0;
    let lastHp = combat.player.hp;
    let dealt = 0;
    let lastBossHp = inst.health;
    let lastLegTotal = inst.legHp.reduce((a, b) => a + b, 0);
    let firstCollapseAt = -1;
    let died = false;
    let diedAt = -1;
    let bossDead = false;
    let bossDeadAt = -1;
    let swings = 0;
    let shots = 0;
    let shotHits = 0;
    let rFire = 0;
    let rHeat = 0;
    let rLastShot = -99;
    let rLockedUntil = -1;
    let rootedFrames = 0;
    let legTarget = -1;
    let collapsedFrames = 0;
    let standingFrames = 0;
    const timeline = [];

    const nearestLeg = () => {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < inst.legs.length; i += 1) {
        if (inst.legBroken[i]) continue;
        world(inst.legs[i].toe, tmp);
        const d = Math.hypot(tmp.x - ps.x, tmp.z - ps.z);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };

    while (t < seconds) {
      if (combat.player.dead) { died = true; diedAt = t; break; }
      const st = T.distaffState();
      if (inst.state === "death" || st.dead || st.phase === "dead") { bossDead = true; bossDeadAt = t; break; }
      const phase = st.phase;
      const dBoss = Math.hypot(ps.x - inst.x, ps.z - inst.z);
      const bearingBoss = Math.atan2(inst.x - ps.x, inst.z - ps.z);

      /* --- what to swing at --- */
      let tx;
      let tz;
      let stopAt;
      if (phase === "collapsed") {
        collapsedFrames += 1;
        // A rear quarter of the body: from the head/tail midpoint, 135deg
        // off the head's bearing on whichever side we are already on.
        const head = world(inst.bones.get("head"));
        const tail = world(inst.bones.get("abdomen2"));
        const cx = (head.x + tail.x) / 2;
        const cz = (head.z + tail.z) / 2;
        const fwd = Math.atan2(head.x - cx, head.z - cz);
        const mySide = Math.sign(wrap(Math.atan2(ps.x - cx, ps.z - cz) - fwd)) || 1;
        const a = fwd + mySide * (Math.PI * 0.75);
        tx = cx + Math.sin(a) * 4.0;
        tz = cz + Math.cos(a) * 4.0;
        stopAt = 0.6;
      } else {
        standingFrames += 1;
        if (legTarget < 0 || inst.legBroken[legTarget]) legTarget = nearestLeg();
        else {
          // Re-target only if another leg is much nearer - chasing the
          // nearest foot every frame is how a bot dithers between two.
          const n = nearestLeg();
          if (n >= 0 && n !== legTarget) {
            world(inst.legs[n].toe, tmp);
            const dn = Math.hypot(tmp.x - ps.x, tmp.z - ps.z);
            world(inst.legs[legTarget].toe, tmp);
            const dc = Math.hypot(tmp.x - ps.x, tmp.z - ps.z);
            if (dn < dc - 4) legTarget = n;
          }
        }
        if (legTarget >= 0) {
          world(inst.legs[legTarget].toe, tmp);
          tx = tmp.x; tz = tmp.z;
        } else { tx = inst.x; tz = inst.z; }
        stopAt = 2.0;
      }
      const dx = tx - ps.x;
      const dz = tz - ps.z;
      const dT = Math.hypot(dx, dz);
      const bearingT = Math.atan2(dx, dz);

      /* --- move --- */
      const rooted = (ps.rootFor || 0) > 0;
      if (rooted) rootedFrames += 1;
      const dodging = t >= dodgeFrom && t < dodgeUntil;
      const stepping = t >= sideFrom && t < sideUntil;
      // Away from the point the stamp named, not away from the animal.
      const bearingSlam = Math.atan2(slamX - ps.x, slamZ - ps.z);
      if (ranged) {
        /* THE VOLLEY holds a band just outside the slam ring - closer
           than the reel likes, further than the slam reaches - and
           backs off or closes to stay in it; the same dodges apply. */
        const ring = (T.distaff.config.slamRadius || 9.5);
        const near = ring + 3.5;
        const far = ring + 8;
        if (dodging) {
          T.setCam(bearingSlam + Math.PI, -0.05, 5.2); T.setGaitInput(0, -1);
        } else if (phase === "standing" && st.lunging && dBoss < 16) {
          T.setCam(bearingBoss + Math.PI / 2 * sideDir, -0.05, 5.2); T.setGaitInput(0, -1);
        } else if (stepping) {
          T.setCam(bearingBoss + Math.PI / 2 * sideDir, -0.05, 5.2); T.setGaitInput(0, -1);
        } else if (dBoss < near) {
          T.setCam(bearingBoss + Math.PI, -0.05, 5.2); T.setGaitInput(0, -1);
        } else if (dBoss > far) {
          T.setCam(bearingBoss, -0.05, 5.2); T.setGaitInput(0, -1);
        } else {
          T.setCam(bearingBoss, -0.05, 5.2); T.setGaitInput(null, null);
        }
        /* Fire: 9 rounds a second at the knee of the target leg (its
           joint) or at the body once it is down, with an aimed spread;
           the Volley's own heat and lock, emulated. */
        rFire -= dt;
        if (t - rLastShot > 0.55 && t >= rLockedUntil) rHeat = Math.max(0, rHeat - 0.40 * dt);
        if (rFire <= 0 && t >= rLockedUntil && !dodging) {
          let ax; let ay; let az;
          if (phase === "collapsed") {
            const head = world(inst.bones.get("head"));
            const tail = world(inst.bones.get("abdomen2"));
            ax = (head.x + tail.x) / 2; ay = (head.y + tail.y) / 2; az = (head.z + tail.z) / 2;
          } else if (legTarget >= 0) {
            world(inst.legs[legTarget].tibia, tmp);
            ax = tmp.x; ay = tmp.y; az = tmp.z;
          } else { ax = inst.x; ay = inst.y + 9; az = inst.z; }
          const mx = ps.x; const my = ps.y + 1.5; const mz = ps.z;
          const d = Math.hypot(ax - mx, ay - my, az - mz) || 1;
          const dir = { x: (ax - mx) / d, y: (ay - my) / d, z: (az - mz) / d };
          const spread = 0.012;
          const ux = -dir.z; const uz = dir.x;
          const jx = (Math.random() - 0.5) * 2 * spread;
          const jy = (Math.random() - 0.5) * 2 * spread;
          dir.x += ux * jx; dir.z += uz * jx; dir.y += jy;
          const n = Math.hypot(dir.x, dir.y, dir.z);
          dir.x /= n; dir.y /= n; dir.z /= n;
          const hit = combat.fire({ x: mx, y: my, z: mz }, dir, { damage: 24 });
          shots += 1;
          if (hit) shotHits += 1;
          rLastShot = t;
          rHeat += 0.0333;
          rFire = 1 / 9;
          if (rHeat >= 1) { rLockedUntil = t + 2.425; rHeat = 0.25; }
        }
      } else if (dodging) {
        // Away from where the foot is coming down, flat out.
        T.setCam(bearingSlam + Math.PI, -0.05, 5.2);
        T.setGaitInput(0, -1);
      } else if (phase === "standing" && st.lunging && dBoss < 14) {
        // Sidestep the arrival.
        T.setCam(bearingBoss + Math.PI / 2 * sideDir, -0.05, 5.2);
        T.setGaitInput(0, -1);
      } else if (stepping && dT > stopAt + 1.5) {
        T.setCam(bearingBoss + Math.PI / 2 * sideDir, -0.05, 5.2);
        T.setGaitInput(0, -1);
      } else {
        T.setCam(bearingT, -0.05, 5.2);
        if (dT > stopAt) T.setGaitInput(0, -1);
        else T.setGaitInput(null, null);
      }

      /* --- swing --- */
      const inReach = !ranged && (phase === "collapsed" ? dT < 3.6 : dT < 3.37 + 1.1);
      if (inReach && !dodging) {
        T.setCam(bearingT, -0.05, 5.2);
        T.pressMelee();
        swings += 1;
      }

      T.advanceTime(dt);
      t += dt;
      if (Math.round(t * 60) % 300 === 0) garrisonCleared += clearGarrison();

      /* --- score --- */
      const hp = combat.player.hp;
      if (hp < lastHp) hpLost += lastHp - hp;
      lastHp = hp;
      const legTotal = inst.legHp.reduce((a, b) => a + b, 0);
      if (legTotal < lastLegTotal) dealt += lastLegTotal - legTotal;
      lastLegTotal = legTotal;
      if (inst.health < lastBossHp) dealt += lastBossHp - inst.health;
      lastBossHp = inst.health;
      if (phase === "collapsed" && firstCollapseAt < 0) firstCollapseAt = t;
      if (Math.round(t * 60) % 300 === 0) {
        timeline.push({ t: Number(t.toFixed(0)), phase, hp: Math.round(hp), boss: Math.round(inst.health),
          legs: inst.legsBroken, dealt: Math.round(dealt), lost: Math.round(hpLost),
          dT: Number(dT.toFixed(1)), dBoss: Number(dBoss.toFixed(1)), speed: Number(ps.speed.toFixed(1)),
          bossYawRate: Number((Math.abs(wrap(inst.yaw - (timeline.at(-1)?.bossYaw ?? inst.yaw))) / 5).toFixed(2)),
          bossYaw: Number(inst.yaw.toFixed(2)) });
      }
    }
    offs.forEach((f) => f());
    offHurt();
    for (const k of Object.keys(hurtBy)) hurtBy[k] = Math.round(hurtBy[k]);
    return {
      hurtBy, garrisonCleared, solo,
      seconds: Number(t.toFixed(1)), died, diedAt: Number(diedAt.toFixed(1)),
      bossDead, bossDeadAt: Number(bossDeadAt.toFixed(1)),
      dealt: Math.round(dealt), hpLost: Math.round(hpLost),
      ratio: Number((dealt / Math.max(1, hpLost)).toFixed(1)),
      legsBroken: inst.legsBroken, bossHp: Math.round(inst.health), bossMax: Math.round(inst.maxHealth),
      firstCollapseAt: Number(firstCollapseAt.toFixed(1)),
      collapsedSeconds: Number((collapsedFrames * dt).toFixed(1)),
      standingSeconds: Number((standingFrames * dt).toFixed(1)),
      rootedSeconds: Number((rootedFrames * dt).toFixed(1)),
      swings, shots, shotHits, ranged, events: ev, timeline,
    };
  }, { seconds, reaction, solo, ranged });

  console.log(`\n[${label}] Distaff vs the lance, ${result.seconds}s (${ranged ? "VOLLEY" : "lance"}, reaction ${reaction}s${solo ? ", solo" : ""})`);
  console.log(`  dealt ${result.dealt} (${result.legsBroken} legs broken, boss ${result.bossHp}/${result.bossMax}), lost ${result.hpLost} HP -> DEALT/LOST ${result.ratio}`);
  console.log(`  first collapse at ${result.firstCollapseAt}s; collapsed ${result.collapsedSeconds}s of ${result.seconds}s; rooted ${result.rootedSeconds}s; ${result.ranged ? `${result.shots} shots, ${result.shotHits} hit` : `${result.swings} swing presses`}`);
  console.log(`  ${result.died ? `DIED at ${result.diedAt}s` : "survived"}${result.bossDead ? `; boss KILLED at ${result.bossDeadAt}s` : ""}`);
  console.log(`  events: ${JSON.stringify(result.events)}`);
  console.log(`  hurt by: ${JSON.stringify(result.hurtBy)}`);
  console.log(`  timeline: ${result.timeline.map((r) => `${r.t}s ${r.phase[0]} hp${r.hp} boss${r.boss} legs${r.legs} dT${r.dT} dB${r.dBoss} v${r.speed}`).join(" | ")}`);
  if (pageErrors.length) console.log(`  page errors: ${pageErrors.join(" | ")}`);
  await writeFile(path.join(outDir, `${label}.json`), JSON.stringify({ label, root, ...result, pageErrors }, null, 2));
  await browser.close();
} finally {
  server.kill();
}
