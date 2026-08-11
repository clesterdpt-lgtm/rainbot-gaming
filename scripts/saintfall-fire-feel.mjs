#!/usr/bin/env node
/* ============================================================
   SAINTFALL - weapon impact proof

   Reported from play: the gun feels weak, the impacts on the target
   are tiny, and the shots are invisible between the muzzle and
   whatever they hit.

   The last of those is a fact about the design rather than a bug in
   it - fire is hitscan, so there was never anything in flight to see.
   This measures the four things that were added to put the shot back
   on screen, and photographs the first frames after the trigger so
   the bolt can be seen travelling:

     BOLT    - the tracer exists, starts at the muzzle, and stops at
               the range the ray actually reached.
     FLASH   - the reliquary lamp spikes on the shot and is back to
               its resting output well before the next one.
     PUNCH   - the camera takes a shove, and it decays.
     AIM     - and, most importantly, NONE of that moves the aim. The
               shake is confined to roll, position and field of view;
               if it ever leaks into yaw or pitch the player's own
               shots walk off target. This gate is the reason those
               degrees of freedom were chosen.

   Usage: node scripts/saintfall-fire-feel.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, "output/saintfall/fire-feel");
const PORT = 43700 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

const TILE_W = 420;
const TILE_H = 300;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

function tag(width, text) {
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(`<svg width="${width}" height="22">`
    + `<rect width="${width}" height="22" fill="#12100c"/>`
    + `<text x="6" y="16" font-family="monospace" font-size="13" fill="#f4d9a0">${safe}</text>`
    + `</svg>`);
}

async function main() {
  const server = startServer();
  let browser = null;
  const fails = [];
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({ viewport: { width: 1120, height: 800 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    await mkdir(out, { recursive: true });

    /* --- measurement --- */
    const probe = await page.evaluate(() => {
      const T = window.__SF;
      T.maximize();
      T.hideHud(true);
      T.setTime("golden");
      T.clearEnemies();
      T.releaseCamera();
      T.autoStow(false);
      T.weapons.setMode("ranged");
      T.setGaitInput(0, 0);
      // Where the drop put the trooper, before any of this disturbs
      // it. The frame pass below returns here to shoot.
      const home = { x: T.playerState().x, z: T.playerState().z };

      /* DOES THE BOLT SPAN WHAT THE RAY SPANNED?

         Answered against two aims where the answer is unambiguous and
         does not depend on where the trooper happens to be standing:
         straight up, where nothing stops the shot and the bolt should
         run the weapon's full range, and steeply down, where the
         ground stops it a few metres out and the bolt should stop
         with it.

         Three earlier attempts tried to gate this by shooting at a
         creature across the map, and each one measured a perfectly
         correct tracer and called it broken - once because the target
         was spawned behind the trooper, twice because the ground rose
         a foot in front of the muzzle. The failure was always in the
         firing line, never in the bolt. These two aims have no firing
         line to get wrong. */
      const boltCases = [];
      let wake = null;
      for (const [name, pitch, expectClear] of [
        ["up, at open sky", -0.70, true],
        ["down, at the ground", 1.10, false],
      ]) {
        T.setCam(0, pitch);
        /* AIMED, so the shot leaves along the camera ray rather than
           somewhere inside the hip-fire cone. The bolt is being
           compared against a ray measured a frame earlier, and a
           couple of degrees of spread against a dune wall 150m away
           moves where that ray ends by several metres - which reads
           as the tracer being wrong when it is the aim that moved. */
        T.setAds(1);
        for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
        const clear = T.aimClearance(320).clearM;
        T.setFiring(true);
        T.fireWeapon(1);
        const b = T.lastTracer();
        /* THE WAKE, read at the one aim with a proven 320m of clear
           air. The embers behind a bolt are given births in the
           FUTURE so each lights as the slug reaches it - dumped at the
           muzzle in one frame they look identical in any screenshot
           and completely wrong in motion, so this is checked rather
           than photographed. Read anywhere else and it measures a
           shot into the dirt: an earlier version took it wherever the
           burst had left the trooper and got 0.35m of range. */
        if (expectClear) wake = T.impactPool();
        T.setFiring(false);
        for (let i = 0; i < 40; i += 1) T.renderOnce(1 / 60);
        T.setAds(0);
        boltCases.push({ name, clear, span: b ? b.span : null, expectClear });
      }

      T.setCam(0, -0.05);
      for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
      const ps = T.playerState();
      const restLamp = T.muzzleLamp();

      const aimBefore = { yaw: ps.aimViewYaw, pitch: ps.aimViewPitch };
      T.setFiring(true);

      /* PEAK, sampled frame by frame. Reading the lamp after
         `fireWeapon` returns reports whatever is left 50ms later,
         which for a 60ms flash is nothing - the first version of this
         gate called a working flash broken on that alone. */
      let peakLamp = 0;
      let peakPunch = 0;
      let maxYawDrift = 0;
      let maxPitchDrift = 0;
      for (let shot = 0; shot < 41; shot += 1) {
        T.fireWeapon(1);
        for (let k = 0; k < 3; k += 1) {
          T.renderOnce(1 / 60);
          const l = T.muzzleLamp();
          if (l && l.intensity > peakLamp) peakLamp = l.intensity;
          if (ps.punch > peakPunch) peakPunch = ps.punch;
          maxYawDrift = Math.max(maxYawDrift,
            Math.abs(Math.atan2(Math.sin(ps.aimViewYaw - aimBefore.yaw),
              Math.cos(ps.aimViewYaw - aimBefore.yaw))));
          maxPitchDrift = Math.max(maxPitchDrift,
            Math.abs(ps.aimViewPitch - aimBefore.pitch));
        }
      }
      const bolt = T.lastTracer();
      T.setFiring(false);

      // And that everything settles back on its own.
      for (let i = 0; i < 150; i += 1) T.renderOnce(1 / 60);
      const settled = { punch: ps.punch, lamp: T.muzzleLamp() };

      return {
        restLamp, peakLamp, peakPunch, settled, bolt, boltCases, home, wake,
        maxYawDriftDeg: maxYawDrift * 180 / Math.PI,
        maxPitchDriftDeg: maxPitchDrift * 180 / Math.PI,
      };
    });

    /* --- the shot, frame by frame ---

       Shot down the CLEAREST bearing available, found by measurement:
       a bolt fired into a dune ten metres away is a correct bolt and
       a useless photograph. Two rows, because the two halves of the
       complaint live at different distances and different zooms - the
       flash and the shove are on the trooper, the bolt and the impact
       are downrange. */
    const bearing = await page.evaluate((home) => {
      const T = window.__SF;
      T.clearEnemies();
      T.releaseCamera();
      T.weapons.setMode("ranged");
      /* Back to the drop, and levelled off. Forty-one shots and a
         volley into the dirt leave the trooper somewhere the muzzle
         is against the ground - the first run of this found 0.35m of
         clearance on all 24 bearings and photographed six frames of
         sand. */
      T.teleport(home.x, home.z, Math.PI);
      for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
      let bestYaw = 0;
      let bestClear = -1;
      for (let i = 0; i < 24; i += 1) {
        const yaw = (i / 24) * Math.PI * 2;
        T.setCam(yaw, -0.02);
        for (let k = 0; k < 8; k += 1) T.renderOnce(1 / 60);
        const c = T.aimClearance(320).clearM;
        if (c > bestClear) { bestClear = c; bestYaw = yaw; }
      }
      return { bestYaw, bestClear };
    }, probe.home);

    const frames = [];
    const frameTraces = [];
    let aimError = null;
    let landedOnTarget = null;
    for (const [label, waits, dist, burst, target, pitch] of [
      ["muzzle, +16ms", 1, 2.4, 1, false, -0.02],
      ["muzzle, +50ms", 3, 2.4, 1, false, -0.02],
      /* A LADDER, not one guess. Shooting away from a chase camera is
         the worst case for seeing a projectile - it is foreshortened
         and the trooper occludes the first few metres - so where the
         slug becomes legible has to be looked at rather than assumed.
         At 150m/s these put it 10m and 20m out. */
      ["one bolt, +66ms (10m)", 4, 5.2, 1, false, -0.02],
      ["one bolt, +133ms (20m)", 8, 5.2, 1, false, -0.02],
      /* Into open sky, where the wake has to carry the shot on its
         own: nothing else in frame says how far or how fast it went. */
      ["into the sky, +200ms", 12, 5.2, 1, false, -0.62],
      ["sustained, into the sky", 10, 5.2, 4, false, -0.62],
    ]) {
      const shot = await page.evaluate(([n, yaw, d, shots, home, wantTarget, pitchRad]) => {
        const T = window.__SF;
        T.clearEnemies();
        T.releaseCamera();
        T.weapons.setMode("ranged");
        // Reloaded between tiles. The measurement pass above spends 43
        // of a 45-round magazine, so without this the later tiles are
        // photographs of a weapon in the middle of a 2.35s reload -
        // which is exactly what the impact tile turned out to be.
        T.weapons.resupply();
        T.teleport(home.x, home.z, Math.PI);
        T.setCam(yaw, pitchRad, d);
        for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);

        let err = null;
        let hitsBefore = null;
        if (wantTarget) {
          /* Spawned out and allowed to CLOSE, rather than aimed at
             where it was standing. A Thresher charges: an earlier
             version lined the reticle up on it to within 0.00deg,
             spent 1.2s converging, and put all three rounds through
             the patch of sand it had left. Letting it come inside ten
             metres makes the aim robust to its own movement, and
             fills the frame with the thing the impact is on. */
          const ps = T.playerState();
          T.spawnEnemy("thresher", ps.x + Math.sin(yaw) * 22, ps.z + Math.cos(yaw) * 22);
          for (let i = 0; i < 170; i += 1) T.renderOnce(1 / 60);
          const live = T.enemyList()[0];
          if (live) err = T.aimAt(live.x, live.y + 0.75, live.z, 2).errorDeg;
          hitsBefore = T.combatStats ? T.combatStats().hits : null;
        }

        T.setFiring(true);
        /* `pullTrigger`, not `fireWeapon`: the latter spends 50ms of
           simulation per round, so a sheet built on it cannot show a
           60ms muzzle flash at all - an earlier version labelled its
           tiles +0ms and was photographing +50ms. Spaced a frame apart
           so a burst shows several bolts at different distances, which
           is what sustained fire looks like and one bolt never can. */
        /* Spaced past the weapon's own 9/s cooldown. One frame apart
           looks like a burst in the code and fires exactly one round;
           the rest are swallowed by `carry.cooldown` and the "burst"
           tiles were single shots. */
        for (let s = 0; s < shots; s += 1) {
          T.pullTrigger();
          if (s < shots - 1) for (let k = 0; k < 7; k += 1) T.renderOnce(1 / 60);
        }
        for (let i = 0; i < n; i += 1) T.renderOnce(1 / 60);
        T.setFiring(false);
        T.renderStill();
        return {
          url: T.captureDataURL(),
          err,
          landed: hitsBefore === null ? null
            : (T.combatStats ? T.combatStats().hits : 0) - hitsBefore,
          tracer: T.lastTracer(),
        };
      }, [waits, bearing.bestYaw, dist, burst, probe.home, target, pitch]);
      if (shot.err !== null) aimError = shot.err;
      if (shot.landed !== null && shot.landed !== undefined) landedOnTarget = shot.landed;
      const url = shot.url;
      frameTraces.push({ label, tracer: shot.tracer });
      const buffer = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      frames.push(await sharp(buffer).resize(TILE_W, TILE_H, { fit: "cover" })
        .composite([{ input: tag(TILE_W, label), left: 0, top: 0 }]).png().toBuffer());
    }

    /* The chase camera is the adversarial gameplay view: the bolt flies
       away from it and the trooper can occult the head. One profile tile
       keeps the same real trigger, ray and projectile, then moves only
       the QA camera so the head-versus-wake design can actually be judged. */
    const profile = await page.evaluate(([home, yaw]) => {
      const T = window.__SF;
      T.clearEnemies();
      T.releaseCamera();
      T.weapons.setMode("ranged");
      T.weapons.resupply();
      T.teleport(home.x, home.z, Math.PI);
      T.setCam(yaw, -0.02, 5.2);
      T.setAds(1);
      for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
      T.setFiring(true);
      T.pullTrigger();
      T.setFiring(false);
      const launched = T.lastTracer();
      const start = launched.start;
      const dir = launched.dir;
      const sideLen = Math.hypot(dir[0], dir[2]) || 1;
      const side = [-dir[2] / sideLen, 0, dir[0] / sideLen];
      const target = [
        start[0] + dir[0] * 10,
        start[1] + dir[1] * 10,
        start[2] + dir[2] * 10,
      ];
      T.lookAt([
        target[0] + side[0] * 8,
        target[1] + 2.6,
        target[2] + side[2] * 8,
      ], target, 44);
      for (let i = 0; i < 2; i += 1) T.renderOnce(1 / 60);
      T.renderStill();
      return { url: T.captureDataURL(), tracer: T.lastTracer() };
    }, [probe.home, bearing.bestYaw]);
    const profileBuffer = Buffer.from(
      profile.url.slice(profile.url.indexOf(",") + 1), "base64"
    );
    const profileProof = await sharp(profileBuffer)
      .resize(840, 600, { fit: "cover" })
      .composite([{
        input: tag(840, "real trigger · profile · energy head + ion wake"),
        left: 0,
        top: 0,
      }])
      .png().toBuffer();
    await writeFile(path.join(out, "energy-bolt-profile.png"), profileProof);
    frames.push(await sharp(profileBuffer).resize(TILE_W, TILE_H, { fit: "cover" })
      .composite([{ input: tag(TILE_W, "profile, energy head + wake"), left: 0, top: 0 }])
      .png().toBuffer());
    frameTraces.push({ label: "profile, energy head + wake", tracer: profile.tracer });
    console.log(`frames shot down bearing `
      + `${(bearing.bestYaw * 180 / Math.PI).toFixed(0)}deg, clear to `
      + `${bearing.bestClear.toFixed(1)}m`
      + (aimError === null ? "" : `; aimed at the Thresher to within ${aimError.toFixed(2)}deg`)
      + (landedOnTarget === null ? "" : `, ${landedOnTarget} of 3 rounds on it`));
    for (const frame of frameTraces) {
      const t = frame.tracer;
      console.log(`  ${frame.label.padEnd(28)} head `
        + `${t ? `${t.headDistance.toFixed(1)}m along the ray` : "missing"}`);
    }
    if (landedOnTarget !== null && landedOnTarget < 1) {
      fails.push("the impact frame missed the target, so it shows no impact");
    }
    if (bearing.bestClear < 25) {
      fails.push(`the frame pass had no firing line: clearest bearing reached `
        + `${bearing.bestClear.toFixed(1)}m, so the frames show nothing in flight`);
    }
    const rows = Math.ceil(frames.length / 3);
    const sheetBuf = await sharp({
      create: {
        width: 3 * TILE_W, height: rows * TILE_H,
        channels: 3, background: { r: 18, g: 16, b: 12 },
      },
    }).composite(frames.map((input, i) => ({
      input, left: (i % 3) * TILE_W, top: Math.floor(i / 3) * TILE_H,
    }))).png().toBuffer();
    await writeFile(path.join(out, "shot-frames.png"), sheetBuf);

    /* --- verdict --- */
    const p = probe;
    console.log("\nSAINTFALL weapon impact\n" + "=".repeat(64));
    for (const c of p.boltCases) {
      console.log(`bolt ${c.name.padEnd(22)} ray ${c.clear.toFixed(1)}m `
        + `-> bolt ${c.span === null ? "none" : `${c.span.toFixed(1)}m`}`);
      if (c.span === null) { fails.push(`no tracer launched aiming ${c.name}`); continue; }
      /* Proportional: the claim is that the bolt spans what the ray
         spanned, and a fixed 1.5m of it is a different claim at 1m
         than at 300m. */
      const tol = Math.max(1.5, c.clear * 0.05);
      if (Math.abs(c.span - c.clear) > tol) {
        fails.push(`aiming ${c.name}: the bolt is ${c.span.toFixed(1)}m `
          + `but the shot ray reached ${c.clear.toFixed(1)}m`);
      }
    }
    // The two cases have to actually BE different, or a tracer stuck
    // at one length would satisfy both.
    if (p.boltCases[0].span !== null && p.boltCases[1].span !== null
      && p.boltCases[0].span - p.boltCases[1].span < 40) {
      fails.push("the sky and ground bolts are the same length - the span is not tracking the ray");
    }
    if (p.bolt) {
      console.log(`      width ${p.bolt.width.toFixed(3)}m  `
        + `dir length ${Math.hypot(...p.bolt.dir).toFixed(4)}  ${p.bolt.live} live slots  `
        + `energy style ${p.bolt.style.toFixed(0)}  head ${p.bolt.head ? "pooled" : "missing"}`);
      if (Math.abs(Math.hypot(...p.bolt.dir) - 1) > 1e-3) {
        fails.push("the bolt direction is not normalised");
      }
      if (!(p.bolt.style > 0.5)) fails.push("the player bolt did not receive the energy style");
      if (!p.bolt.head) fails.push("the player bolt has no pooled head mesh");
      if (!(p.bolt.width >= 0.40)) {
        fails.push(`the player energy head is too small: ${p.bolt.width.toFixed(3)}m base width`);
      }
    } else {
      fails.push("no tracer was launched");
    }
    console.log(`lamp: rest ${p.restLamp.intensity.toFixed(2)} `
      + `-> peak ${p.peakLamp.toFixed(2)} on the shot `
      + `-> ${p.settled.lamp.intensity.toFixed(2)} at rest`);
    console.log(`wake: ${p.wake.scheduled} embers still to light, `
      + `${p.wake.lit} alight, ${p.wake.energy} energy-styled, `
      + `furthest ${p.wake.furthestAheadS}s ahead of the shot`);
    console.log(`camera punch: peak ${p.peakPunch.toFixed(3)}`
      + `, ${p.settled.punch.toFixed(4)} after`);
    console.log(`aim drift over a 41-shot burst: `
      + `${p.maxYawDriftDeg.toFixed(4)}deg yaw / ${p.maxPitchDriftDeg.toFixed(4)}deg pitch`);
    console.log("=".repeat(64));

    if (!(p.peakLamp > p.restLamp.intensity * 4)) {
      fails.push(`muzzle flash barely lights: peak ${p.peakLamp} vs rest ${p.restLamp.intensity}`);
    }
    if (Math.abs(p.settled.lamp.intensity - p.restLamp.intensity) > 1e-3) {
      fails.push(`the lamp never came back down: ${p.settled.lamp.intensity}`);
    }
    if (!(p.wake.scheduled >= 3)) {
      fails.push(`the bolt laid its whole wake at the muzzle: `
        + `${p.wake.scheduled} embers scheduled ahead of it`);
    }
    if (!(p.wake.energy >= 3)) {
      fails.push(`the player's wake did not receive the energy style: ${p.wake.energy} ions`);
    }
    if (!(p.wake.furthestAheadS > 0.2)) {
      fails.push(`the wake does not reach downrange: furthest ember `
        + `${p.wake.furthestAheadS}s ahead`);
    }
    if (!(p.peakPunch > 0.2)) fails.push(`camera punch too small: ${p.peakPunch}`);
    if (!(p.settled.punch < 0.01)) fails.push(`camera punch never settled: ${p.settled.punch}`);
    /* The one that matters. Shots leave along the camera ray, so any
       shake that reaches yaw or pitch is the gun steering itself. */
    if (p.maxYawDriftDeg > 0.01 || p.maxPitchDriftDeg > 0.01) {
      fails.push(`the shake is moving the aim: ${p.maxYawDriftDeg.toFixed(4)}deg yaw / `
        + `${p.maxPitchDriftDeg.toFixed(4)}deg pitch`);
    }
    if (errors.length) fails.push(`${errors.length} page errors: ${errors[0]}`);

    if (fails.length) {
      console.log("FAIL");
      for (const f of fails) console.log(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("the shot reads at both ends, and does not steer");
    }
    console.log(path.relative(root, path.join(out, "shot-frames.png")));
    console.log(path.relative(root, path.join(out, "energy-bolt-profile.png")));
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
