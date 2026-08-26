#!/usr/bin/env node
/* ============================================================
   SAINTFALL - grip and firing close-ups

   The loadout audit answers "is any of it inside a leg" in numbers.
   It cannot answer "does the hand look like it is holding that", and
   three rounds of this were lost to believing a metric over a
   picture. So this frames the HAND - not the figure - and shoots it
   from enough bearings that a grip cannot hide.

   Five bearings per state, orbiting the fist, plus a wrist-level low
   angle that shows whether the palm is on the grip or behind it. Two
   states: carried, and firing at the reticle. The discharge is
   triggered through the real input so the pose photographed is the
   pose the game produces.

   Usage:
     node scripts/saintfall-grip-shots.mjs --tag now
     node scripts/saintfall-grip-shots.mjs --hand 1 --pitch 12
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const tag = arg("--tag", "now");
const hand = Number(arg("--hand", 0));
const lookPitch = Number(arg("--pitch", 0));
const outDir = path.resolve(root, arg("--out", "output/saintfall/grip-shots"));
const PORT = 46300 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

/* Yaw is measured from the trooper's FORWARD, so 0 looks the way the
   figure faces and 180 is the chase camera's own bearing. */
const BEARINGS = [
  { id: "a-outboard", yaw: 90, pitch: 0.02, dist: 1.05 },
  { id: "b-front34", yaw: 145, pitch: 0.10, dist: 1.05 },
  { id: "c-front", yaw: 180, pitch: 0.04, dist: 1.00 },
  { id: "d-rear34", yaw: 40, pitch: 0.12, dist: 1.05 },
  { id: "e-below", yaw: 130, pitch: -0.55, dist: 0.95 },
];

/* Bearings taken in the WEAPON's own frame, not the figure's.

   A body-relative orbit cannot be trusted to show a grip: the prop is
   raked in the fist, so every one of five figure-relative bearings can
   land oblique to the handle and the fist reads as "around something".
   The crescent hybrid is a D-guard - flat in its own Z - so looking
   down that axis puts the handle loop broadside and the question
   "are the fingers THROUGH the loop" answers itself. Framed on the
   authored grip point, which is where the palm is supposed to be. */
const WEAPON_BEARINGS = [
  { id: "w-flatA", modelAxis: [0, 0, 1], dist: 0.95, fov: 26 },
  { id: "w-flatB", modelAxis: [0, 0, -1], dist: 0.95, fov: 26 },
  { id: "w-spine", modelAxis: [1, 0.25, 0.35], dist: 0.95, fov: 26 },
  { id: "w-butt", modelAxis: [0.35, 0.9, 0.25], dist: 0.95, fov: 28 },
];

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall-white-vigil.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

function inPage(job) {
  const T = window.__SF;
  const p = T.player;
  const THREE = T.THREE;
  const loadout = T.ctx?.playerLoadout;
  if (!loadout?.parts?.length) return { missing: true };
  T.maximize();

  const ground = (x, z) => T.ctx.collide.groundHeight(x, z);
  let site = { x: 0, z: 0, w: 9 };
  for (let ring = 14; ring <= 180; ring += 12) {
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2 + ring * 0.31;
      const x = Math.cos(a) * ring;
      const z = Math.sin(a) * ring;
      const h = ground(x, z);
      if (!Number.isFinite(h)) continue;
      let worst = 0;
      let clear = true;
      for (let b = 0; b < 8 && clear; b += 1) {
        const bb = (b / 8) * Math.PI * 2;
        for (let d = 2; d <= 8; d += 2) {
          const qh = ground(x + Math.cos(bb) * d, z + Math.sin(bb) * d);
          if (!Number.isFinite(qh)) { clear = false; break; }
          worst = Math.max(worst, Math.abs(qh - h));
        }
      }
      if (clear && worst < site.w) site = { x, z, w: worst };
    }
    if (site.w < 0.05) break;
  }
  T.teleport(site.x, site.z, 0);
  T.advanceTime(1.2, 1 / 60);

  const plates = [];
  const palm = p.figure.palmLocators?.[job.hand] || p.figure.handPivots[job.hand];
  const held = loadout.parts.find((part) => part.spec.hand === job.hand) || loadout.parts[0];
  const focus = new THREE.Vector3();
  const axisWorld = new THREE.Vector3();
  const shoot = (label) => {
    palm.updateWorldMatrix(true, false);
    held.asset.updateWorldMatrix(true, true);
    const st = p.state;
    for (const b of job.bearings) {
      let eye;
      if (b.modelAxis) {
        /* Frame the authored grip point, and stand off along a
           direction fixed to the PROP. */
        focus.fromArray(held.spec.grip).applyMatrix4(held.asset.matrixWorld);
        axisWorld.fromArray(b.modelAxis)
          .transformDirection(held.asset.matrixWorld).normalize();
        eye = [
          focus.x + axisWorld.x * b.dist,
          focus.y + axisWorld.y * b.dist,
          focus.z + axisWorld.z * b.dist,
        ];
      } else {
        palm.getWorldPosition(focus);
        const yaw = st.yaw + (b.yaw * Math.PI / 180);
        eye = [
          focus.x + Math.sin(yaw) * b.dist * Math.cos(b.pitch),
          focus.y + Math.sin(b.pitch) * b.dist,
          focus.z + Math.cos(yaw) * b.dist * Math.cos(b.pitch),
        ];
      }
      T.hidePlayer(false);
      p.setFree(true, eye, [focus.x, focus.y, focus.z], b.fov || 38);
      T.renderStill();
      T.renderStill();
      plates.push({ label: `${label}-${b.id}`, url: T.captureDataURL() });
      p.setFree(false);
      T.autoPlayer();
    }
  };

  /* ---- carried ---- */
  shoot("carry");

  /* ---- firing ----
     Through the real input, so what is photographed is what the game
     makes. The look pitch is applied first: aiming up a mountain is
     the case a fixed body-space fire pose gets wrong, and the plate
     has to be able to show it. */
  if (job.pitch) {
    p.state.camPitch = job.pitch * Math.PI / 180;
    p.state.aimViewPitch = p.state.camPitch;
  }
  /* THROUGH THE SANCTIONED HOOK. Writing `input.state.firing`
     directly is overwritten by the input poll on the very next frame,
     so the plates came back showing the carry pose and the emit axis
     still 78 degrees off the camera. `setFiring` is the hook that
     survives a step. Re-asserted each frame because a held trigger is
     a held trigger. */
  for (let i = 0; i < 60; i += 1) {
    T.setFiring(true);
    T.advanceTime(1 / 60, 1 / 60);
  }
  const dischargeState = T.ctx?.playerDischarge?.status?.() || null;

  /* ---- what the aim actually did ----
     MEASURED WHILE THE TRIGGER IS STILL HELD. Taken after the
     release plus a settle, this read the CARRY pose and reported the
     barrel 77 degrees off the camera on a fire pose that was in fact
     working - the blend had simply relaxed before anything was
     sampled. */
  const camera = T.ctx.render.camera;
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const report = { plates, discharge: dischargeState, aim: {} };
  report.aim.cameraForward = camDir.toArray().map((v) => +v.toFixed(3));
  const emitDir = new THREE.Vector3();
  for (const part of loadout.parts) {
    part.asset.updateWorldMatrix(true, true);
    emitDir.fromArray(part.spec.emitterAxis)
      .transformDirection(part.asset.matrixWorld).normalize();
    report.aim[part.spec.id] = {
      emitDirWorld: emitDir.toArray().map((v) => +v.toFixed(3)),
      dotWithCamera: +emitDir.dot(camDir).toFixed(3),
    };
  }
  /* And the shot that actually left, which is the number the player
     experiences: a pulse that flies where the reticle is. */
  const last = dischargeState?.lastShot;
  if (last?.direction) {
    const d = new THREE.Vector3().fromArray(last.direction).normalize();
    report.aim.lastShot = {
      direction: last.direction,
      dotWithCamera: +d.dot(camDir).toFixed(3),
    };
  }

  shoot("fire");
  T.setFiring(false);
  T.advanceTime(0.4, 1 / 60);
  return report;
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 900, height: 900 },
    })).newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
    const url = new URL(`${BASE}/games/saintfall-white-vigil.html`);
    url.searchParams.set("qa", "1");
    url.searchParams.set("quality", "high");
    url.searchParams.set("character", "white-vigil");
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => window.__SF.setTime("goldenhour"));
    const bearings = process.argv.includes("--weapon-frame")
      ? WEAPON_BEARINGS : BEARINGS;
    const res = await page.evaluate(inPage, { bearings, hand, pitch: lookPitch });
    await page.close();
    if (res.missing) { console.log("no loadout"); return; }

    await mkdir(outDir, { recursive: true });
    for (const plate of res.plates) {
      await writeFile(
        path.join(outDir, `${tag}-h${hand}-${plate.label}.png`),
        Buffer.from(plate.url.slice(plate.url.indexOf(",") + 1), "base64")
      );
    }
    console.log(`\nhand ${hand}   ${res.plates.length} plates -> ${path.relative(root, outDir)}`);
    console.log(`  discharge: ${JSON.stringify(res.discharge && {
      supported: res.discharge.supported, fired: res.discharge.fired,
      live: res.discharge.live ?? res.discharge.active,
    })}`);
    console.log(`  camera forward ${JSON.stringify(res.aim.cameraForward)}`);
    for (const [k, v] of Object.entries(res.aim)) {
      if (k === "cameraForward" || !v.emitDirWorld) continue;
      console.log(`  ${k.padEnd(14)} emit ${JSON.stringify(v.emitDirWorld)}`
        + `   dot(camera) ${v.dotWithCamera}`);
    }
    if (res.aim.lastShot) {
      console.log(`  lastShot       dir  ${JSON.stringify(res.aim.lastShot.direction)}`
        + `   dot(camera) ${res.aim.lastShot.dotWithCamera}`);
    }
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
