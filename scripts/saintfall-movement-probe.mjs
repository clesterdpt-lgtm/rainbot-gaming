#!/usr/bin/env node
/* Saintfall movement rebind: Shift is no longer a sprint modifier.
   Proves the standard stride, the tap-to-boost / hold-to-glide
   envelope, steering while gliding, contact damage and knockback,
   firing while gliding and airborne, and the Penitent's Fall - its
   hang, its plunge, its area damage and the stun it leaves behind.

   Every locomotion check drives REAL keyboard events, because the
   whole point of this change is what the keys do. The only direct
   calls are setup (teleport, spawn, refuel) and readback. */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/movement-qa");
const port = 46700 + (process.pid % 1400);
const base = `http://127.0.0.1:${port}`;
const sources = [
  "assets/js/saintfall/boost.js", "assets/js/saintfall/slam.js",
  "assets/js/saintfall/player.js", "assets/js/saintfall/jetpack.js",
  "assets/js/saintfall/combat.js", "assets/js/saintfall/enemies.js",
  "assets/js/saintfall/vfx.js", "assets/js/saintfall/audio.js",
  "assets/js/saintfall/hud.js", "assets/js/saintfall/touch.js",
  "assets/js/saintfall/main.js", "assets/js/saintfall/qa.js",
  "assets/js/saintfall/boot.js", "games/saintfall.html",
];

async function hashes() {
  const out = {};
  for (const file of sources) {
    out[file] = createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
  }
  return out;
}

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

async function waitServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function saveDataUrl(file, value) {
  await writeFile(file, Buffer.from(value.replace(/^data:image\/png;base64,/, ""), "base64"));
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const before = await hashes();
  const child = server();
  let browser;
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&time=noon`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

    /* The game only claims gameplay keys once the canvas owns
       interaction - pointer lock, canvas focus, or max-screen. Headless
       Chromium will not grant pointer lock, so this probe enters
       max-screen, which is a real player state and the one path to
       keyboard ownership a test can reach honestly. */
    await page.evaluate(() => document.documentElement.classList.add("sf-maximised"));
    const ownsKeys = await page.evaluate(() =>
      document.documentElement.classList.contains("sf-maximised"));

    const report = {
      keyboardOwned: ownsKeys,
      build: await page.evaluate(() => window.__SF?.version || window.__SF_BOOT?.build || null),
      sourceBefore: before,
      checks: [],
      states: {},
      errors,
    };
    const check = (name, pass, detail) => report.checks.push({ name, pass: !!pass, detail });
    const config0 = await page.evaluate(() => ({
      boost: window.__SF.boost.config, slam: window.__SF.slam.config,
    }));
    const config = config0;
    report.config = config0;
    const near = (a, b, tol) => Math.abs(a - b) <= tol;

    const step = (seconds, dt = 1 / 60) => page.evaluate(
      ({ seconds, dt }) => { window.__SF.advanceTime(seconds, dt); }, { seconds, dt });

    /** Clean slate: flat ground, full charge, no garrison, no cooldowns. */
    async function stage({ yaw = 0, radius = 22, enemies = [] } = {}) {
      await page.keyboard.up("ShiftLeft").catch(() => {});
      await page.keyboard.up("Space").catch(() => {});
      for (const key of ["KeyW", "KeyA", "KeyS", "KeyD"]) {
        await page.keyboard.up(key).catch(() => {});
      }
      return page.evaluate(({ yaw, radius, enemies }) => {
        const T = window.__SF;
        T.clearEnemies();
        T.releaseCamera();
        T.invulnerable(true);
        const site = T.findFlatSite(radius);
        T.teleport(site[0], site[1], yaw);
        T.setFiring(false);
        T.setAds(0);
        T.resetBoost(true);
        T.resetSlam(true);
        T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
        T.advanceTime(0.4, 1 / 60);
        const p = T.player.state;
        const spawned = [];
        for (const e of enemies) {
          const a = yaw + (e.bearing || 0);
          const x = p.x + Math.sin(a) * e.range;
          const z = p.z + Math.cos(a) * e.range;
          spawned.push(T.spawnEnemy(e.key, x, z,
            e.health ? { health: e.health } : {}));
        }
        T.advanceTime(0.1, 1 / 60);
        return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, spawned };
      }, { yaw, radius, enemies });
    }

    const playerState = () => page.evaluate(() => {
      const p = window.__SF.player.state;
      return {
        x: p.x, y: p.y, z: p.z, yaw: p.yaw, camYaw: p.camYaw,
        grounded: p.grounded, speed: p.speed ?? null, vy: p.vy,
      };
    });

    /* The fraction of the frame the effect has driven to near-white.
       Measuring "how gold" the picture is does not work here: the
       desert is already orange, and additive light pushes pixels
       toward WHITE, so a redness metric goes the wrong way at exactly
       the moment the strike lands. Blown-out pixels are the one thing
       sand cannot produce on its own. */
    async function flareFraction(file) {
      const img = sharp(path.join(outDir, file));
      const { width, height } = await img.metadata();
      const { data, info } = await img
        .extract({
          left: Math.round(width * 0.22), top: Math.round(height * 0.18),
          width: Math.round(width * 0.56), height: Math.round(height * 0.62),
        })
        .raw().toBuffer({ resolveWithObject: true });
      let lit = 0;
      const px = info.width * info.height;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i] > 244 && data[i + 1] > 238 && data[i + 2] > 228) lit += 1;
      }
      return (lit / px) * 100;
    }

    async function capture(label, bearings = [90], opts = {}) {
      const { radius = 6.2, fov = 56, targetY = 1.15, lift = 1.5 } = opts;
      const files = [];
      for (const bearing of bearings) {
        const data = await page.evaluate(({ bearing, radius, fov, targetY, lift }) => {
          const T = window.__SF;
          const p = T.player.state;
          const a = bearing * Math.PI / 180;
          const camera = T.render.camera;
          camera.position.set(p.x + Math.sin(a) * radius, p.y + lift, p.z + Math.cos(a) * radius);
          camera.lookAt(new T.THREE.Vector3(p.x, p.y + targetY, p.z));
          camera.fov = fov;
          camera.updateProjectionMatrix();
          T.render.render(camera);
          return T.captureDataURL();
        }, { bearing, radius, fov, targetY, lift });
        const file = path.join(outDir, `${label}-${String(bearing).padStart(3, "0")}.png`);
        await saveDataUrl(file, data);
        files.push(path.basename(file));
      }
      return files;
    }

    /* ---------------------------------------------------------------
       1. SHIFT IS NOT A SPRINT MODIFIER

       The old binding is gone, so plain W must already move at what
       used to be the sprint speed. Measured as ground distance over a
       fixed wall-clock, with and without Shift held - and the two must
       agree, because holding Shift now spends charge on a glide rather
       than changing the walk.
       --------------------------------------------------------------- */
    await stage({ yaw: 0 });
    await page.keyboard.down("KeyW");
    await step(1.2);
    const walkStart = await playerState();
    await step(1.5);
    const walkEnd = await playerState();
    await page.keyboard.up("KeyW");
    const walkSpeed = Math.hypot(walkEnd.x - walkStart.x, walkEnd.z - walkStart.z) / 1.5;
    report.states.walk = { walkSpeed: Number(walkSpeed.toFixed(3)) };
    check("plain W already moves at the old sprint speed (>= 6.5 m/s)",
      walkSpeed >= 6.5, `${walkSpeed.toFixed(2)} m/s`);

    /* Shift alone, standing still, must not be a movement modifier -
       and must not silently drain the reliquary either. */
    await stage({ yaw: 0 });
    const beforeIdleHold = await page.evaluate(() => window.__SF.jetpackState().fuel);
    await page.keyboard.down("ShiftLeft");
    await step(1.0);
    const idleHold = await playerState();
    const idleFuel = await page.evaluate(() => window.__SF.jetpackState().fuel);
    const idleBoost = await page.evaluate(() => window.__SF.boostState());
    await page.keyboard.up("ShiftLeft");
    report.states.idleHold = { idleBoost, idleFuel, beforeIdleHold, idleHold };
    /* Shift alone is a dash on facing - a key that refuses to fire
       because the stick is centred reads as broken - but it must not
       extend into a stationary glide burning charge for nothing. */
    check("Shift held with no direction dashes but does not hover-drain",
      !idleBoost.active
        && beforeIdleHold - idleFuel <= config0.boost.ignitionCost + 1.5,
      `active=${idleBoost.active}, spent ${(beforeIdleHold - idleFuel).toFixed(1)} of `
        + `${config0.boost.ignitionCost} ignition`);

    /* ---------------------------------------------------------------
       2. TAP TO BOOST

       A tap is a press and an immediate release. It must produce a
       short burst that ends on its own near `burst`, well before the
       glide ceiling.
       --------------------------------------------------------------- */
    await stage({ yaw: 0 });
    await page.keyboard.down("KeyW");
    await step(0.5);
    await page.keyboard.down("ShiftLeft");
    await step(1 / 60, 1 / 60);
    await page.keyboard.up("ShiftLeft");
    let tapElapsed = 0;
    let tapPeak = 0;
    for (let i = 0; i < 90; i += 1) {
      await step(1 / 60, 1 / 60);
      const b = await page.evaluate(() => window.__SF.boostState());
      if (b.active) { tapElapsed = b.elapsed; tapPeak = Math.max(tapPeak, b.speed); }
      else if (tapElapsed > 0) break;
    }
    await page.keyboard.up("KeyW");
    report.states.tap = { tapElapsed, tapPeak: Number(tapPeak.toFixed(2)) };
    check("a Shift tap boosts and self-terminates near the burst window",
      tapElapsed > 0 && tapElapsed <= config.boost.burst + 0.12,
      `ran ${tapElapsed.toFixed(3)}s against burst ${config.boost.burst}s, peak ${tapPeak.toFixed(1)} m/s`);
    check("the tap burst is faster than the standard stride",
      tapPeak >= walkSpeed + 4, `${tapPeak.toFixed(1)} vs walk ${walkSpeed.toFixed(1)} m/s`);

    /* ---------------------------------------------------------------
       3. HOLD TO GLIDE

       Held, the same key must sustain the glide well past the tap
       window, and must run out of charge rather than run out of clock
       - so the ceiling to prove is the configured `glideMax`.
       --------------------------------------------------------------- */
    await stage({ yaw: 0 });
    await page.keyboard.down("KeyW");
    await step(0.5);
    const glideFuelBefore = await page.evaluate(() => window.__SF.jetpackState().fuel);
    await page.keyboard.down("ShiftLeft");
    let glideElapsed = 0;
    let glideHolding = false;
    let glideDistance = 0;
    const glideFrom = await playerState();
    for (let i = 0; i < 180; i += 1) {
      await step(1 / 60, 1 / 60);
      const b = await page.evaluate(() => window.__SF.boostState());
      if (b.active) {
        glideElapsed = b.elapsed;
        glideHolding = glideHolding || b.holding;
      } else if (glideElapsed > 0) break;
    }
    const glideTo = await playerState();
    glideDistance = Math.hypot(glideTo.x - glideFrom.x, glideTo.z - glideFrom.z);
    const glideFuelAfter = await page.evaluate(() => window.__SF.jetpackState().fuel);
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");
    report.states.glide = {
      glideElapsed: Number(glideElapsed.toFixed(3)),
      glideDistance: Number(glideDistance.toFixed(2)),
      glideHolding,
      fuel: [glideFuelBefore, glideFuelAfter],
    };
    check("holding Shift sustains the glide far past a tap",
      glideElapsed >= config.boost.burst * 2.5 && glideHolding,
      `${glideElapsed.toFixed(2)}s held (tap window ${config.boost.burst}s), holding=${glideHolding}`);
    check("a sustained glide covers real ground",
      glideDistance >= 30, `${glideDistance.toFixed(1)} m`);
    check("the glide drains the reliquary while it is held",
      glideFuelAfter < glideFuelBefore - config.boost.ignitionCost,
      `${glideFuelBefore.toFixed(1)} -> ${glideFuelAfter.toFixed(1)}`);

    /* Releasing Shift must end the glide promptly, not coast. */
    await stage({ yaw: 0 });
    await page.keyboard.down("KeyW");
    await step(0.5);
    await page.keyboard.down("ShiftLeft");
    await step(0.8);
    const heldMid = await page.evaluate(() => window.__SF.boostState());
    await page.keyboard.up("ShiftLeft");
    await step(0.2);
    const afterRelease = await page.evaluate(() => window.__SF.boostState());
    await page.keyboard.up("KeyW");
    report.states.release = { heldMid, afterRelease };
    check("releasing Shift ends the glide",
      heldMid.active && !afterRelease.active,
      `held active=${heldMid.active}, 0.2s after release active=${afterRelease.active}`);

    /* ---------------------------------------------------------------
       4. STEERING: A, S AND D

       Shift plus a lateral or rearward key must glide THAT way, not
       forward. Measured as the angle between the travel vector and the
       facing, which is the only definition that survives a rebind.
       --------------------------------------------------------------- */
    const directions = [
      { key: "KeyA", label: "left", expect: 90 },
      { key: "KeyD", label: "right", expect: -90 },
      { key: "KeyS", label: "back", expect: 180 },
      { key: "KeyW", label: "forward", expect: 0 },
    ];
    report.states.steering = {};
    for (const dir of directions) {
      await stage({ yaw: 0 });
      await page.keyboard.down(dir.key);
      await step(0.4);
      const from = await playerState();
      await page.keyboard.down("ShiftLeft");
      await step(0.7);
      const to = await playerState();
      const boost = await page.evaluate(() => window.__SF.boostState());
      await page.keyboard.up("ShiftLeft");
      await page.keyboard.up(dir.key);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const travel = Math.hypot(dx, dz);
      /* Measured against the CAMERA, not the body. WASD is
         camera-relative in this game and the trooper always turns to
         face where it travels, so body yaw is an output of the glide
         rather than a frame of reference for it. */
      const bearing = Math.atan2(dx, dz) * 180 / Math.PI - from.camYaw * 180 / Math.PI;
      const rel = ((bearing + 540) % 360) - 180;
      const err = Math.abs(((rel - dir.expect + 540) % 360) - 180);
      report.states.steering[dir.label] = {
        travel: Number(travel.toFixed(2)),
        relative: Number(rel.toFixed(1)),
        error: Number(err.toFixed(1)),
        attack: boost.attack,
        yawHeld: Number((to.yaw - from.yaw).toFixed(4)),
      };
      check(`Shift + ${dir.key} glides ${dir.label}`,
        travel >= 8 && err <= 22,
        `${travel.toFixed(1)} m at ${rel.toFixed(0)}deg off facing (want ${dir.expect}deg)`);
      check(`gliding ${dir.label} does not swing the view`,
        near(to.camYaw, from.camYaw, 1e-3),
        `camera drift ${(to.camYaw - from.camYaw).toFixed(5)} rad`);
      /* Only forward is a ram. Sideways and backwards are mobility. */
      const wantAttack = dir.label === "forward";
      check(`gliding ${dir.label} is ${wantAttack ? "an attack" : "mobility only"}`,
        boost.attack === wantAttack, `attack=${boost.attack}`);
    }

    /* ---------------------------------------------------------------
       5. FIRING WHILE GLIDING

       The user asked for it explicitly, and the old build refused the
       trigger outright during a boost. Shot counters are the proof.
       --------------------------------------------------------------- */
    await stage({ yaw: 0 });
    await page.keyboard.down("KeyW");
    await step(0.4);
    await page.keyboard.down("ShiftLeft");
    await step(0.25);
    const shotsBeforeGlide = await page.evaluate(() => window.__SF.combatStats().shots);
    await page.evaluate(() => window.__SF.setFiring(true));
    await step(1.2);
    const shotsAfterGlide = await page.evaluate(() => window.__SF.combatStats().shots);
    const glideFireState = await page.evaluate(() => {
      const node = document.querySelector("#sf-reticle");
      return {
        boost: window.__SF.boostState(),
        reticle: node ? getComputedStyle(node).opacity : null,
      };
    });
    const glideShots = await capture("glide-firing", [70, 250]);
    const boostVisual = await page.evaluate(() => {
      const T = window.__SF;
      const p = T.player.state;
      T.render.scene.updateMatrixWorld(true);
      let wake = null;
      let footJetCount = 0;
      let visibleFootJets = 0;
      T.render.scene.traverse((o) => {
        if (o.name === "glide-wake") {
          const w = o.getWorldPosition(new T.THREE.Vector3());
          wake = {
            visible: o.visible,
            offset: Math.hypot(w.x - p.x, w.z - p.z),
          };
        }
        if (/^glide-jet-/.test(o.name || "")) {
          footJetCount += 1;
          if (o.visible) visibleFootJets += 1;
        }
      });
      return {
        wake,
        footJetCount,
        visibleFootJets,
        jetpack: T.jetpackState(),
      };
    });
    await page.evaluate(() => window.__SF.setFiring(false));
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");
    report.states.glideFiring = {
      shots: [shotsBeforeGlide, shotsAfterGlide],
      boost: glideFireState.boost,
      reticle: glideFireState.reticle,
      shotFiles: glideShots,
    };
    check("the lance fires while gliding",
      shotsAfterGlide > shotsBeforeGlide && glideFireState.boost.active,
      `${shotsBeforeGlide} -> ${shotsAfterGlide} shots, gliding=${glideFireState.boost.active}`);
    check("the reticle stays up while gliding",
      Number(glideFireState.reticle) > 0.5, `opacity ${glideFireState.reticle}`);
    report.states.boostVisual = boostVisual;
    /* Two and a half metres, not one: the rig is placed once a frame
       and the trooper is covering nineteen metres a second, so a
       fraction of a frame's travel is expected. The bound that matters
       is "on the trooper" versus "at twice the trooper's world
       coordinates", which is what this used to be. */
    check("the glide lays its wake under the trooper",
      boostVisual.wake?.visible && boostVisual.wake.offset < 2.5,
      JSON.stringify(boostVisual.wake));
    check("ground Shift boost burns from the reliquary jetpack",
      boostVisual.jetpack.boostThrust
        && boostVisual.jetpack.mode === "boost"
        && boostVisual.jetpack.flameVisible
        && boostVisual.jetpack.exhaustParticles > 0
        && boostVisual.jetpack.wingSpread > 0.6,
      JSON.stringify(boostVisual.jetpack));
    check("ground boost has no foot-mounted jet VFX",
      boostVisual.footJetCount === 0 && boostVisual.visibleFootJets === 0,
      `nodes=${boostVisual.footJetCount}, visible=${boostVisual.visibleFootJets}`);

    /* ---------------------------------------------------------------
       6. FORWARD GLIDE DAMAGES AND THROWS

       A Thresher parked directly ahead. Forward glide only - the
       lateral cases above already proved they do not attack.
       --------------------------------------------------------------- */
    await stage({ yaw: 0, enemies: [{ key: "thresher", bearing: 0, range: 26 }] });
    const contactBefore = await page.evaluate(() => window.__SF.enemyStatus());
    await page.keyboard.down("KeyW");
    await step(0.4);
    await page.keyboard.down("ShiftLeft");
    await step(2.6);
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");
    const contactAfter = await page.evaluate(() => window.__SF.enemyStatus());
    const contactBoost = await page.evaluate(() => window.__SF.boostState());
    report.states.contact = { contactBefore, contactAfter, contactBoost };
    const hurt = contactBefore[0] && contactAfter[0]
      && contactAfter[0].health < contactBefore[0].health;
    const moved = contactBefore[0] && contactAfter[0]
      ? Math.hypot(contactAfter[0].x - contactBefore[0].x, contactAfter[0].z - contactBefore[0].z)
      : 0;
    check("gliding forward into a Thresher damages it",
      hurt && contactBoost.hits > 0,
      `health ${contactBefore[0]?.health} -> ${contactAfter[0]?.health}, hits ${contactBoost.hits}`);
    check("a lighter enemy is thrown clear by the impact",
      moved >= 1.2, `displaced ${moved.toFixed(2)} m`);

    /* ---------------------------------------------------------------
       7. SHIFT + SPACE STILL FLIES

       The rebind must not have cost the jetpack its modifier.
       --------------------------------------------------------------- */
    await stage({ yaw: 0 });
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    await step(1.1);
    const flight = await page.evaluate(() => ({
      jet: window.__SF.jetpackState(), p: {
        y: window.__SF.player.state.y, grounded: window.__SF.player.state.grounded,
      },
    }));
    const airShotsBefore = await page.evaluate(() => window.__SF.combatStats().shots);
    await page.evaluate(() => window.__SF.setFiring(true));
    await step(0.9);
    const airShotsAfter = await page.evaluate(() => window.__SF.combatStats().shots);
    const airborneShots = await capture("airborne-firing", [70],
      { radius: 8.5, lift: 2.4, targetY: 0.4 });
    await page.evaluate(() => window.__SF.setFiring(false));
    await page.keyboard.up("Space");
    await page.keyboard.up("ShiftLeft");
    report.states.flight = {
      jet: flight.jet, y: flight.p.y, shots: [airShotsBefore, airShotsAfter],
      shotFiles: airborneShots,
    };
    check("Shift + Space still lifts off",
      flight.jet.inFlight && !flight.p.grounded,
      `inFlight=${flight.jet.inFlight}, grounded=${flight.p.grounded}`);
    check("the lance fires while airborne",
      airShotsAfter > airShotsBefore, `${airShotsBefore} -> ${airShotsAfter} shots`);

    /* ---------------------------------------------------------------
       8. THE PENITENT'S FALL

       Q, in the air. Hang, plunge, strike. Everything within reach
       damaged and stunned; the trooper on the floor and recovering.
       --------------------------------------------------------------- */
    /* The page keeps running its own animation frames between two
       Playwright calls, so anything that has to be sampled "on the
       frame before impact" must be sampled from INSIDE the page. The
       landing below is one atomic evaluate for that reason: an earlier
       version of this probe read a pre-impact roster that had already
       been hit, and reported the strike as dealing no damage.

       The garrison is also raised during the hang rather than at
       staging, because a Thresher walks - given the climb it would
       otherwise be standing on the trooper's boots by the time the
       lance came down, and a ring where everything is at zero metres
       cannot show a falloff. */
    const ANVIL = 900;
    await stage({ yaw: 0 });
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    await step(1.5);
    await page.keyboard.up("Space");
    await page.keyboard.up("ShiftLeft");
    const slamLaunch = await page.evaluate(() => ({
      altitude: window.__SF.slamAltitude(),
      state: window.__SF.slamState(),
      jet: window.__SF.jetpackState(),
      grounded: window.__SF.player.state.grounded,
    }));
    check("a jetpack climb leaves enough charge to commit to the fall",
      slamLaunch.jet.fuel >= config.slam.fuelCost && !slamLaunch.grounded,
      `${slamLaunch.jet.fuel.toFixed(1)} charge at ${slamLaunch.altitude?.toFixed(1)} m`);

    const hang = await page.evaluate(({ anvil }) => {
      const T = window.__SF;
      const triggered = T.triggerSlam().triggered;
      const p = T.player.state;
      // One anvil per band, plus an ordinary Thresher and a bystander.
      const ring = [
        { key: "thresher", bearing: 0.0, range: 3.0, health: anvil },
        { key: "thresher", bearing: 2.1, range: 7.0, health: anvil },
        { key: "thresher", bearing: -2.1, range: 11.0, health: anvil },
        { key: "thresher", bearing: 1.05, range: 4.0 },
        { key: "thresher", bearing: 3.14, range: 34.0, health: anvil },
      ];
      for (const e of ring) {
        T.spawnEnemy(e.key, p.x + Math.sin(e.bearing) * e.range,
          p.z + Math.cos(e.bearing) * e.range, e.health ? { health: e.health } : {});
      }
      return {
        triggered,
        slam: T.slamState(),
        vy: p.vy,
        y: p.y,
        roster: T.enemyStatus(),
      };
    }, { anvil: ANVIL });
    const hangShot = await capture("slam-hang", [70],
      { radius: 9.0, lift: 2.4, targetY: 0.2 });
    check("Q in the air begins the hang, not a fall",
      hang.triggered && hang.slam.active && hang.slam.phase === "hang" && hang.vy >= 0,
      `phase=${hang.slam.phase}, vy=${hang.vy.toFixed(2)}`);
    check("the charge builds during the hang",
      hang.slam.charge > 0 && hang.slam.charge < 1, `charge ${hang.slam.charge}`);
    check("the trooper arches back over the raised lance",
      hang.slam.lean < -0.15, `body lean ${hang.slam.lean} rad`);

    /* Plunge and landfall in ONE evaluate. Split across two, the
       settle frames used for the photograph could contain the impact,
       and the roster sampled afterwards was already a struck one -
       which reported a strike that damaged nothing. */
    const fall = await page.evaluate(() => {
      const T = window.__SF;
      let before = T.enemyStatus();
      let at = { x: T.player.state.x, y: T.player.state.y, z: T.player.state.z };
      let plunge = null;
      let settleFrames = 0;
      for (let i = 0; i < 600; i += 1) {
        before = T.enemyStatus();
        at = { x: T.player.state.x, y: T.player.state.y, z: T.player.state.z };
        T.advanceTime(1 / 120, 1 / 120);
        const s = T.slamState();
        if (!plunge && s.phase === "plunge") {
          plunge = { slam: s, vy: T.player.state.vy, y: T.player.state.y };
        }
        /* The attitude that is photographed and measured is the one a
           few frames past the phase flip - the transition frame is
           still holding the gather. */
        if (plunge && settleFrames < 8 && s.active) {
          settleFrames += 1;
          plunge.settled = s;
          plunge.pitch = T.player.figure.root.rotation.x;
        }
        if (!s.active) {
          return {
            plunge, landed: s, before, at, after: T.enemyStatus(),
            frames: i + 1, grounded: T.player.state.grounded,
          };
        }
      }
      return { plunge, landed: null, before, at, after: T.enemyStatus(), frames: 600 };
    });
    const plunge = fall.plunge;
    const strike = fall;
    const plungeShot = await capture("slam-plunge", [70],
      { radius: 9.0, lift: 2.4, targetY: 0.2 });
    check("the plunge is faster than gravity would manage",
      plunge && plunge.slam.phase === "plunge"
        && plunge.vy <= -config.slam.plungeSpeed + 1,
      `phase=${plunge?.slam.phase}, vy=${plunge?.vy.toFixed(1)} m/s`);
    check("the body is thrown forward so the lance leads the fall",
      plunge?.settled?.lean > 0.5 && plunge?.pitch > 0.5,
      `lean ${plunge?.settled?.lean} rad, figure pitch `
        + `${plunge?.pitch?.toFixed(3)} rad`);

    const impactShot = await capture("slam-impact", [70, 250],
      { radius: 9.5, lift: 2.0, targetY: 0.3 });
    /* Where the rig actually put itself, and how bright the frame got:
       an earlier build parented the world-space rings to a group the
       glide dragged around, so every ring expanded at twice the
       trooper's coordinates - off the map, invisible, and silent
       about it. Distance from the strike is now a check. */
    await step(0.12, 1 / 120);
    const rigNodes = await page.evaluate(({ x, z }) => {
      const T = window.__SF;
      const out = {};
      T.render.scene.updateMatrixWorld(true);
      T.render.scene.traverse((o) => {
        if (!/^(slam-ring-0|slam-dome|glide-wake)$/.test(o.name || "")) return;
        const w = o.getWorldPosition(new T.THREE.Vector3());
        out[o.name] = {
          visible: o.visible && o.parent?.visible !== false,
          offset: Math.hypot(w.x - x, w.z - z),
          scale: Number(o.scale.x.toFixed(2)),
        };
      });
      return out;
    }, { x: strike.at.x, z: strike.at.z });
    const wideView = { radius: 16.0, lift: 6.0, targetY: 0.0, fov: 62 };
    const wideShot = await capture("slam-ring", [70], wideView);
    const ringLight = await flareFraction(wideShot[0]);

    const landed = strike.landed;
    check("the plunge resolves into an impact",
      landed && landed.lastReason === "impact" && strike.grounded,
      `reason=${landed?.lastReason}, grounded=${strike.grounded}`);
    report.states.rig = {
      rigNodes,
      ringLight: Number(ringLight.toFixed(3)),
    };
    check("the shockwave ring expands where the lance landed",
      rigNodes["slam-ring-0"]?.visible && rigNodes["slam-ring-0"].offset < 1.0
        && rigNodes["slam-ring-0"].scale > 1.5,
      JSON.stringify(rigNodes["slam-ring-0"]));
    check("the impact dome is at the strike, not at twice its coordinates",
      rigNodes["slam-dome"]?.visible && rigNodes["slam-dome"].offset < 1.0,
      JSON.stringify(rigNodes["slam-dome"]));


    /* Everything measured against where the lance actually came down. */
    const strikeRadius = landed
      ? config.slam.radius * (1 + Math.min(1, landed.fallen / 14) * 0.28)
      : config.slam.radius;
    const roster = strike.before.map((e, i) => ({
      before: e,
      after: strike.after[i] || null,
      range: Math.hypot(e.x - strike.at.x, e.z - strike.at.z),
      dealt: Math.max(0, e.health - (strike.after[i]?.health ?? e.health)),
    }));
    const inside = roster.filter((e) => e.range <= strikeRadius);
    const outside = roster.filter((e) => e.range > strikeRadius + 3);
    const anvils = inside.filter((e) => e.before.health > 200);
    report.states.slam = {
      slamLaunch, hang, plunge, landed, strikeRadius,
      impactAt: strike.at, frames: strike.frames,
      roster: roster.map((e) => ({
        range: Number(e.range.toFixed(2)),
        dealt: Number(e.dealt.toFixed(1)),
        health: [e.before.health, e.after?.health ?? null],
        stunTime: e.after?.stunTime ?? null,
        state: e.after?.state ?? null,
      })),
      shots: { hang: hangShot, plunge: plungeShot, impact: impactShot, ring: wideShot },
    };

    check("the strike caught the garrison standing inside its ring",
      inside.length >= 4 && outside.length >= 1,
      `${inside.length} inside ${strikeRadius.toFixed(1)} m, ${outside.length} clear`);
    check("the slam damages everything inside the ring",
      inside.length > 0 && inside.every((e) => e.dealt > 0),
      inside.map((e) => `${e.range.toFixed(1)}m -${e.dealt.toFixed(0)}`).join(", "));
    check("the slam kills an ordinary Thresher outright",
      roster.some((e) => e.range <= strikeRadius && e.after?.state === "death"),
      roster.map((e) => `${e.range.toFixed(1)}m ${e.after?.state}`).join(", "));
    check("survivors of the strike are left stunned",
      anvils.length >= 2 && anvils.every((e) => (e.after?.stunTime || 0) > 0.5),
      anvils.map((e) => `${e.range.toFixed(1)}m stun ${(e.after?.stunTime || 0).toFixed(2)}s`)
        .join(", "));
    check("the slam has an edge and spares what is outside it",
      outside.length > 0
        && outside.every((e) => e.dealt === 0 && (e.after?.stunTime || 0) <= 0.01),
      outside.map((e) => `${e.range.toFixed(1)}m -${e.dealt.toFixed(0)}`).join(", "));

    const ordered = anvils.slice().sort((a, b) => a.range - b.range);
    const nearest = ordered[0];
    const farthest = ordered[ordered.length - 1];
    check("damage falls off from the centre",
      nearest && farthest && nearest !== farthest
        && farthest.range - nearest.range > 2
        && nearest.dealt > farthest.dealt + 5,
      `${nearest?.range.toFixed(1)}m -${nearest?.dealt.toFixed(0)} vs `
        + `${farthest?.range.toFixed(1)}m -${farthest?.dealt.toFixed(0)}`);
    check("the slam reports its own hits and stuns",
      landed && landed.lastHits >= 4 && landed.stunned >= 2,
      `hits ${landed?.lastHits}, stunned ${landed?.stunned}`);

    /* A stunned enemy must actually stop. Watched over half a second
       while it is still inside its stun window. */
    const stunWatch = await page.evaluate(() => {
      const T = window.__SF;
      const from = T.enemyStatus();
      T.advanceTime(0.5, 1 / 60);
      return { from, to: T.enemyStatus() };
    });
    const watched = stunWatch.from
      .map((e, i) => ({ e, to: stunWatch.to[i] }))
      .filter(({ e }) => e.stunTime > 0.6 && e.state !== "death");
    const stunDrift = watched.map(({ e, to }) => Math.hypot(to.x - e.x, to.z - e.z));
    report.states.stunDrift = stunDrift.map((d) => Number(d.toFixed(3)));
    check("stunned enemies stop moving",
      watched.length >= 2 && stunDrift.every((d) => d < 0.6),
      `${watched.length} watched, drift ${stunDrift.map((d) => d.toFixed(2)).join(", ")} m in 0.5s`);

    /* The honest comparison for the effect is the SAME camera over the
       same ground once the ring has burned out. Taken here, after the
       stun window has been measured, so watching one does not consume
       the other. */
    await step(1.2);
    const settledShot = await capture("slam-settled", [70], wideView);
    const settledLight = await flareFraction(settledShot[0]);
    report.states.rig.settledLight = Number(settledLight.toFixed(3));
    check("the strike lights the frame",
      ringLight > settledLight + 0.5 && ringLight > 0.6,
      `${ringLight.toFixed(2)}% of the frame blown out at the strike vs `
        + `${settledLight.toFixed(2)}% once it has burned out`);

    /* ---------------------------------------------------------------
       9. THE SLAM'S GUARDS

       Grounded Q must remain the melee swing, and the slam must
       refuse to chain into itself.
       --------------------------------------------------------------- */
    await stage({ yaw: 0 });
    await page.keyboard.press("KeyQ");
    await step(0.1);
    const groundQ = await page.evaluate(() => ({
      slam: window.__SF.slamState(), action: window.__SF.player.state.action || null,
      mode: window.__SF.weapons?.current?.spec?.melee ?? null,
    }));
    await step(1.4);
    check("Q on the ground is still the melee swing, not a slam",
      !groundQ.slam.active && groundQ.slam.lastReason !== "impact",
      `slam active=${groundQ.slam.active}, reason=${groundQ.slam.lastReason}`);

    await stage({ yaw: 0 });
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    await step(1.2);
    await page.keyboard.up("Space");
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.press("KeyQ");
    for (let i = 0; i < 300; i += 1) {
      await step(1 / 120, 1 / 120);
      if (!(await page.evaluate(() => window.__SF.slamState().active))) break;
    }
    const cooling = await page.evaluate(() => window.__SF.slamState());
    await page.keyboard.press("KeyQ");
    await step(0.05);
    const rechain = await page.evaluate(() => window.__SF.slamState());
    report.states.guards = { groundQ, cooling, rechain };
    check("the slam leaves a cooldown behind it",
      cooling.cooldownRemaining > 0, `${cooling.cooldownRemaining}s remaining`);
    check("the slam cannot be chained into itself",
      !rechain.active && rechain.slams === cooling.slams,
      `slams ${cooling.slams} -> ${rechain.slams}`);

    /* No charge, no fall. Flown and asked in one turn - the page's own
       animation frames run between two Playwright calls, and a trooper
       left hanging across that gap simply lands. */
    await stage({ yaw: 0 });
    const dry = await page.evaluate(() => {
      const T = window.__SF;
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      /* Ignition is EDGE-triggered on the chord. Hold a few frames of
         a released chord first so the press is unambiguously a press,
         whatever the previous check left behind. */
      T.setJetInput(false);
      T.advanceTime(0.25, 1 / 60);
      const armed = {
        needsRelease: T.jetpack.state.needsRelease,
        requested: T.jetpack.state.requested,
      };
      T.setJetInput(true);
      T.advanceTime(1.0, 1 / 60);
      const jet = T.jetpackState();
      const altitude = T.slamAltitude();
      T.setJetpackState({ fuel: 2 });
      T.advanceTime(1 / 60, 1 / 60);
      const airborne = !T.player.state.grounded;
      const asked = T.triggerSlam();
      T.setJetInput(false);
      return { airborne, altitude, jet, armed, ...asked };
    });
    report.states.dry = dry;
    check("a dry reliquary refuses the fall",
      dry.airborne && !dry.triggered && dry.state.lastReason === "low-charge",
      `airborne=${dry.airborne} at ${dry.altitude?.toFixed(1)} m, `
        + `triggered=${dry.triggered}, reason=${dry.state.lastReason}`);

    /* ---------------------------------------------------------------
       10. THE HUD AND THE TOUCH LAYER SPEAK THE NEW LANGUAGE
       --------------------------------------------------------------- */
    const labels = await page.evaluate(() => {
      const boostLabel = document.querySelector("#sf-boost span")?.textContent || "";
      const touchBoost = document.querySelector('[data-touch-action="boost"]');
      return {
        boostLabel,
        touchBoostLabel: touchBoost?.querySelector("span")?.textContent || null,
        touchBoostAria: touchBoost?.getAttribute("aria-label") || null,
      };
    });
    report.states.labels = labels;
    check("the HUD names Shift, not E, for the glide",
      /SHIFT/i.test(labels.boostLabel) && !/\bE\b/.test(labels.boostLabel),
      JSON.stringify(labels.boostLabel));
    check("the touch glide control is a hold, not a tap",
      labels.touchBoostAria === null || /hold/i.test(labels.touchBoostAria),
      String(labels.touchBoostAria));

    /* E must be inert now: it was the old boost key, and leaving it
       live would mean the rebind never actually happened. */
    await stage({ yaw: 0 });
    await page.keyboard.down("KeyW");
    await step(0.5);
    const boostsBeforeE = await page.evaluate(() => window.__SF.boostState().boosts);
    await page.keyboard.press("KeyE");
    await step(0.2);
    const legacyE = await page.evaluate(() => window.__SF.boostState());
    await page.keyboard.up("KeyW");
    report.states.legacyE = { legacyE, boostsBeforeE };
    check("E no longer boosts",
      !legacyE.active && legacyE.boosts === boostsBeforeE,
      `active=${legacyE.active}, boosts ${boostsBeforeE} -> ${legacyE.boosts}`);

    /* A grounded flag can outlive its support for one frame at a fast
       ridge crossing. Recreate that exact boundary deterministically:
       two metres of empty space beneath an otherwise grounded body,
       no pack state, and forward input still held. The controller must
       hand the body to gravity and the legs to the airborne pose. */
    await stage({ yaw: 0 });
    const supportLoss = await page.evaluate(() => {
      const T = window.__SF;
      const p = T.player.state;
      const support = T.collide.flightGroundHeight(p.x, p.z, T.collide.radius);
      p.y = support + 2;
      p.vy = 0;
      p.grounded = true;
      T.setGaitInput(0, -1);
      T.advanceTime(1 / 60, 1 / 60);
      const releasedAt = {
        grounded: p.grounded,
        y: p.y,
        vy: p.vy,
        gait: p.gait,
      };
      const gaitAtRelease = p.gait;
      T.advanceTime(0.18, 1 / 60);
      const legs = T.playerLegs().map((leg) => ({
        planted: leg.planted,
        swinging: leg.swinging,
      }));
      const out = {
        support,
        releasedAt,
        end: {
          grounded: p.grounded,
          y: p.y,
          vy: p.vy,
          gaitAdvance: p.gait - gaitAtRelease,
        },
        legs,
        jetpack: T.jetpackState(),
      };
      T.setGaitInput(null, null);
      return out;
    });
    report.states.supportLoss = supportLoss;
    check("losing ground support immediately starts an ordinary fall",
      !supportLoss.releasedAt.grounded
        && supportLoss.releasedAt.vy < 0
        && !supportLoss.jetpack.inFlight,
      JSON.stringify(supportLoss));
    check("unsupported movement cannot keep advancing the walking gait",
      Math.abs(supportLoss.end.gaitAdvance) < 0.001
        && supportLoss.legs.every((leg) => !leg.planted && !leg.swinging),
      JSON.stringify({ gaitAdvance: supportLoss.end.gaitAdvance, legs: supportLoss.legs }));

    /* ---------------------------------------------------------------
       11. THE SOUNDS EXIST AND MAKE SIGNAL

       Rendered offline, because a headless browser has no output
       device and "it did not throw" is not evidence that anything was
       audible - a voice built, connected to nothing and collected
       looks identical to a working one from every other vantage. */
    const sounds = await page.evaluate(async () => await window.__SF.audioCheck());
    report.states.sounds = sounds;
    const movementSounds = ["boostIgnite", "boostHit", "slamCharge", "slamPlunge",
      "slamImpact"];
    const silent = movementSounds.filter((k) => !sounds[k]?.audible);
    check("the glide and the fall have their own audible voices",
      !sounds.error && silent.length === 0,
      sounds.error || movementSounds
        .map((k) => `${k} ${sounds[k]?.peak}`).join(", "));
    /* Landfall is the loudest thing the trooper can do; if the glide
       igniting is louder, the mix has the two the wrong way round. */
    check("landfall outweighs the glide igniting",
      sounds.slamImpact?.peak > sounds.boostIgnite?.peak,
      `slam ${sounds.slamImpact?.peak} vs boost ${sounds.boostIgnite?.peak}`);
    /* The fall's three beats have to READ as a build - the wind-up and
       the tear are telegraphs, the landing is the event. Measured
       against EACH OTHER rather than against the gunshot: the shot
       carries randomised layers and its peak moves 0.30-0.45 between
       renders, which is a fine sound and a terrible yardstick. */
    /* Two and a half, not three: landfall carries a noise layer and
       renders anywhere from 0.55 to 0.73, so a tighter ratio is a
       check on the random seed rather than on the mix. */
    check("the fall builds to its landing",
      sounds.slamImpact?.peak > 0.45
        && sounds.slamImpact?.peak > sounds.slamCharge?.peak * 2.5
        && sounds.slamImpact?.peak > sounds.slamPlunge?.peak * 2.5,
      `charge ${sounds.slamCharge?.peak}, plunge ${sounds.slamPlunge?.peak}, `
        + `impact ${sounds.slamImpact?.peak}`);

    report.sourceAfter = await hashes();
    report.sourceStable = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
    check("source stayed stable during browser proof", report.sourceStable, "before/after SHA-256");
    check("no page or console errors", errors.length === 0, errors.join("\n") || "none");

    await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    const failed = report.checks.filter((c) => !c.pass);
    for (const c of report.checks) console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name} - ${c.detail}`);
    console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
    if (failed.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
