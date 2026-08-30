#!/usr/bin/env node
/* THE HAMMER CAST: where it goes, and what it snaps onto.

   Two reports from play drove this. The cast would not throw upward
   at all - which turned out to be one missing line, `ctx.render` never
   published on the campaign, so `summit-loadout.aimPoint()` found no
   camera and every throw fell back to a hard-coded HORIZONTAL vector.
   Measured before the fix: 0.0 degrees of climb at every camera angle
   including a full 60-degree look up. And a fast flyer at thirty
   metres against open sky is close to unhittable with a chase camera
   and a thrown weapon, so the cast now snaps onto one inside a cone.

   Both are checked on BOTH pages, because the first bug existed on
   exactly one of them and looked identical to a design decision. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 47700 + (process.pid % 700);
const base = `http://127.0.0.1:${port}`;

const PAGES = [
  ["summit", `games/saintfall-white-vigil.html?qa=1&quality=low&character=bastion-penitent&time=noon`],
  ["campaign", `games/saintfall.html?qa=1&intro=0&quality=low&character=bastion-penitent`],
];
/* Camera pitches, negative is looking UP. -1.05 is the rig's own limit
   (`player.js`: clamp(camPitch, -1.05, 1.15)). */
const PITCHES = [0.0, -0.35, -0.65, -1.05];

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}
async function waitServer() {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};

async function run(browser, label, rel) {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
  await page.goto(`${base}/${rel}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const data = await page.evaluate(async ({ pitches }) => {
    const T = window.__SF;
    const THREE = T.THREE;
    T.invulnerable?.(true);
    T.clearEnemies?.();
    T.advanceTime(1.0, 1 / 60);
    const P = T.player;

    const cast = () => {
      T.kenosis.reset();
      T.advanceTime(0.3, 1 / 60);
      const ok = T.kenosis.tryThrowHammer();
      T.advanceTime(0.6, 1 / 60);   // past the release frame
      return ok;
    };
    const flightAngle = () => {
      const a = T.kenosis.status().hammer.position;
      T.advanceTime(0.25, 1 / 60);
      const b = T.kenosis.status().hammer.position;
      if (!a || !b) return null;
      const dh = Math.hypot(b[0] - a[0], b[2] - a[2]);
      return { deg: Math.atan2(b[1] - a[1], dh) * 180 / Math.PI, dh };
    };

    /* ---- 1. does it go where you look? ---- */
    const climb = [];
    for (const pitch of pitches) {
      T.setCam(P.state.yaw, pitch, 6);
      T.advanceTime(0.4, 1 / 60);
      const cam = T.render.camera;
      const cd = new THREE.Vector3();
      cam.getWorldDirection(cd);
      const camDeg = Math.atan2(cd.y, Math.hypot(cd.x, cd.z)) * 180 / Math.PI;
      cast();
      const f = flightAngle();
      climb.push({
        camDeg: Number(camDeg.toFixed(1)),
        throwDeg: f ? Number(f.deg.toFixed(1)) : null,
      });
      T.advanceTime(3.0, 1 / 60);
    }

    /* ---- 2. the flyer assist ---- */
    const assistOf = (place, aimAt) => {
      T.kenosis.reset();
      T.clearEnemies();
      const ps = P.state;
      T.setCam(ps.yaw, 0, 6);
      T.advanceTime(0.3, 1 / 60);
      const inst = place(ps);
      T.advanceTime(0.4, 1 / 60);   // let the tracker see it
      if (aimAt) T.setCam(ps.yaw, aimAt, 6);
      T.advanceTime(0.3, 1 / 60);
      const before = inst ? inst.health : 0;
      T.kenosis.tryThrowHammer();
      T.advanceTime(0.6, 1 / 60);
      const snapped = T.kenosis.status().hammer.assisted;
      /* If the snap did not happen, say WHY in the same terms the
         assist itself uses - angle off the reticle, range, and
         whether the line was called blocked. */
      let why = null;
      if (!snapped && inst) {
        const cam = T.render.camera;
        const cd = new THREE.Vector3(); cam.getWorldDirection(cd);
        const hp = T.kenosis.status().hammer.position
          || [ps.x, ps.y + 1.4, ps.z];
        const dx = inst.x - hp[0], dy = inst.y - hp[1], dz = inst.z - hp[2];
        const dist = Math.hypot(dx, dy, dz);
        const wall = T.collide?.rayBlock?.(hp[0], hp[1], hp[2],
          dx / dist, dy / dist, dz / dist, dist);
        why = {
          dist: +dist.toFixed(1),
          angDeg: +(Math.acos(Math.max(-1, Math.min(1,
            (dx * cd.x + dy * cd.y + dz * cd.z) / dist))) * 180 / Math.PI).toFixed(1),
          coneDeg: +(T.kenosis.status().hammer.assistCone * 180 / Math.PI).toFixed(1),
          wall: Number.isFinite(wall) ? +wall.toFixed(1) : "clear",
          flies: !!inst.spec?.flies, grounded: !!inst.grounded,
          tracked: T.kenosis.status().hammer.tracking,
        };
      }
      T.advanceTime(2.6, 1 / 60);
      const live = T.enemies.live.find((e) => e === inst) || null;
      const out = { snapped, took: before - (live ? live.health : before), why };
      T.clearEnemies();
      T.kenosis.reset();
      T.advanceTime(0.4, 1 / 60);
      return out;
    };

    /* THE SUBJECT IS FOUND BY POSITION, NOT BY INDEX. The campaign is
       a populated world and `clearEnemies()` does not stop its
       garrisons coming back, so `live[0]` picked a body 684 metres
       away and the probe measured that instead. */
    const placeAt = (ps, lift) => {
      const x = ps.x + Math.sin(ps.camYaw) * 24 + Math.cos(ps.camYaw) * 7;
      const z = ps.z + Math.cos(ps.camYaw) * 24 - Math.sin(ps.camYaw) * 7;
      T.spawnEnemy("thresher", x, z, {});
      let inst = null;
      let best = 6;
      for (const e of T.enemies.live) {
        const d = Math.hypot(e.x - x, e.z - z);
        if (d < best) { best = d; inst = e; }
      }
      if (inst && lift > 0) {
        inst.spec = { ...inst.spec, flies: true };
        inst.grounded = false;
        inst.y += lift;
      }
      if (inst) { inst.health = 4000; inst.stunTime = 999; }
      return inst;
    };

    /* A flyer up and to the side - well off the reticle axis, the
       shot a player cannot reasonably make by hand. */
    const flyerOff = assistOf((ps) => placeAt(ps, 9), 0);

    /* The same body on the GROUND at the same offset: the assist is
       flyers-only, so this one must NOT be snapped onto. */
    const groundOff = assistOf((ps) => placeAt(ps, 0), 0);

    return { climb, flyerOff, groundOff, tracking: T.kenosis.status().hammer.tracking };
  }, { pitches: PITCHES });

  await context.close();
  return { data, errors };
}

async function main() {
  const child = server();
  let browser;
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const [label, rel] of PAGES) {
      const { data, errors } = await run(browser, label, rel);
      console.log(`\n=== ${label} ===`);
      console.log(`  camera->throw: ${data.climb.map((c) => `${c.camDeg}->${c.throwDeg}`).join("  ")}`);
      /* The throw must FOLLOW the look, not merely be non-zero: the
         bug this replaces produced a clean 0.0 at every angle. */
      const tracks = data.climb.every((c) => c.throwDeg !== null
        && Math.abs(c.throwDeg - c.camDeg) < 9);
      check(`${label}: the cast goes where the camera looks`, tracks, data.climb);
      check(`${label}: a full look-up throws steeply upward`,
        data.climb[data.climb.length - 1].throwDeg > 45,
        data.climb[data.climb.length - 1]);
      check(`${label}: an off-axis flyer is snapped onto and hit`,
        data.flyerOff.snapped !== null && data.flyerOff.took > 0, data.flyerOff);
      check(`${label}: a grounded body at the same offset is not`,
        data.groundOff.snapped === null && data.groundOff.took === 0, data.groundOff);
      check(`${label}: zero page errors`, errors.length === 0, errors.slice(0, 2));
    }
  } finally {
    await browser?.close();
    child.kill();
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
