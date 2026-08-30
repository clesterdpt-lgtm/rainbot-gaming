#!/usr/bin/env node
/* ============================================================
   SAINTFALL - airborne sand and ground marks

   Two things, because they are one complaint: what the ground and
   the air do while the trooper is MOVING. Standing still, the dust
   field was always correct; the defect only existed under travel,
   which is why it survived every still review in the project.

   The dust test is not a picture. It tracks individual motes across
   frames by re-deriving their world positions from the same hashes
   the shader uses, and reports how far each one moved per second of
   game time. A mote pinned to the camera moves at the PLAYER's
   speed; a mote in the world moves at the wind's.

   Usage: node scripts/saintfall-ground-fx.mjs [outdir]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.argv[2] || "output/saintfall/ground-fx");
const PORT = 47800 + (process.pid % 1200);
const BASE = `http://127.0.0.1:${PORT}`;

function tag(width, text) {
  const safe = String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return Buffer.from(`<svg width="${width}" height="22" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="22" fill="#0d0b10" fill-opacity="0.86"/>
    <text x="7" y="16" fill="#f4d487" font-family="monospace" font-size="11">${safe}</text>
  </svg>`);
}

async function sheet(tiles, cols, tw, th, file) {
  const rows = Math.ceil(tiles.length / cols);
  const buffer = await sharp({
    create: { width: cols * tw, height: rows * th, channels: 3, background: "#0d0b10" },
  }).composite(tiles.map((input, i) => ({
    input, left: (i % cols) * tw, top: Math.floor(i / cols) * th,
  }))).png().toBuffer();
  await writeFile(file, buffer);
  return file;
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let browser = null;
let failures = 0;
const check = (pass, label, detail = "") => {
  if (!pass) failures += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
};

try {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  await mkdir(out, { recursive: true });

  browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 620 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  /* The sandbox blocks the Three CDN (boot falls through to its
     second base) and the static server carries no favicon, so those
     two are the harness's environment rather than the game's. */
  const environmental = (t) => /Failed to load resource/i.test(t) || /cdn\.jsdelivr/i.test(t);
  page.on("console", (m) => {
    if (m.type() === "error" && !environmental(m.text())) errors.push(m.text());
  });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize(); window.__SF.hideHud(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  /* =====================================================================
     1. DOES THE DUST STAY IN THE WORLD WHILE THE PLAYER MOVES?
     ===================================================================== */
  console.log("\n=== AIRBORNE SAND UNDER TRAVEL ===");
  const drift = await page.evaluate(() => {
    const T = window.__SF;
    T.setTime("goldenhour");
    T.clearEnemies?.();
    /* A MEASURED FLAT SITE, not a coordinate copied from another
       harness. The first version walked from a fixed spawn straight
       into a dune face, the slope gate stopped the trooper dead, and
       every mote/camera comparison was then made at zero speed - a
       reading that passes the "motes are not dragged" test perfectly
       and proves nothing at all. */
    /* SAND, NOT THE ROAD, AND SOMEWHERE THE TROOPER CAN ACTUALLY
       WALK. Two earlier versions of this failed in the two ways this
       project keeps recording: `findFlatSite` is biased toward the
       road corridor and framed the whole sheet on paving, where
       nothing is displaced and no mark is laid; and a hand-rolled
       slope test over a 26m ring picked a spot where the sustained
       grade stopped the trooper dead after 58cm, so every reading was
       taken at zero speed - which passes a "motes are not dragged"
       test perfectly and proves nothing.

       So the acceptance test is WALKING. Sample it. */
    const sandSite = () => {
      let fallback = null;
      let tried = 0;
      for (let i = 0; i < 2000 && tried < 14; i += 1) {
        const a = i * 2.39996323;
        const r = Math.sqrt((i + 0.5) / 2000) * 620;
        const x = Math.cos(a) * r + 180;
        const z = Math.sin(a) * r - 60;
        if (Math.abs(x) > 900 || Math.abs(z) > 900) continue;
        const g = T.ctx.terrain.heightAt(x, z);
        if (Number.isFinite(T.ctx.world.walkSurfaceAt(x, z))) continue;
        let worst = 0;
        for (let k = 0; k < 8; k += 1) {
          const b = (k / 8) * Math.PI * 2;
          worst = Math.max(worst, Math.abs(
            T.ctx.terrain.heightAt(x + Math.cos(b) * 12, z + Math.sin(b) * 12) - g));
        }
        if (worst > 1.6) continue;
        tried += 1;
        if (!fallback) fallback = [x, z];
        T.teleport(x, z, 0);
        T.setGaitInput(0, -1);
        const fx = T.ctx.player.state.x;
        const fz = T.ctx.player.state.z;
        for (let k = 0; k < 260; k += 1) T.renderOnce(1 / 60);
        const moved = Math.hypot(T.ctx.player.state.x - fx, T.ctx.player.state.z - fz);
        T.setGaitInput(0, 0);
        // Far enough to cover the settle AND the sample window.
        if (moved > 26) return [x, z];
      }
      return fallback || [180, -60];
    };
    const site = sandSite();
    T.teleport(site[0], site[1], 0);
    for (let i = 0; i < 40; i += 1) T.renderOnce(1 / 60);

    let dust = null;
    T.ctx.scene.traverse((o) => { if (o.name === "dust") dust = o; });
    const u = dust.material.uniforms;

    /* The shader's own arithmetic, in JS. Reading pixels cannot tell
       a mote that moved from a different mote drawn in the same
       place; re-deriving the position for a known aSeed can. */
    const h11 = (p) => {
      const s = Math.sin(p * 127.1) * 43758.5453;
      return s - Math.floor(s);
    };
    const motePos = (seed) => {
      const time = u.uTime.value;
      const w = u.uWind.value;
      const wl = Math.hypot(w.x, w.y) || 1;
      const wx = w.x / wl;
      const wz = w.y / wl;
      const box = u.uBox.value;
      const a = u.uAnchor.value;
      const life = (4 + h11(seed + 1.7) * 8) * u.uLifeScale.value;
      const t = (time / life + h11(seed + 4.4)) % 1;
      let px = (h11(seed) * 2 - 1) * box.x;
      let pz = (h11(seed + 5.9) * 2 - 1) * box.z;
      px += wx * t * life * u.uDrift.value;
      pz += wz * t * life * u.uDrift.value;
      px += Math.sin(time * 0.7 + seed * 4.0) * 0.9;
      pz += Math.cos(time * 0.62 + seed * 6.0) * 0.9;
      const spanX = box.x * 2;
      const spanZ = box.z * 2;
      const relX = px - a.x;
      const relZ = pz - a.z;
      const fx = (((relX + box.x) % spanX) + spanX) % spanX - box.x;
      const fz = (((relZ + box.z) % spanZ) + spanZ) % spanZ - box.z;
      return { x: px + (fx - relX), z: pz + (fz - relZ), t };
    };

    /* The SAME mote under the old arithmetic, so one run reports the
       defect and the fix side by side. Anchor-relative origin, and
       the anchor snapped to 8m - which is what made the field both
       ride with the player and teleport every eight metres. */
    const oldMotePos = (seed) => {
      const time = u.uTime.value;
      const w = u.uWind.value;
      const wl = Math.hypot(w.x, w.y) || 1;
      const box = u.uBox.value;
      const a = u.uAnchor.value;
      const ax = Math.round(a.x / 8) * 8;
      const az = Math.round(a.z / 8) * 8;
      const life = (4 + h11(seed + 1.7) * 8) * u.uLifeScale.value;
      const t = (time / life + h11(seed + 4.4)) % 1;
      let px = ax + (h11(seed) * 2 - 1) * box.x;
      let pz = az + (h11(seed + 5.9) * 2 - 1) * box.z;
      px += (w.x / wl) * t * life * u.uDrift.value;
      pz += (w.y / wl) * t * life * u.uDrift.value;
      px += Math.sin(time * 0.7 + seed * 4.0) * 0.9;
      pz += Math.cos(time * 0.62 + seed * 6.0) * 0.9;
      return { x: px, z: pz, t };
    };

    const seeds = [];
    const seedAttr = dust.geometry.attributes.aSeed.array;
    for (let i = 0; i < 24; i += 1) seeds.push(seedAttr[i * 7]);

    function sample() {
      const map = new Map();
      const old = new Map();
      for (const s of seeds) { map.set(s, motePos(s)); old.set(s, oldMotePos(s)); }
      return { motes: map, old, time: u.uTime.value, cam: u.uAnchor.value.clone() };
    }

    // Measure the same window twice: standing, then walking flat out.
    function run(moving) {
      T.teleport(site[0], site[1], 0);
      T.setGaitInput(0, moving ? -1 : 0);
      /* 70 frames, not 30. The trooper accelerates, and sampling
         through the ramp measured a 2.3 m/s camera - slower than the
         wind, which makes the whole comparison meaningless. Not 150
         either: that is 21m of travel before the window even opens,
         far enough to leave the ground the site was chosen for. */
      for (let i = 0; i < 70; i += 1) T.renderOnce(1 / 60);
      const a = sample();
      const p0 = { x: T.ctx.player.state.x, z: T.ctx.player.state.z };
      for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
      const b = sample();
      const p1 = { x: T.ctx.player.state.x, z: T.ctx.player.state.z };
      const dt = b.time - a.time;
      const speeds = [];
      for (const s of seeds) {
        const p = a.motes.get(s);
        const q = b.motes.get(s);
        // A mote that recycled its life is a new mote, not a moved one.
        if (Math.abs(q.t - p.t) > 0.4) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d > 40) continue;            // wrapped a whole box
        speeds.push(d / Math.max(1e-4, dt));
      }
      speeds.sort((m, n) => m - n);
      return {
        moving,
        camSpeed: Math.hypot(b.cam.x - a.cam.x, b.cam.z - a.cam.z) / Math.max(1e-4, dt),
        playerSpeed: Math.hypot(p1.x - p0.x, p1.z - p0.z) / Math.max(1e-4, dt),
        median: speeds[Math.floor(speeds.length / 2)] || 0,
        max: speeds[speeds.length - 1] || 0,
        n: speeds.length,
      };
    }

    /* THE DEFECT IS A JUMP, NOT A DRIFT, and a mean speed cannot see
       it. The old field was measured from an anchor SNAPPED to 8m, so
       between boundaries it held still and every eight metres of
       travel it moved bodily sideways in a single frame. Averaged
       over half a second that comes out at the wind speed, which is
       how a first version of this test reported "no change".
       Sample every frame and take the worst one. */
    function worstStep() {
      T.teleport(site[0], site[1], 0);
      T.setGaitInput(0, -1);
      for (let i = 0; i < 70; i += 1) T.renderOnce(1 / 60);
      let prev = null;
      let now = 0;
      let old = 0;
      for (let i = 0; i < 120; i += 1) {
        T.renderOnce(1 / 60);
        const cur = sample();
        if (prev) {
          for (const sd of seeds) {
            const p = prev.motes.get(sd);
            const q = cur.motes.get(sd);
            if (Math.abs(q.t - p.t) < 0.4) {
              const d = Math.hypot(q.x - p.x, q.z - p.z);
              if (d < 50) now = Math.max(now, d);
            }
            const op = prev.old.get(sd);
            const oq = cur.old.get(sd);
            if (Math.abs(oq.t - op.t) < 0.4) {
              old = Math.max(old, Math.hypot(oq.x - op.x, oq.z - op.z));
            }
          }
        }
        prev = cur;
      }
      T.setGaitInput(0, 0);
      return { now: +now.toFixed(3), old: +old.toFixed(3) };
    }
    const step = worstStep();

    window.__SF_SAND_SITE = site;
    // What the site finder actually chose, and whether the trooper
    // can move once it is standing there.
    T.teleport(site[0], site[1], 0);
    T.setGaitInput(0, -1);
    const probeFrom = { x: T.ctx.player.state.x, z: T.ctx.player.state.z };
    for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
    const probeTo = { x: T.ctx.player.state.x, z: T.ctx.player.state.z };
    T.setGaitInput(0, 0);
    const siteReport = {
      site,
      spawned: [+T.ctx.player.state.x.toFixed(1), +T.ctx.player.state.z.toFixed(1)],
      walked: +Math.hypot(probeTo.x - probeFrom.x, probeTo.z - probeFrom.z).toFixed(2),
      grounded: !!T.ctx.player.state.grounded,
      paving: T.ctx.world.walkSurfaceAt(site[0], site[1]),
    };
    const still = run(false);
    const walking = run(true);
    T.setGaitInput(0, 0);
    return {
      still, walking, siteReport, step,
      drift: u.uDrift.value,
    };
  });

  console.log(`  site ${JSON.stringify(drift.siteReport)}`);
  console.log(`  wind drift setting: ${drift.drift.toFixed(2)} m/s`);
  for (const r of [drift.still, drift.walking]) {
    console.log(`  ${r.moving ? "walking" : "standing"}: player ${r.playerSpeed.toFixed(2)} m/s, `
      + `camera ${r.camSpeed.toFixed(2)} m/s, mote median ${r.median.toFixed(2)} m/s, `
      + `max ${r.max.toFixed(2)} m/s (${r.n} tracked)`);
  }
  check(drift.walking.playerSpeed > 4,
    "the harness actually walked", `${drift.walking.playerSpeed.toFixed(2)} m/s`);
  /* The claim, stated as a number: a mote's speed is the WIND's, and
     it does not care what the player is doing. */
  check(Math.abs(drift.walking.median - drift.still.median) < 0.6,
    "motes drift at the same speed walking as standing",
    `${drift.still.median.toFixed(2)} vs ${drift.walking.median.toFixed(2)} m/s`);
  /* The claim is about the WIND, not about the camera: a mote moves
     at the wind's speed whatever the player is doing. Gating on the
     camera instead would pass trivially any time the harness failed
     to get up to speed - which is exactly what it did first run. */
  check(Math.abs(drift.walking.median - drift.drift) < 0.45,
    "walking motes move at the wind speed",
    `${drift.walking.median.toFixed(2)} vs wind ${drift.drift.toFixed(2)} m/s`);
  /* The mean is the same before and after - the old field held still
     between boundaries and jumped at them - so the mean is exactly
     the statistic that cannot see this defect. */
  console.log(`  worst single-frame mote jump while walking: `
    + `${drift.step.now}m (was ${drift.step.old}m)`);
  check(drift.step.now < 0.25,
    "no mote teleports in a single frame", `worst ${drift.step.now}m`);
  check(drift.step.old > 4,
    "the old arithmetic did teleport them (regression witness)",
    `worst ${drift.step.old}m`);

  /* =====================================================================
     2. GROUND MARKS
     ===================================================================== */
  console.log("\n=== GROUND MARKS ===");
  const marks = await page.evaluate(async () => {
    const T = window.__SF;
    let mesh = null;
    T.ctx.scene.traverse((o) => { if (o.name === "ground-marks") mesh = o; });
    if (!mesh) return { present: false };
    const meta = mesh.geometry.attributes.aMeta.array;
    const pos = mesh.geometry.attributes.position.array;
    const live = () => {
      const now = T.ctx.atmos.elapsed;
      let n = 0;
      for (let i = 0; i < meta.length; i += 12) {
        const age = (now - meta[i]) / Math.max(0.001, meta[i + 1]);
        if (age >= 0 && age <= 1) n += 1;
      }
      return n;
    };

    const site = window.__SF_SAND_SITE;
    T.teleport(site[0], site[1], 0);
    T.setGaitInput(0, 0);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
    const before = live();

    // Walk for four seconds and count the prints laid.
    T.setGaitInput(0, -1);
    for (let i = 0; i < 300; i += 1) T.renderOnce(1 / 60);
    T.setGaitInput(0, 0);
    const walked = live();

    /* Every mark must sit ON the drawn ground, not the authoring
       field - that difference is up to 12cm and is the whole reason
       decals in this project sink. */
    const now = T.ctx.atmos.elapsed;
    let worstBelow = 0;
    let worstAbove = 0;
    let checked = 0;
    for (let s = 0; s < meta.length / 12; s += 1) {
      const m = s * 12;
      const age = (now - meta[m]) / Math.max(0.001, meta[m + 1]);
      if (age < 0 || age > 1) continue;
      for (let v = 0; v < 4; v += 1) {
        const o = s * 12 + v * 3;
        const g = T.ctx.terrain.groundHeightAt(pos[o], pos[o + 2]);
        const gap = pos[o + 1] - g;
        worstBelow = Math.min(worstBelow, gap);
        worstAbove = Math.max(worstAbove, gap);
        checked += 1;
      }
    }

    /* Do the prints alternate about the line of travel, or is the
       trail single file? A print placed off accumulated stride would
       sit under the pelvis and give a spread of zero, so this is the
       assertion that the plant point is the real one. */
    const pts = [];
    for (let k = 0; k < meta.length / 12; k += 1) {
      const m = k * 12;
      const age = (now - meta[m]) / Math.max(0.001, meta[m + 1]);
      if (age < 0 || age > 1) continue;
      let cxx = 0;
      let czz = 0;
      for (let v = 0; v < 4; v += 1) { cxx += pos[m + v * 3] / 4; czz += pos[m + v * 3 + 2] / 4; }
      pts.push([cxx, czz]);
    }
    let spread = 0;
    if (pts.length > 4) {
      const mx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
      const mz = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      // Principal direction of the trail, then the scatter across it.
      let sxx = 0;
      let szz = 0;
      let sxz = 0;
      for (const q of pts) {
        sxx += (q[0] - mx) ** 2; szz += (q[1] - mz) ** 2; sxz += (q[0] - mx) * (q[1] - mz);
      }
      const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      const px2 = -Math.sin(theta);
      const pz2 = Math.cos(theta);
      let acc = 0;
      for (const q of pts) acc += ((q[0] - mx) * px2 + (q[1] - mz) * pz2) ** 2;
      spread = Math.sqrt(acc / pts.length);
    }

    // Then let them expire.
    for (let i = 0; i < 420; i += 1) T.renderOnce(1 / 60);
    const expired = live();

    return {
      present: true,
      capacity: meta.length / 12,
      before,
      walked,
      expired,
      spread: +spread.toFixed(3),
      worstBelow: +worstBelow.toFixed(3),
      worstAbove: +worstAbove.toFixed(3),
      checked,
    };
  });

  console.log(`  pool ${marks.capacity}; live: ${marks.before} idle -> `
    + `${marks.walked} after 4s walking -> ${marks.expired} after 7s more`);
  console.log(`  corner height vs drawn ground: ${marks.worstBelow}m .. `
    + `${marks.worstAbove}m over ${marks.checked} corners`);
  check(marks.present, "the ground-marks mesh exists");
  check(marks.walked >= 6, "walking lays footprints", `${marks.walked} live`);
  check(marks.spread > 0.07, "prints alternate about the line of travel",
    `${marks.spread}m across-track scatter`);
  check(marks.expired === 0, "marks expire on their own", `${marks.expired} still live`);
  check(marks.worstBelow > -0.01,
    "no mark corner is buried under the drawn ground", `${marks.worstBelow}m`);
  check(marks.worstAbove < 0.16,
    "no mark corner floats above it", `${marks.worstAbove}m`);

  /* =====================================================================
     3. PICTURES
     ===================================================================== */
  const tiles = [];
  const shots = [
    ["walked trail", -1, 260, 0, "top"],
    ["walked trail in play", -1, 260, 0, "play"],
    ["boosted scar", -1, 150, 1, "top"],
    ["boosted scar in play", -1, 150, 1, "play"],
  ];
  for (const [name, gait, frames, boost, view] of shots) {
    const url = await page.evaluate(async ([g, f, useBoost, v]) => {
      const T = window.__SF;
      T.setTime("day");
      const site = window.__SF_SAND_SITE;
      T.teleport(site[0], site[1], 0);
      T.setGaitInput(0, 0);
      for (let i = 0; i < 40; i += 1) T.renderOnce(1 / 60);
      T.setGaitInput(0, g);
      /* A held glide needs `boostHeld` on the input, not just a
         trigger() call - `beginFrame` stops the boost the moment the
         burst is over unless the key is still down. Triggering alone
         bought 0.30s of burst and a scar indistinguishable from the
         walk. */
      for (let i = 0; i < f; i += 1) {
        if (useBoost && i === 40) {
          T.ctx.player.input.keys.add("ShiftLeft");
          T.triggerBoost(0, -1);
        }
        T.renderOnce(1 / 60);
      }
      T.ctx.player.input.keys.delete("ShiftLeft");
      T.setGaitInput(0, 0);
      for (let i = 0; i < 20; i += 1) T.renderOnce(1 / 60);
      /* FRAME THE MARKS, NOT THE TROOPER. Two earlier versions
         aimed the camera off the player's travel heading and came
         back showing a boulder and an empty dune: where the trooper
         ENDS is not where its trail is, and a run that gets stopped
         by terrain ends pointing at whatever stopped it.
         The marks know where they are - read them out of the buffer
         and look at their centroid. */
      let mesh = null;
      T.ctx.scene.traverse((o) => { if (o.name === "ground-marks") mesh = o; });
      const meta = mesh.geometry.attributes.aMeta.array;
      const mp = mesh.geometry.attributes.position.array;
      const now = T.ctx.atmos.elapsed;
      let ax = 0;
      let az = 0;
      let n = 0;
      for (let k = 0; k < meta.length / 12; k += 1) {
        const m = k * 12;
        const age = (now - meta[m]) / Math.max(0.001, meta[m + 1]);
        if (age < 0 || age > 1) continue;
        ax += mp[m];
        az += mp[m + 2];
        n += 1;
      }
      if (n === 0) { ax = T.ctx.player.state.x; az = T.ctx.player.state.z; n = 1; }
      ax /= n;
      az /= n;
      /* Straight down from 13m. A gameplay-angle frame cannot answer
         "does the mark look right" - at a chase camera's rake a decal
         is four pixels of shading on a dune - and every attempt to
         shoot one caught a prop instead. Judge the mark from above,
         and judge whether it READS in play from the trail shot. */
      if (v === "top") {
        T.lookAt([ax, T.ctx.terrain.heightAt(ax, az) + 13, az + 0.01],
          [ax, T.ctx.terrain.heightAt(ax, az), az], 58);
      } else {
        /* Chase-camera height and rake. A decal that photographs well
           from directly overhead can be four pixels of shading from
           where the game is actually played, and that is the read
           that matters. */
        const s2 = T.ctx.player.state;
        const hx = Math.sin(s2.travelYaw);
        const hz = Math.cos(s2.travelYaw);
        const ex = ax + hx * 7;
        const ez = az + hz * 7;
        T.lookAt([ex, T.ctx.terrain.heightAt(ex, ez) + 3.1, ez],
          [ax - hx * 5, T.ctx.terrain.heightAt(ax, az) + 0.2, az - hz * 5], 60);
      }
      for (let i = 0; i < 4; i += 1) T.renderOnce(1 / 60);
      T.renderStill();
      const on = T.captureDataURL();
      mesh.visible = false;
      T.renderStill();
      const off = T.captureDataURL();
      mesh.visible = true;
      return [on, off, n];
    }, [gait, frames, boost, view]);
    const [on, off] = url.slice(0, 2).map((u) => Buffer.from(u.slice(u.indexOf(",") + 1), "base64"));
    await writeFile(path.join(out, `${name.replace(/\W+/g, "-")}.png`), on);
    const ra = await sharp(on).removeAlpha().raw().toBuffer();
    const rb = await sharp(off).removeAlpha().raw().toBuffer();
    const d = Buffer.alloc(ra.length);
    let peak = 0;
    let touched = 0;
    for (let k = 0; k < ra.length; k += 1) {
      const v = Math.abs(ra[k] - rb[k]);
      peak = Math.max(peak, v);
      if (v > 3) touched += 1;
      d[k] = Math.min(255, v * 5);
    }
    console.log(`  ${name}: ${url[2]} marks live, peak delta ${peak}/255, `
      + `${(touched / ra.length * 100).toFixed(1)}% of subpixels touched`);
    check(peak > 8, `${name} is actually visible`, `peak ${peak}/255`);
    const iso = await sharp(d, { raw: { width: 960, height: 620, channels: 3 } }).png().toBuffer();
    tiles.push(await sharp(on).resize(480, 310, { fit: "cover" })
      .composite([{ input: tag(480, name), left: 0, top: 0 }]).png().toBuffer());
    tiles.push(await sharp(iso).resize(480, 310, { fit: "cover" })
      .composite([{ input: tag(480, `^ marks alone (x5) peak ${peak}`), left: 0, top: 0 }])
      .png().toBuffer());
  }
  const file = await sheet(tiles, 2, 480, 310, path.join(out, "ground-fx.png"));
  console.log(`\nsheet: ${path.relative(root, file)}`);

  check(errors.length === 0, "no console or page errors",
    errors.slice(0, 4).join(" | "));
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  if (failures) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGKILL");
}
