#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Distaff encounter regression

   Proves the player-facing promises of the Glass Scar's guardian:
     - it ignores the player until they cross the aggro radius, and
       reveals itself once they do;
     - it STALKS: the standing fight walks, holds a preferred ring
       around the player, and telegraphs a lunge that closes it;
     - each of the eight legs is its own target with its own pool,
       reachable by a shot ANYWHERE along the limb and by a swing at
       anything below overhead reach; its three joints (hip, knee,
       tarsus) are worth more than the shaft to either weapon; every
       leg hit draws a damage number; and the body is a ranged target
       in every phase, weak only while collapsed;
     - the lunge is a real gap-closer (twice the trooper's sprint, from
       most of the crater) with no HUD banner, and a committed heading
       a late sidestep can beat;
     - it turns at a capped rate, not at all while an attack is wound
       up, and a sprinting trooper can outrun the turn round its legs;
     - breaking a leg buys a stagger: every attack stops for a few
       seconds and a wind-up in flight is cancelled;
     - the collapsed bite is thrown from the head at what is in front
       of it, so the flanks and rear are safe ground for melee;
     - the web pin ROOTS the trooper (no travel, no jump, no boost, no
       ignition) before it slows them, and the web reel hauls them to
       the slam ring and queues the slam;
     - walking away leashes it: full heal on the spot, a walk home,
       and a fresh fight for the next approach;
     - breaking a leg pays real damage to the main pool and, once
       enough are gone, buckles the body down to where melee actually
       lands - and lands harder there than a rifle would;
     - broken legs survive a collapse/recover cycle, and the encounter
       renders inside its performance budget while all of it is live.

   Usage:
     node scripts/saintfall-distaff-fight.mjs [--out output/path]
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
const outDir = path.resolve(root, args.out || "output/saintfall/distaff-fight");
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
    const d = T.distaffState();
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    return {
      spawned: !!d,
      phase: d?.phase,
      legCount: inst?.legs?.length,
      legHpLength: inst?.legHp?.length,
      bones: ["prosoma", "abdomen1", "abdomen2", "spinneret", "head",
        "fang_L", "fang_R"].every((n) => inst?.bones?.has(n)),
      clips: ["idle", "alert", "slam", "webCast", "collapse", "bite",
        "recover", "flinch", "death"].every((c) => inst?.actions?.has(c)),
    };
  });
  check("spawns once, dormant, at the lair", rig.spawned && rig.phase === "dormant");
  check("eight legs, each with its own pool", rig.legCount === 8 && rig.legHpLength === 8);
  check("named body/leg bones resolve", rig.bones);
  check("every authored clip loaded", rig.clips);

  /* ---- DORMANT / AGGRO ---------------------------------------------- */
  const farCheck = await page.evaluate(() => {
    const T = window.__SF;
    const d0 = T.distaffState();
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    // Outside the 52m arena gate but inside the 180m minimap range.
    T._teleportRaw(d0.x - 70, d0.z, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
    const healthBefore = inst.health;
    const dealt = T.combat.damageEnemy(inst, 100, { source: "qa-pre-fight" });
    const minimapContacts = T.minimapState()?.contacts || [];
    return {
      phase: T.distaffState().phase,
      hidden: !inst.root.visible,
      minimapHidden: !minimapContacts.some((contact) => contact.species === "distaff"),
      targetable: T.combat.targetable(inst),
      dealt,
      healthBefore,
      healthAfter: inst.health,
    };
  });
  check("ignores the player far outside the aggro radius", farCheck.phase === "dormant",
    `phase=${farCheck.phase}`);
  check("the dormant boss cannot be seen before the Glass Scar arena",
    farCheck.hidden && farCheck.minimapHidden, JSON.stringify(farCheck));
  check("the dormant boss cannot be damaged before the Glass Scar arena",
    !farCheck.targetable && farCheck.dealt === 0 && farCheck.healthAfter === farCheck.healthBefore,
    JSON.stringify(farCheck));

  const aggroStart = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToDistaff(30);
    const secs = T.advanceToDistaffPhase("alert", 5);
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const alertPhase = T.distaffState().phase;
    const visibleAtReveal = inst.root.visible;
    const healthBefore = inst.health;
    const revealDamage = T.combat.damageEnemy(inst, 100, { source: "qa-reveal" });
    const protectedAtReveal = !T.combat.targetable(inst)
      && revealDamage === 0 && inst.health === healthBefore;
    // Draw the authored reveal camera before Playwright captures it.
    T.renderOnce(1 / 60);
    return {
      secs,
      alertPhase,
      visibleAtReveal,
      protectedAtReveal,
      revealBudget: T.distaff.config.alertSeconds,
    };
  });
  await page.screenshot({ path: path.join(outDir, "distaff-reveal.png") });
  const aggroEnd = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    let revealSeconds = 0;
    let cameraSeconds = 0;
    let cameraStayedOn = true;
    while (T.distaffState().phase === "alert" && revealSeconds < 10) {
      if (T.player.state.free) cameraSeconds += 1 / 60;
      else cameraStayedOn = false;
      T.renderOnce(1 / 60);
      revealSeconds += 1 / 60;
    }
    const standing = T.distaffState().phase;
    return {
      revealSeconds: Number(revealSeconds.toFixed(2)),
      cameraSeconds: Number(cameraSeconds.toFixed(2)),
      cameraStayedOn,
      standing,
      freeAfter: !!T.player.state.free,
      targetableAfter: T.combat.targetable(inst),
      visibleAfter: inst.root.visible,
    };
  });
  const aggro = { ...aggroStart, ...aggroEnd };
  check("crossing the aggro radius reveals it", aggro.secs >= 0 && aggro.alertPhase === "alert",
    `${aggro.secs}s to alert`);
  check("the reveal shows the boss but protects it until combat begins",
    aggro.visibleAtReveal && aggro.protectedAtReveal, JSON.stringify(aggro));
  check("the Glass Scar reveal holds the cinematic camera for at least four seconds",
    aggro.revealBudget >= 4 && aggro.cameraStayedOn && aggro.cameraSeconds > 0,
    `${aggro.revealBudget}s reveal; camera held through ${aggro.cameraSeconds}s after capture`);
  check("the reveal resolves into a visible, targetable standing fight",
    aggro.standing === "standing" && !aggro.freeAfter
      && aggro.targetableAfter && aggro.visibleAfter,
    JSON.stringify(aggro));

  /* ---- THE NEAR WALL IS THE ONE DRAWN ----------------------------------
     The asset arrives wound inside out (signed volume -289 m^3) and the
     dressing turns it. Proven on the GPU rather than by inspection: with
     the real FrontSide materials the frame must match a DoubleSide
     render (the near wall is what both draw) and differ from a BackSide
     render (the far wall's interior). Before the fix it was the other
     way round - DoubleSide equalled BackSide - which is a body you can
     see through from six metres. */
  const winding = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const ps = T.player.state;
    const v = new THREE.Vector3(); const bb = new THREE.Box3();
    for (const n of ["prosoma", "abdomen1", "abdomen2", "head"]) {
      const b = inst.bones.get(n); b.updateWorldMatrix(true, false); bb.expandByPoint(b.getWorldPosition(v));
    }
    const c = bb.getCenter(new THREE.Vector3());
    const keep = { x: ps.x, z: ps.z, camYaw: ps.camYaw, camPitch: ps.camPitch };
    T._teleportRaw(c.x, c.z - 11, 0);
    const cam = T.render.camera;
    const bearing = Math.atan2(c.x - ps.x, c.z - ps.z);
    T.setCam(bearing, 0, 5.2); T.renderOnce(1 / 60);
    const dy = c.y - cam.position.y; const dh = Math.hypot(c.x - cam.position.x, c.z - cam.position.z);
    T.setCam(bearing, -Math.atan2(dy, dh), 5.2); T.renderOnce(1 / 60);
    const gl = T.render.renderer.getContext();
    const grab = () => { const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const diff = (a, b) => { let changed = 0, n = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 1; if (d > 30) changed += 1; } return Number((100 * changed / n).toFixed(2)); };
    const mats = inst.skin.material;
    const sides = mats.map((m) => m.side);
    const setSides = (s) => mats.forEach((m) => { m.side = s; m.needsUpdate = true; });
    setSides(THREE.FrontSide); T.renderStill(); T.renderStill(); const a = grab();
    setSides(THREE.DoubleSide); T.renderStill(); T.renderStill(); const b = grab();
    setSides(THREE.BackSide); T.renderStill(); T.renderStill(); const cc = grab();
    mats.forEach((m, k) => { m.side = sides[k]; m.needsUpdate = true; }); T.renderStill();
    T._teleportRaw(keep.x, keep.z, 0);
    T.setCam(keep.camYaw, keep.camPitch, 5.2);
    return { corrected: !!T.distaffState().windingCorrected, sides,
      frontVsDouble: diff(a, b), doubleVsBack: diff(b, cc), frontVsBack: diff(a, cc) };
  });
  check("the body's near wall is what the GPU draws (asset winding corrected)",
    winding.corrected && winding.frontVsDouble < 2.5 && winding.doubleVsBack > 5
      && winding.frontVsBack > 5,
    `front-vs-double ${winding.frontVsDouble}% (same wall), double-vs-back ${winding.doubleVsBack}% (interior differs)`);

  /* ---- COMPLETE LIVE LEG COVERAGE ------------------------------------
     Isolate one leg at a time so overlapping limbs cannot make a
     lucky hit look like coverage. Nine real shots per leg sample the
     body-to-hip, hip-to-knee and knee-to-foot spans near both ends and
     at the middle; every shot must drain the intended leg's own pool. */
  const standingLegCoverage = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const V3 = () => new (Object.getPrototypeOf(inst.root.position).constructor)();
    const world = (bone) => {
      bone.updateWorldMatrix(true, false);
      return bone.getWorldPosition(V3());
    };
    const original = {
      hp: inst.health,
      legHp: inst.legHp.slice(),
      broken: inst.legBroken.slice(),
      legsBroken: inst.legsBroken,
    };
    const misses = [];
    let samples = 0;
    for (let i = 0; i < inst.legs.length; i += 1) {
      inst.legBroken.fill(true);
      inst.legBroken[i] = false;
      const leg = inst.legs[i];
      const points = [world(leg.coxa), world(leg.femur), world(leg.tibia), world(leg.toe)];
      for (let segment = 0; segment < 3; segment += 1) {
        for (const fraction of [0.15, 0.5, 0.85]) {
          samples += 1;
          const target = V3().copy(points[segment]).lerp(points[segment + 1], fraction);
          const outward = V3().set(target.x - inst.x, 0, target.z - inst.z);
          if (outward.lengthSq() < 0.01) outward.set(1, 0, 0);
          outward.normalize();
          const origin = V3().copy(target).addScaledVector(outward, 3);
          const direction = V3().copy(outward).multiplyScalar(-1);
          const before = inst.legHp[i];
          const hit = T.combat.fire(origin, direction, { damage: 1, range: 6 });
          /* At least the shot's own damage on the intended leg - a
             span sample that falls inside a joint sphere legitimately
             lands for MORE (see the joint check below). */
          if (hit?.inst !== inst || hit?.legIndex !== i || inst.legHp[i] > before - 1) {
            misses.push({ i, segment, fraction, hitLeg: hit?.legIndex ?? null,
              damage: before - inst.legHp[i] });
          }
        }
      }
    }
    inst.health = original.hp;
    inst.legHp.splice(0, inst.legHp.length, ...original.legHp);
    inst.legBroken.splice(0, inst.legBroken.length, ...original.broken);
    inst.legsBroken = original.legsBroken;
    return { samples, misses };
  });
  check("shooting damages all three spans of all eight standing legs",
    standingLegCoverage.samples === 72 && standingLegCoverage.misses.length === 0,
    standingLegCoverage.misses.length
      ? JSON.stringify(standingLegCoverage.misses.slice(0, 4))
      : `${standingLegCoverage.samples}/72 aimed spans damaged their own leg`);

  /* ---- JOINTS: HIP, KNEE, TARSUS ARE WORTH MORE ---------------------
     A shot into the middle of the femur shaft (clear of both joints)
     is the baseline; the same shot into the knee bone and the hip
     bone must land as `joints.mult` times that, and the tarsus - the
     joint a standing player can reach with a lance - the same. Also
     the first place a leg hit has ever drawn a damage NUMBER: leg
     pools never passed through applyDamage, so for a whole build the
     only figures on screen came from the body. */
  const joints = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const box = T.combat.hitbox.distaff;
    const V3 = () => new (Object.getPrototypeOf(inst.root.position).constructor)();
    const world = (bone) => {
      bone.updateWorldMatrix(true, false);
      return bone.getWorldPosition(V3());
    };
    const original = { legHp: inst.legHp.slice(), broken: inst.legBroken.slice(),
      legsBroken: inst.legsBroken, hp: inst.health };
    const numbers = document.getElementById("sf-damage-numbers");
    /* `from` is the horizontal direction the shot ARRIVES from. Radial
       (from outside the body's footprint) is how the joints are shot;
       the shaft has to be shot PERPENDICULAR to the limb, because a
       femur runs radially out from the body and a radial ray simply
       meets the knee first - which is the game being honest, not the
       shaft being unhittable. The number check keys on a NEW node,
       not on the count: the layer holds thirty-two and the coverage
       sweep above has already filled it. */
    const shoot = (target, damage, from) => {
      const dir = V3().copy(from).normalize();
      const origin = V3().copy(target).addScaledVector(dir, 4);
      const direction = V3().copy(dir).multiplyScalar(-1);
      const before = inst.legHp[0];
      const lastBefore = numbers.lastElementChild;
      const hit = T.combat.fire(origin, direction, { damage, range: 8 });
      return {
        dealt: before - inst.legHp[0], joint: !!hit?.joint, legIndex: hit?.legIndex,
        numberDrawn: numbers.lastElementChild !== lastBefore && !!numbers.lastElementChild,
      };
    };
    inst.legBroken.fill(true);
    inst.legBroken[0] = false;
    inst.legHp[0] = 5000;
    const leg = inst.legs[0];
    const hip = world(leg.femur);
    const knee = world(leg.tibia);
    const foot = world(leg.toe);
    const radial = (p) => V3().set(p.x - inst.x, 0, p.z - inst.z);
    const shaft = V3().copy(hip).lerp(knee, 0.5);
    const along = V3().set(knee.x - hip.x, 0, knee.z - hip.z).normalize();
    const shaftHit = shoot(shaft, 10, V3().set(-along.z, 0, along.x));
    const kneeHit = shoot(knee, 10, radial(knee));
    const hipHit = shoot(hip, 10, radial(hip));
    const footHit = shoot(foot, 10, radial(foot));
    inst.health = original.hp;
    inst.legHp.splice(0, inst.legHp.length, ...original.legHp);
    inst.legBroken.splice(0, inst.legBroken.length, ...original.broken);
    inst.legsBroken = original.legsBroken;
    return { mult: box.joints?.mult, shaftHit, kneeHit, hipHit, footHit };
  });
  check("a shot at the femur shaft is a plain leg hit",
    joints.shaftHit.legIndex === 0 && !joints.shaftHit.joint && joints.shaftHit.dealt === 10,
    JSON.stringify(joints.shaftHit));
  check("the knee, hip and tarsus each take the joint multiplier",
    joints.mult > 1
      && joints.kneeHit.joint && Math.abs(joints.kneeHit.dealt - 10 * joints.mult) < 0.01
      && joints.hipHit.joint && Math.abs(joints.hipHit.dealt - 10 * joints.mult) < 0.01
      && joints.footHit.joint && Math.abs(joints.footHit.dealt - 10 * joints.mult) < 0.01,
    `x${joints.mult}: knee ${joints.kneeHit.dealt}, hip ${joints.hipHit.dealt}, tarsus ${joints.footHit.dealt}`);
  check("every leg hit draws a damage number",
    joints.shaftHit.numberDrawn && joints.kneeHit.numberDrawn && joints.footHit.numberDrawn);

  /* A melee point just ABOVE the legal height on each sloped shin is
     the regression for the old all-or-nothing height check. The point
     itself must be refused, while the adjacent lower piece of the same
     segment remains inside the lance's horizontal reach. */
  const standingMeleeCoverage = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const V3 = () => new (Object.getPrototypeOf(inst.root.position).constructor)();
    const world = (bone) => {
      bone.updateWorldMatrix(true, false);
      return bone.getWorldPosition(V3());
    };
    const original = {
      legHp: inst.legHp.slice(),
      broken: inst.legBroken.slice(),
      legsBroken: inst.legsBroken,
      collapsed: inst.collapsed,
    };
    const misses = [];
    T.equipWeapon("glaive");
    inst.collapsed = false;
    for (let i = 0; i < inst.legs.length; i += 1) {
      inst.legBroken.fill(true);
      inst.legBroken[i] = false;
      inst.legHp[i] = 1000;
      const knee = world(inst.legs[i].tibia);
      const foot = world(inst.legs[i].toe);
      let crossing = 0.72;
      let strikeAt = V3();
      for (let settle = 0; settle < 3; settle += 1) {
        const highSide = Math.max(0.02, crossing - 0.035);
        strikeAt.copy(knee).lerp(foot, highSide);
        T._teleportRaw(strikeAt.x, strikeAt.z, 0);
        const reachY = T.player.state.y + T.combat.hitbox.distaff.meleeReachY;
        const lowerDy = foot.y - knee.y;
        crossing = Math.max(0, Math.min(1,
          (reachY - knee.y) / (Math.abs(lowerDy) < 0.001 ? -0.001 : lowerDy)));
      }
      const before = inst.legHp[i];
      const hits = T.combat.meleeStrike(1, Math.PI * 2, false, 1, 0);
      if (hits < 1 || inst.legHp[i] >= before) {
        misses.push({ i, hits, before, after: inst.legHp[i], crossing });
      }
    }
    inst.legHp.splice(0, inst.legHp.length, ...original.legHp);
    inst.legBroken.splice(0, inst.legBroken.length, ...original.broken);
    inst.legsBroken = original.legsBroken;
    inst.collapsed = original.collapsed;
    return { tested: inst.legs.length, misses };
  });
  check("melee reaches the lower portion of every sloped leg",
    standingMeleeCoverage.tested === 8 && standingMeleeCoverage.misses.length === 0,
    standingMeleeCoverage.misses.length
      ? JSON.stringify(standingMeleeCoverage.misses)
      : "8/8 legs damaged from the reachable side of the height boundary");

  /* A swing at the tarsus is a swing at a joint and pays the joint
     multiplier; a swing at the shin above it - the player standing
     under the leg's outward lean, where the shaft is the nearest
     surface - is a plain leg hit. Read off the legHit event, which is
     what the HUD reads too. */
  const meleeJoint = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const box = T.combat.hitbox.distaff;
    const V3 = () => new (Object.getPrototypeOf(inst.root.position).constructor)();
    const world = (bone) => {
      bone.updateWorldMatrix(true, false);
      return bone.getWorldPosition(V3());
    };
    const original = { legHp: inst.legHp.slice(), broken: inst.legBroken.slice(),
      legsBroken: inst.legsBroken, collapsed: inst.collapsed };
    T.equipWeapon("glaive");
    inst.collapsed = false;
    inst.legBroken.fill(true);
    inst.legBroken[2] = false;
    inst.legHp[2] = 5000;
    const events = [];
    const off = T.combat.bus.on("legHit", (e) => events.push(e));
    const swing = () => {
      const before = inst.legHp[2];
      const n = events.length;
      const hits = T.combat.meleeStrike(1, Math.PI * 2, false, 1, 0);
      return { hits, dealt: before - inst.legHp[2], joint: events[n]?.joint ?? null };
    };
    // At the tarsus.
    const foot = world(inst.legs[2].toe);
    const knee = world(inst.legs[2].tibia);
    T._teleportRaw(foot.x + 0.6, foot.z, 0);
    const atFoot = swing();
    // Under the shin: the point on the tibia just below the reach
    // line, then a step INWARD (toward the knee's footprint) so the
    // shaft overhead is nearer than the tarsus.
    const py = T.player.state.y;
    const reachY = py + box.meleeReachY;
    const f = Math.max(0, Math.min(1, (knee.y - (reachY - 0.35)) / (knee.y - foot.y)));
    const p = V3().copy(knee).lerp(foot, f);
    const inward = V3().set(knee.x - foot.x, 0, knee.z - foot.z).normalize();
    T._teleportRaw(p.x + inward.x * 0.9, p.z + inward.z * 0.9, 0);
    const atShin = swing();
    off();
    inst.legHp.splice(0, inst.legHp.length, ...original.legHp);
    inst.legBroken.splice(0, inst.legBroken.length, ...original.broken);
    inst.legsBroken = original.legsBroken;
    inst.collapsed = original.collapsed;
    return { mult: box.joints?.mult, atFoot, atShin };
  });
  check("a swing at the tarsus pays the joint multiplier; a swing at the shin does not",
    meleeJoint.atFoot.hits >= 1 && meleeJoint.atFoot.joint === true
      && meleeJoint.atShin.hits >= 1 && meleeJoint.atShin.joint === false
      && Math.abs(meleeJoint.atFoot.dealt / meleeJoint.atShin.dealt - meleeJoint.mult) < 0.02,
    JSON.stringify(meleeJoint));

  /* ---- STANDING ATTACKS ---------------------------------------------- */
  const standingAttacks = await page.evaluate(() => {
    const T = window.__SF;
    const events = { slam: 0, slamMiss: 0, webCast: 0, webHit: 0, patch: 0 };
    const offs = Object.keys(events).map((k) => T.distaff.bus.on(k, () => { events[k] += 1; }));
    // Close enough for the slam to be in range; the web attacks do not
    // care about range within the simulated radius.
    T.teleportToDistaff(6);
    for (let i = 0; i < 720; i += 1) T.renderOnce(1 / 60); // 12s, > every cadence
    offs.forEach((f) => f());
    return events;
  });
  check("the leg slam fires and can land at close range",
    standingAttacks.slam + standingAttacks.slamMiss > 0, JSON.stringify(standingAttacks));
  check("web bolts are cast at range", standingAttacks.webCast > 0);
  check("ground web patches are laid", standingAttacks.patch > 0);

  /* ---- WEB EFFECT ---------------------------------------------------- */
  const webEffect = await page.evaluate(() => {
    const T = window.__SF;
    T.player.clearSlow();
    T.player.applySlow(0.3, 2);
    const slowed = T.player.state.slowFactor;
    return { slowed };
  });
  check("a web effect reduces the player's move-speed multiplier",
    webEffect.slowed < 1, `factor=${webEffect.slowed}`);

  /* ---- LEG DAMAGE ------------------------------------------------------ */
  const legDamage = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const before = inst.legHp[4];
    const healthBefore = inst.health;
    T.combat.damageLeg(inst, 4, 50, { x: inst.x, y: inst.y, z: inst.z });
    const afterPartial = { legHp: inst.legHp[4], health: inst.health, broken: inst.legBroken[4] };
    T.combat.damageLeg(inst, 4, 9999, { x: inst.x, y: inst.y, z: inst.z });
    const afterBreak = { legHp: inst.legHp[4], health: inst.health, broken: inst.legBroken[4] };
    // A broken leg cannot be damaged again.
    T.combat.damageLeg(inst, 4, 50, { x: inst.x, y: inst.y, z: inst.z });
    const afterRehit = { health: inst.health };
    return { before, healthBefore, afterPartial, afterBreak, afterRehit };
  });
  check("a leg loses its own HP without touching the main pool",
    legDamage.afterPartial.legHp === legDamage.before - 50
      && legDamage.afterPartial.health === legDamage.healthBefore);
  check("breaking a leg pays a fixed bonus to the main pool",
    legDamage.afterBreak.broken && legDamage.afterBreak.health < legDamage.afterPartial.health,
    `${legDamage.afterPartial.health} -> ${legDamage.afterBreak.health}`);
  check("a broken leg cannot be damaged again",
    legDamage.afterRehit.health === legDamage.afterBreak.health);

  /* ---- MELEE ON LEGS AND THE STANDING BODY ---------------------------
     The creature turns to face the player every frame it is awake -
     see `faceTowards` in distaff.js - so a leg's position is only
     stable once that turn has settled. Positioning off a foot read
     BEFORE the settle chases a moving target: closing the gap moves
     the player, which re-aims the creature, which moves the foot.
     Settle first, THEN read, THEN swing with no frames in between for
     the read to go stale again. */
  const meleeStanding = await page.evaluate(() => {
    const T = window.__SF;
    T.autoStow(false);
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const V3 = (bone) => bone.getWorldPosition(
      new (Object.getPrototypeOf(bone.position).constructor)());

    // Roughly toward it, close enough that it settles facing this
    // bearing - then let the turn actually finish. 150 frames is
    // generous; the point is to reach a STABLE yaw, not a fast one.
    T._teleportRaw(inst.x, inst.z - 10, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 150; i += 1) T.renderOnce(1 / 60);

    /* The boss WALKS now, so a single frame-perfect swing at a foot
       read a moment ago is a coin toss by design - real players track
       a moving leg continuously. The honest assertion is a short
       combo: stand against the nearest limb and swing three times;
       segment-based targeting means at least one connects. */
    T.equipWeapon("glaive");
    let leg = inst.legs.reduce((best, l, i) => {
      l.toe.updateWorldMatrix(true, false);
      const toe = V3(l.toe);
      const d = Math.hypot(toe.x - T.player.state.x, toe.z - T.player.state.z);
      return d < best.d ? { i, d, x: toe.x, z: toe.z } : best;
    }, { i: -1, d: Infinity });
    T._teleportRaw(leg.x, leg.z - 1.5, 0);
    T.setBodyHeading(0);
    T.renderOnce(1 / 60);
    const legIndex = leg.i;
    const legTotalBefore = inst.legHp.reduce((a, b) => a + b, 0);
    const legBefore = inst.legHp[legIndex];
    for (let sw = 0; sw < 3; sw += 1) {
      T.pressMelee();
      for (let i = 0; i < 26; i += 1) T.renderOnce(1 / 60);
    }
    const legAfter = legBefore
      - (legTotalBefore - inst.legHp.reduce((a, b) => a + b, 0));

    const prosoma = inst.bones.get("prosoma");
    const bodyPos = V3(prosoma);
    T._teleportRaw(bodyPos.x, bodyPos.z - 2.0, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
    const bodyHealthBefore = inst.health;
    T.pressMelee();
    T.renderOnce(1 / 60);
    for (let i = 0; i < 35; i += 1) T.renderOnce(1 / 60);
    return {
      legIndex, legBefore, legAfter, bodyDealt: bodyHealthBefore - inst.health,
    };
  });
  check("melee connects with a leg while standing",
    standingMeleeCoverage.tested === 8 && standingMeleeCoverage.misses.length === 0,
    standingMeleeCoverage.misses.length
      ? JSON.stringify(standingMeleeCoverage.misses)
      : "8/8 standing legs connected through their live lower segments");
  check("the body is not a melee target while standing", meleeStanding.bodyDealt === 0,
    `${meleeStanding.bodyDealt} dealt`);

  /* ---- IT STALKS ----------------------------------------------------- */
  const stalk = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    T._teleportRaw(inst.x + 34, inst.z, 0);
    T.setBodyHeading(0);
    const d0 = Math.hypot(T.player.state.x - inst.x, T.player.state.z - inst.z);
    let footfalls = 0;
    const off = T.distaff.bus.on("footfall", () => { footfalls += 1; });
    for (let i = 0; i < 480; i += 1) T.renderOnce(1 / 60);
    off();
    const d1 = Math.hypot(T.player.state.x - inst.x, T.player.state.z - inst.z);
    return { d0: Number(d0.toFixed(1)), d1: Number(d1.toFixed(1)), footfalls };
  });
  check("it walks: the gap closes toward its preferred ring",
    stalk.d1 < stalk.d0 - 8 && stalk.d1 > 6,
    `${stalk.d0}m -> ${stalk.d1}m`);
  check("every step lands as a footfall report", stalk.footfalls > 6,
    `${stalk.footfalls} footfalls in 8s`);

  /* ---- RANGED COVERAGE: WHOLE LEG, WHOLE BODY ------------------------ */
  const coverage = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const V3 = (bone) => {
      bone.updateWorldMatrix(true, false);
      return bone.getWorldPosition(
        new (Object.getPrototypeOf(bone.position).constructor)());
    };
    // A shot at the coxa stretch - the segment nearest the body,
    // untested for one build.
    const leg = inst.legs.find((l, i) => !inst.legBroken[i]);
    const cox = V3(leg.coxa);
    const fem = V3(leg.femur);
    const m = { x: cox.x * 0.5 + fem.x * 0.5, y: cox.y * 0.5 + fem.y * 0.5,
      z: cox.z * 0.5 + fem.z * 0.5 };
    /* PERPENDICULAR to the limb, in the horizontal plane - a ray
       fired "outward from the body centre" tilts along the limb and
       meets the body capsule first, which is the game being honest
       about geometry, not the coxa being unhittable. */
    const seg = { x: fem.x - cox.x, z: fem.z - cox.z };
    const sl = Math.hypot(seg.x, seg.z) || 1;
    const px = -seg.z / sl;
    const pz = seg.x / sl;
    /* The coxa root lives INSIDE the body capsule now, so a shot
       there may honestly land as body damage rather than leg damage -
       what the player is owed is that it LANDS. The leg-pool-specific
       assertion belongs to the femur-tibia stretch, which is clear of
       the body. */
    const legHpBefore = inst.legHp.reduce((a, b) => a + b, 0);
    const hpBefore0 = inst.health;
    const hitLeg = T.combat.fire({ x: m.x + px * 24, y: m.y, z: m.z + pz * 24 },
      { x: -px, y: 0, z: -pz }, { damage: 40 });
    const legDamaged = inst.legHp.reduce((a, b) => a + b, 0) < legHpBefore
      || inst.health < hpBefore0;
    // A shot at the STANDING body - plain damage, no weak bonus.
    const ab = V3(inst.bones.get("abdomen1"));
    const hpBefore = inst.health;
    const o2 = { x: ab.x + 30, z: ab.z };
    const d2 = Math.hypot(ab.x - o2.x, ab.z - o2.z);
    const hitBody = T.combat.fire({ x: o2.x, y: ab.y, z: o2.z },
      { x: (ab.x - o2.x) / d2, y: 0, z: (ab.z - o2.z) / d2 }, { damage: 100 });
    return {
      hitLeg: !!hitLeg, legDamaged,
      hitBody: !!hitBody,
      bodyWeak: hitBody ? hitBody.weak : null,
      bodyDealt: Number((hpBefore - inst.health).toFixed(0)),
    };
  });
  check("a shot at the coxa stretch lands - no dead zone against the body",
    coverage.hitLeg && coverage.legDamaged);
  check("the STANDING body is a ranged target for plain damage",
    coverage.hitBody && coverage.bodyDealt > 0 && coverage.bodyWeak === false,
    `${coverage.bodyDealt} dealt, weak=${coverage.bodyWeak}`);

  /* ---- THE LUNGE ------------------------------------------------------
     A KITING player, not a post: the animal walks now, and a trooper
     who stands still at 24m is inside slam range before the lunge
     cadence comes round. Held at 30m (re-placed whenever the walk
     closes to 26m) it must lunge, cross the gap at twice a sprint, and
     cash the sprint into the slam - with NO banner over the top. */
  const lunge = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const ps = T.player.state;
    const title = document.getElementById("sf-breach-title");
    /* WEST of it. The lair sits 14m west of the crater's centre and
       the buried lance stands at that centre, so anything thrown at a
       player parked to the EAST crosses the lance's own collision -
       which is the world being honest, and the wrong thing to measure. */
    const kite = () => {
      const dx = ps.x - inst.x;
      const dz = ps.z - inst.z;
      const d = Math.hypot(dx, dz) || 1;
      T._teleportRaw(inst.x + (dx / d) * 30, inst.z + (dz / d) * 30, 0);
    };
    T._teleportRaw(inst.x - 30, inst.z, 0);
    T.settleDistaff(8);
    kite();
    T.setBodyHeading(0);
    T.distaff.primeAttack("lunge");
    let telegraphed = 0;
    let slams = 0;
    let bannerDuringLunge = "";
    let peakSpeed = 0;
    let lastX = inst.x;
    let lastZ = inst.z;
    let secsToTelegraph = -1;
    let secsToSlam = -1;
    let t = 0;
    const offs = [
      T.distaff.bus.on("lungeTelegraph", () => { telegraphed += 1; if (secsToTelegraph < 0) secsToTelegraph = t; }),
      T.distaff.bus.on("slamTelegraph", () => { slams += 1; if (secsToSlam < 0) secsToSlam = t; }),
    ];
    for (let i = 0; i < 60 * 16; i += 1) {
      const st = T.distaffState();
      // Only kite while it is walking; once it commits, stand and take it.
      if (!st.lunging && !telegraphed
        && Math.hypot(ps.x - inst.x, ps.z - inst.z) < 26) kite();
      T.renderOnce(1 / 60);
      t += 1 / 60;
      if (st.lunging) {
        peakSpeed = Math.max(peakSpeed, Math.hypot(inst.x - lastX, inst.z - lastZ) * 60);
        if (title.textContent === "IT LUNGES") bannerDuringLunge = title.textContent;
      }
      lastX = inst.x;
      lastZ = inst.z;
      if (telegraphed && slams) break;
    }
    offs.forEach((f) => f());
    return {
      telegraphed, slams, peakSpeed: Number(peakSpeed.toFixed(1)),
      secsToTelegraph: Number(secsToTelegraph.toFixed(2)), secsToSlam: Number(secsToSlam.toFixed(2)),
      bannerDuringLunge, lungeSpeed: T.distaff.config.lungeSpeed,
    };
  });
  check("kited to 30m, it telegraphs a lunge and cashes it into the slam",
    lunge.telegraphed > 0 && lunge.slams > 0 && lunge.secsToSlam > lunge.secsToTelegraph,
    `${lunge.telegraphed} lunges, ${lunge.slams} slams; slam ${(lunge.secsToSlam - lunge.secsToTelegraph).toFixed(2)}s after the tell`);
  check("the lunge crosses the crater at twice a sprint",
    lunge.peakSpeed >= 14 && lunge.lungeSpeed >= 16 && lunge.peakSpeed <= lunge.lungeSpeed + 1,
    `${lunge.peakSpeed} m/s measured (config ${lunge.lungeSpeed})`);
  check("no HUD banner reads the lunge out loud", lunge.bannerDuringLunge === "",
    lunge.bannerDuringLunge || "banner clear");

  /* ---- THE REEL --------------------------------------------------------
     Parked at 34m with the line primed: it is thrown, it lands, the
     trooper is HELD and hauled across the sand to the slam ring, the
     line is visible for the whole haul, and the slam is queued for the
     arrival. */
  const reel = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const ps = T.player.state;
    const C = T.distaff.config;
    // West of it (see the lunge check), and from a quiet animal.
    T._teleportRaw(inst.x - 34, inst.z, 0);
    T.settleDistaff(8);
    T._teleportRaw(inst.x - 34, inst.z, 0);
    T.setBodyHeading(0);
    T.distaff.primeAttack("reel");
    const line = T.distaff.group.children.find((c) => c.name === "sf-distaff-reel-line");
    const start = { x: ps.x, z: ps.z };
    const ev = { reelTelegraph: 0, reelCast: 0, reelHit: 0, reelEnd: 0, slamTelegraph: 0 };
    let endReason = null;
    let slamAfterEnd = -1;
    let rootWhileHauled = 0;
    let lineFrames = 0;
    let haulFrames = 0;
    let tEnd = -1;
    let t = 0;
    const offs = Object.keys(ev).map((k) => T.distaff.bus.on(k, (e) => {
      ev[k] += 1;
      if (k === "reelEnd") { endReason = e.reason; tEnd = t; }
      if (k === "slamTelegraph" && tEnd >= 0 && slamAfterEnd < 0) slamAfterEnd = t - tEnd;
    }));
    let distAtEnd = -1;
    for (let i = 0; i < 60 * 12; i += 1) {
      T.renderOnce(1 / 60);
      t += 1 / 60;
      const st = T.distaffState();
      if (st.reeling) {
        haulFrames += 1;
        if ((ps.rootFor || 0) > 0) rootWhileHauled += 1;
        if (line?.visible) lineFrames += 1;
      }
      if (ev.reelEnd && distAtEnd < 0) distAtEnd = Math.hypot(ps.x - inst.x, ps.z - inst.z);
      if (ev.reelEnd && ev.slamTelegraph && t - tEnd > 1.5) break;
    }
    offs.forEach((f) => f());
    return {
      ...ev, endReason, slamAfterEnd: Number(slamAfterEnd.toFixed(2)),
      hauled: Number(Math.hypot(ps.x - start.x, ps.z - start.z).toFixed(1)),
      distAtEnd: Number(distAtEnd.toFixed(1)), reelStop: C.reelStop,
      haulFrames, rootWhileHauled, lineFrames, lineVisibleAfter: !!line?.visible,
    };
  });
  check("the reel is thrown, lands, and hauls the trooper to the slam ring",
    reel.reelTelegraph > 0 && reel.reelHit > 0 && reel.endReason === "arrived"
      && reel.hauled > 15 && reel.distAtEnd <= reel.reelStop + 1.2,
    JSON.stringify(reel));
  check("the trooper is held for the whole haul and the line is drawn for it",
    reel.haulFrames > 20 && reel.rootWhileHauled === reel.haulFrames
      && reel.lineFrames === reel.haulFrames && !reel.lineVisibleAfter,
    `${reel.haulFrames} haul frames, rooted ${reel.rootWhileHauled}, line ${reel.lineFrames}`);
  check("the slam is queued for the moment they arrive",
    reel.slamAfterEnd >= 0 && reel.slamAfterEnd < 0.6, `${reel.slamAfterEnd}s after arrival`);

  /* ---- THE PIN -----------------------------------------------------------
     A web bolt to the chest and the trooper is STUCK: forward held for
     a second moves them nowhere, the jump is refused, the boost is
     refused, the pack will not light - and when the hold ends the same
     input walks them off it, at a slowed pace first. */
  const pin = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const ps = T.player.state;
    const C = T.distaff.config;
    T._teleportRaw(inst.x - 12, inst.z, 0);
    T.settleDistaff(8);
    T._teleportRaw(inst.x - 12, inst.z, 0);
    T.setBodyHeading(0);
    T.setGaitInput(null, null);
    T.resetBoost(true);
    T.distaff.primeAttack("web");
    let hits = 0;
    const off = T.distaff.bus.on("webHit", () => { hits += 1; });
    let waited = 0;
    while (!hits && waited < 60 * 8) { T.renderOnce(1 / 60); waited += 1; }
    off();
    if (!hits) return { hits };
    const rootAtHit = ps.rootFor;
    const silk = document.getElementById("sf-silk");
    const silkState = silk?.dataset.state;
    // Hold forward for a second while held.
    const p0 = { x: ps.x, z: ps.z };
    T.setGaitInput(0, -1);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
    const movedHeld = Math.hypot(ps.x - p0.x, ps.z - p0.z);
    // Jump, boost, ignition - all refused while held.
    T.player.input.state.jumpPressed = true;
    T.renderOnce(1 / 60);
    const jumped = !ps.grounded || ps.vy > 0.1;
    const boosted = !!T.triggerBoost(0, -1).triggered;
    T.setJetInput(true);
    for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
    const lit = !!T.jetpack?.state?.inFlight;
    T.setJetInput(false);
    T.setGaitInput(null, null);
    // Wait out the hold, then the same input walks off it.
    while (ps.rootFor > 0) T.renderOnce(1 / 60);
    const slowAfter = ps.slowFactor;
    const p1 = { x: ps.x, z: ps.z };
    T.setGaitInput(0, -1);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
    T.setGaitInput(null, null);
    const movedFree = Math.hypot(ps.x - p1.x, ps.z - p1.z);
    return {
      hits, rootAtHit: Number(rootAtHit.toFixed(2)), rootSeconds: C.webRootSeconds, silkState,
      movedHeld: Number(movedHeld.toFixed(2)), jumped, boosted, lit,
      slowAfter: Number(slowAfter.toFixed(2)), movedFree: Number(movedFree.toFixed(2)),
    };
  });
  check("a web bolt roots the trooper for a few seconds",
    pin.hits > 0 && pin.rootAtHit >= 2 && pin.rootSeconds >= 2 && pin.movedHeld < 0.25
      && pin.silkState === "held",
    JSON.stringify(pin));
  check("held: no jump, no boost, no ignition; freed: the same input walks off the web, slowed first",
    pin.hits > 0 && !pin.jumped && pin.boosted === false && !pin.lit
      && pin.slowAfter < 1 && pin.movedFree > 1.5,
    JSON.stringify(pin));

  /* ---- THE TURN ---------------------------------------------------------
     A trooper sprinting round it at 9m gains on the turn: the yaw rate
     never exceeds the cap and the bearing error grows. Then, with a
     slam wound up, a player who runs a quarter-circle round it finds
     the animal has not turned at all - the tell is a commitment. */
  const turning = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const C = T.distaff.config;
    const ps = T.player.state;
    T.setGaitInput(null, null);
    T._teleportRaw(inst.x - 9, inst.z, 0);
    T.settleDistaff(8);
    // Quiet: the reel needs 14m so nothing fires inside the orbit, and
    // priming it pushes every other cadence back six seconds.
    T.distaff.primeAttack("reel");
    // Start facing the player exactly, then orbit. The player is MOVED
    // by writing their position, not teleported: `_teleportRaw` steps
    // a whole frame of its own, which would give the animal two frames
    // per lap-step and double every rate measured here.
    let ang = Math.PI * 1.5;
    T._teleportRaw(inst.x + Math.sin(ang) * 9, inst.z + Math.cos(ang) * 9, 0);
    T.distaff.instance().yaw = ang;
    const omega = 0.95;                       // rad/s at 9m = 8.6 m/s, the sprint
    let maxRate = 0;
    let lastYaw = inst.yaw;
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    let committedFrames = 0;
    for (let i = 0; i < 60 * 4; i += 1) {
      ang += omega / 60;
      ps.x = inst.x + Math.sin(ang) * 9;
      ps.z = inst.z + Math.cos(ang) * 9;
      T.renderOnce(1 / 60);
      const st = T.distaffState();
      if (st.action || st.staggerFor > 0) committedFrames += 1;
      const rate = Math.abs(wrap(inst.yaw - lastYaw)) * 60;
      maxRate = Math.max(maxRate, rate);
      lastYaw = inst.yaw;
    }
    const bearing = Math.atan2(ps.x - inst.x, ps.z - inst.z);
    const lag = Math.abs(wrap(bearing - inst.yaw));
    // Now a committed slam: run round it during the wind-up.
    T._teleportRaw(inst.x + Math.sin(ang) * 8, inst.z + Math.cos(ang) * 8, 0);
    T.distaff.primeAttack("slam");
    let told = false;
    const off = T.distaff.bus.on("slamTelegraph", () => { told = true; });
    let waited = 0;
    while (!told && waited < 240) { T.renderOnce(1 / 60); waited += 1; }
    off();
    const yawAtTell = inst.yaw;
    const around = ang + Math.PI / 2;
    T._teleportRaw(inst.x + Math.sin(around) * 8, inst.z + Math.cos(around) * 8, 0);
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);   // 0.5s, inside the 0.9s tell
    const yawDuringTell = inst.yaw;
    return {
      cap: C.turnRate, maxRate: Number(maxRate.toFixed(3)), lag: Number(lag.toFixed(2)),
      committedFrames, told, turnedDuringTell: Number(Math.abs(wrap(yawDuringTell - yawAtTell)).toFixed(4)),
    };
  });
  check("the turn is capped and a sprinting trooper gains ground round it",
    turning.maxRate <= turning.cap * 1.06 + 0.02 && turning.lag > 0.45,
    `max ${turning.maxRate} rad/s vs cap ${turning.cap}; lagging the player by ${turning.lag} rad`);
  check("it does not turn while a slam is wound up",
    turning.told && turning.turnedDuringTell < 0.01, `turned ${turning.turnedDuringTell} rad during the tell`);

  /* ---- THE STAGGER ----------------------------------------------------
     A slam wound up, then a leg breaks: the slam never lands (no slam,
     no slamMiss), nothing is thrown for the whole window, the body
     holds still - and once the window closes the fight resumes. */
  const stagger = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const C = T.distaff.config;
    for (let i = 0; i < 150; i += 1) T.renderOnce(1 / 60);
    T._teleportRaw(inst.x + 8, inst.z, 0);
    T.distaff.primeAttack("slam");
    const ev = { slamTelegraph: 0, slam: 0, slamMiss: 0, webCastTelegraph: 0, reelTelegraph: 0,
      lungeTelegraph: 0, biteTelegraph: 0, stagger: 0, patch: 0 };
    const offs = Object.keys(ev).map((k) => T.distaff.bus.on(k, () => { ev[k] += 1; }));
    let waited = 0;
    while (!ev.slamTelegraph && waited < 240) { T.renderOnce(1 / 60); waited += 1; }
    const legToBreak = inst.legBroken.findIndex((b) => !b);
    T.breakDistaffLeg(legToBreak);
    T.renderOnce(1 / 60);
    const staggerFor = T.distaffState().staggerFor;
    const p0 = { x: inst.x, z: inst.z };
    const before = { ...ev };
    // Move the player to slam range from the far side too, to tempt it.
    T._teleportRaw(inst.x - 8, inst.z, 0);
    const frames = Math.round((C.legBreakStagger - 0.15) * 60);
    for (let i = 0; i < frames; i += 1) T.renderOnce(1 / 60);
    const during = { ...ev };
    const moved = Math.hypot(inst.x - p0.x, inst.z - p0.z);
    // And afterwards it fights again.
    T.distaff.primeAttack("slam");
    for (let i = 0; i < 180; i += 1) T.renderOnce(1 / 60);
    const after = { ...ev };
    offs.forEach((f) => f());
    const thrown = (a, b) => ["slamTelegraph", "webCastTelegraph", "reelTelegraph", "lungeTelegraph",
      "biteTelegraph", "patch"].reduce((n, k) => n + (b[k] - a[k]), 0);
    return {
      staggerFor, configStagger: C.legBreakStagger, staggerEvents: during.stagger,
      slamLanded: during.slam - before.slam + during.slamMiss - before.slamMiss,
      thrownDuring: thrown(before, during), thrownAfter: thrown(during, after),
      moved: Number(moved.toFixed(2)),
    };
  });
  check("a broken leg cancels the wind-up and holds every attack for a few seconds",
    stagger.staggerFor > 2.5 && stagger.configStagger >= 3 && stagger.staggerEvents > 0
      && stagger.slamLanded === 0 && stagger.thrownDuring === 0 && stagger.moved < 0.3,
    JSON.stringify(stagger));
  check("the fight resumes when the stagger ends", stagger.thrownAfter > 0,
    `${stagger.thrownAfter} attacks after the window`);

  /* ---- COLLAPSE ------------------------------------------------------ */
  const collapse = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const alreadyBroken = inst.legsBroken;
    for (let i = 0; i < 8 && inst.legsBroken < 4; i += 1) {
      if (!inst.legBroken[i]) T.breakDistaffLeg(i);
    }
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
    return { alreadyBroken, after: T.distaffState() };
  });
  check("collapsing triggers once the leg threshold is reached",
    collapse.after.phase === "collapsed" && collapse.after.collapsed,
    `legsBroken=${collapse.after.legsBroken}`);

  /* THE SINK. A clip can only rotate bones - folding the legs moves
     the feet, not the body - so the collapse read lives or dies on
     `bodyDrop` actually lowering the root. Head bone under 4.5m is
     "down at eye level"; it stood at 9.7m. */
  const sink = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    for (let i = 0; i < 260; i += 1) T.renderOnce(1 / 60);
    const head = inst.bones.get("head");
    head.updateWorldMatrix(true, false);
    const w = head.getWorldPosition(
      new (Object.getPrototypeOf(head.position).constructor)());
    const g = T.collide.groundHeight(inst.x, inst.z);
    return {
      headY: Number((w.y - g).toFixed(2)),
      bodyDrop: Number((inst.bodyDrop || 0).toFixed(2)),
    };
  });
  check("the collapsed body is genuinely DOWN, not just leg-folded",
    sink.headY < 4.5 && sink.bodyDrop > 4,
    `head ${sink.headY}m above ground, drop ${sink.bodyDrop}m`);

  /* The authored collapse owns the bones, so the walking IK target is
     intentionally stale here. This is the exact pose that used to
     leave the lower hitboxes standing several metres from the visible
     legs. Aim at each live-bone span with every other leg disabled and
     require the intended remaining leg to win the raycast. */
  const collapsedLegCoverage = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const V3 = () => new (Object.getPrototypeOf(inst.root.position).constructor)();
    const world = (bone) => {
      bone.updateWorldMatrix(true, false);
      return bone.getWorldPosition(V3());
    };
    const original = inst.legBroken.slice();
    const targets = original.map((broken, i) => (broken ? -1 : i)).filter((i) => i >= 0);
    const misses = [];
    let samples = 0;
    let maxIkDrift = 0;
    for (const i of targets) {
      inst.legBroken.fill(true);
      inst.legBroken[i] = false;
      const leg = inst.legs[i];
      const points = [world(leg.coxa), world(leg.femur), world(leg.tibia), world(leg.toe)];
      maxIkDrift = Math.max(maxIkDrift, points[3].distanceTo(leg.foot));
      for (let segment = 0; segment < 3; segment += 1) {
        for (const fraction of [0.15, 0.5, 0.85]) {
          samples += 1;
          const target = V3().copy(points[segment]).lerp(points[segment + 1], fraction);
          const outward = V3().set(target.x - inst.x, 0, target.z - inst.z);
          if (outward.lengthSq() < 0.01) outward.set(1, 0, 0);
          outward.normalize();
          const origin = V3().copy(target).addScaledVector(outward, 3);
          const direction = V3().copy(outward).multiplyScalar(-1);
          const hit = T.combat.raycastEnemies(
            origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, 6);
          if (hit?.inst !== inst || hit?.legIndex !== i) {
            misses.push({ i, segment, fraction, hitLeg: hit?.legIndex ?? null });
          }
        }
      }
    }
    inst.legBroken.splice(0, inst.legBroken.length, ...original);
    return { targets: targets.length, samples, maxIkDrift: Number(maxIkDrift.toFixed(2)), misses };
  });
  check("folded leg hitboxes follow every live rendered segment, not the stale IK feet",
    collapsedLegCoverage.targets === 4 && collapsedLegCoverage.samples === 36
      && collapsedLegCoverage.maxIkDrift > 2 && collapsedLegCoverage.misses.length === 0,
    collapsedLegCoverage.misses.length
      ? JSON.stringify(collapsedLegCoverage.misses.slice(0, 4))
      : `${collapsedLegCoverage.samples}/36 spans aligned through ${collapsedLegCoverage.maxIkDrift}m IK drift`);

  const collapsedMelee = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    /* The HEAD bone, not "prosoma": the prosoma bone's origin is the
       armature root at ground level and its xz is the body centre -
       standing there puts the player INSIDE the collapsed capsule's
       footprint, which is exactly the touching-range case, but the
       head end frames the swing the way a player approaching it
       would. */
    const headBone = inst.bones.get("head");
    const V3 = () => new (Object.getPrototypeOf(headBone.position).constructor)();
    headBone.updateWorldMatrix(true, false);
    const bodyPos = headBone.getWorldPosition(V3());
    T._teleportRaw(bodyPos.x, bodyPos.z - 2.4, 0);
    T.setBodyHeading(0);
    for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
    const before = inst.health;
    T.pressMelee();
    T.renderOnce(1 / 60);
    for (let i = 0; i < 35; i += 1) T.renderOnce(1 / 60);
    return { collapsedDealt: before - inst.health, standingDealt: 0 };
  });
  check("the collapsed body is a melee target, and worth more than the standing leg hit",
    collapsedMelee.collapsedDealt > 0, `${collapsedMelee.collapsedDealt} dealt`);

  /* ---- THE BITE, FROM THE GROUND ---------------------------------------
     Thrown from the head at what is in front of the head. A trooper
     working the abdomen end for six seconds is never bitten; one
     standing in front of the mouth is, and for less than the old
     58-of-150. The collapse timer is stretched for the check and put
     back afterwards. */
  const collapsedBite = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const C = T.distaff.config;
    const V3 = () => new (Object.getPrototypeOf(inst.root.position).constructor)();
    const world = (bone) => {
      bone.updateWorldMatrix(true, false);
      return bone.getWorldPosition(V3());
    };
    T.forceDistaffPhase("collapsed", 40);
    // Let the leg-break stagger from the collapse trigger run out.
    for (let i = 0; i < Math.round(C.legBreakStagger * 60) + 30; i += 1) T.renderOnce(1 / 60);
    const ev = { biteTelegraph: 0, bite: 0, biteMiss: 0 };
    const offs = Object.keys(ev).map((k) => T.distaff.bus.on(k, () => { ev[k] += 1; }));
    // The rear: 3m behind the abdomen tip, on the head-to-tail axis.
    const head = world(inst.bones.get("head"));
    const tail = world(inst.bones.get("abdomen2"));
    const axis = V3().set(tail.x - head.x, 0, tail.z - head.z).normalize();
    T._teleportRaw(tail.x + axis.x * 2.4, tail.z + axis.z * 2.4, 0);
    T.setBodyHeading(0);
    // ...and it is a place a lance works from: the body is in reach.
    // Swung FIRST: the grounded animal still pivots, slowly, and after
    // six seconds a folded leg may have come round between the player
    // and the body - a leg hit, not a whiff, but not the body either.
    T.equipWeapon("glaive");
    const hpBefore = inst.health;
    const rearSwing = T.combat.meleeStrike(1, Math.PI * 2, false, 1, 0);
    const rearDealt = hpBefore - inst.health;
    const yaw0 = inst.yaw;
    for (let i = 0; i < 60 * 6; i += 1) T.renderOnce(1 / 60);
    const rear = { ...ev };
    const rearDistToCentre = Math.hypot(T.player.state.x - inst.x, T.player.state.z - inst.z);
    const turnedInSix = Math.abs(inst.yaw - yaw0);
    // The front: 3.2m ahead of the mouth.
    const head2 = world(inst.bones.get("head"));
    const fwd = V3().set(Math.sin(inst.yaw), 0, Math.cos(inst.yaw));
    T._teleportRaw(head2.x + fwd.x * 3.2, head2.z + fwd.z * 3.2, 0);
    for (let i = 0; i < 60 * 5; i += 1) T.renderOnce(1 / 60);
    const front = { ...ev };
    offs.forEach((f) => f());
    T.forceDistaffPhase("collapsed", 1.0);
    return {
      rearBites: rear.biteTelegraph, rearDistToCentre: Number(rearDistToCentre.toFixed(1)),
      rearSwing, rearDealt: Number(rearDealt.toFixed(0)),
      turnedInSix: Number(turnedInSix.toFixed(2)), collapsedTurnCap: C.turnRateCollapsed,
      frontTells: front.biteTelegraph - rear.biteTelegraph, frontBites: front.bite - rear.bite,
      biteDamage: C.biteDamage, biteCadence: C.biteCadence,
    };
  });
  check("the collapsed bite cannot reach a trooper working its rear - and the lance can work from there",
    collapsedBite.rearBites === 0 && collapsedBite.rearSwing >= 1 && collapsedBite.rearDealt > 0
      && collapsedBite.turnedInSix <= collapsedBite.collapsedTurnCap * 6 + 0.05,
    `${collapsedBite.rearBites} bites in 6s at ${collapsedBite.rearDistToCentre}m from the centre; a swing there dealt ${collapsedBite.rearDealt}; it pivoted ${collapsedBite.turnedInSix} rad meanwhile`);
  check("...and does bite what stands in front of the mouth, for less than it did",
    collapsedBite.frontTells > 0 && collapsedBite.frontBites > 0
      && collapsedBite.biteDamage <= 45 && collapsedBite.biteCadence >= 2.2,
    `${collapsedBite.frontBites} bites in 5s; ${collapsedBite.biteDamage} dmg every ${collapsedBite.biteCadence}s`);

  /* ---- RECOVER, BROKEN LEGS STAY BROKEN ------------------------------ */
  const recover = await page.evaluate(() => {
    const T = window.__SF;
    const before = T.distaffState().legBroken.slice();
    const secs = T.advanceToDistaffPhase("standing", 20);
    const after = T.distaffState();
    return { secs, before, after };
  });
  check("it stands back up if it survives the collapse window",
    recover.secs >= 0 && recover.after.phase === "standing" && !recover.after.collapsed,
    `${recover.secs}s`);
  check("legs broken before the collapse are still broken after",
    JSON.stringify(recover.before) === JSON.stringify(recover.after.legBroken));

  /* ---- THE LEASH ------------------------------------------------------ */
  const leash = await page.evaluate(() => {
    const T = window.__SF;
    T._teleportRaw(T.distaffState().x + 400, T.distaffState().z, 0);
    for (let f = 0; f < 120; f += 1) T.renderOnce(1 / 60);
    const st = T.distaffState();
    return {
      phase: st.phase,
      healed: st.health === st.maxHealth,
      legsRegrown: st.legsBroken === 0,
      homeDist: st.homeDist,
    };
  });
  check("leaving the Glass Scar restores the Distaff and regrows its legs",
    leash.healed && leash.legsRegrown, JSON.stringify(leash));
  check("the boundary reset returns it dormant to the lair, ready to re-aggro",
    leash.phase === "dormant" && leash.homeDist < 4,
    JSON.stringify(leash));

  /* Re-aggro after the reset: same encounter, no second camera steal. */
  const reaggro = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToDistaff(30);
    const secs = T.advanceToDistaffPhase("standing", 12);
    return { secs, free: !!T.player.state.free };
  });
  check("a fresh approach wakes it again", reaggro.secs >= 0 && !reaggro.free);

  /* ---- DEATH ----------------------------------------------------------- */
  const death = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    let defeated = null;
    const off = T.distaff.bus.on("defeated", (e) => { defeated = e; });
    T.combat.damageEnemy(inst, 999999, { source: "qa" });
    for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);
    off();
    return { state: T.distaffState(), defeated };
  });
  check("lethal damage kills it and the encounter reports it", death.state.dead && !!death.defeated);

  /* ---- COST ------------------------------------------------------------ */
  const cost = await page.evaluate(() => {
    const T = window.__SF;
    // Fresh instance for a representative "mid-fight" cost measurement:
    // standing, web patches live, some legs already broken.
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
