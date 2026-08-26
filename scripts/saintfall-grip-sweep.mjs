#!/usr/bin/env node
/* ============================================================
   SAINTFALL - carried-weapon hold sweep

   WHY. The crescent hybrid's grip loop runs very nearly PARALLEL
   to its own barrel - it is a sickle-gun, not a pistol - so the
   two things a player wants cannot both be had for free: a fist
   wrapped round the loop points the barrel across the palm, and a
   barrel in line with the forearm takes the loop out of the fist.
   Reasoning about that trade produced three wrong answers. This
   photographs it instead.

   Two axes:
     phi   how far the MUZZLE is turned off the forearm, in the palm
           plane. 0 = straight down the forearm (the pose in every
           pistol reference); 90 = straight across the palm.
     grip  which point on the weapon is pinned to the palm - inner
           face of the loop, its centreline, its outer face, or the
           frame beside the trigger.

   Each cell reports the aim the wrist can actually reach while
   firing, and a plate of the fist from a fixed bearing.

   Usage:
     node scripts/saintfall-grip-sweep.mjs --tag now
     node scripts/saintfall-grip-sweep.mjs --phi 0,30,60 --hand 1
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
const PHI = arg("--phi", "0,20,40,60,80").split(",").map(Number);
/* Which side of the hand the grip LOOP falls on. +1 puts it over the
   palm, -1 arcs it over the knuckles the way a D-guard's bow does. */
const ROLLS = arg("--roll", "1").split(",").map(Number);
const outDir = path.resolve(root, arg("--out", "output/saintfall/grip-sweep"));
const PORT = 48600 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;

/* Points on the weapon, model space, read off the raycast map of the
   handle region. The palm is pinned to whichever of these is chosen. */
const ALL_GRIPS = [
  { key: "inner", at: [0.240, 0.081, 0.000] },
  { key: "mid", at: [0.330, 0.100, 0.000] },
  { key: "outer", at: [0.405, 0.150, 0.000] },
  { key: "trigger", at: [0.105, 0.020, 0.000] },
  { key: "frame", at: [0.045, 0.060, 0.000] },
  { key: "frameLow", at: [0.045, -0.120, 0.000] },
];
const want = arg("--grips", "inner,mid,outer,trigger").split(",");
const GRIPS = ALL_GRIPS.filter((g) => want.includes(g.key));

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
  const L = T.ctx.playerLoadout;
  if (!L?.parts?.length) return { missing: true };
  T.maximize();

  const ground = (x, z) => T.ctx.collide.groundHeight(x, z);
  let site = { x: 0, z: 0, w: 9 };
  for (let ring = 14; ring <= 150; ring += 12) {
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

  const id = job.hand === 0 ? "left-hybrid" : "right-hybrid";
  const part = L.parts.find((q) => q.spec.hand === job.hand);
  const palm = p.figure.palmLocators[job.hand];
  const focus = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const mL = new THREE.Vector3();
  const mW = new THREE.Vector3();
  const cells = [];

  for (const g of job.grips) {
    for (const roll of job.rolls) {
    for (const phi of job.phi) {
      const r = phi * Math.PI / 180;
      /* long = the MUZZLE axis. longTo turns it off the forearm by
         phi, in the palm's own XY plane. roll keeps the grip loop on
         the palm side, which is what a pistol does with its
         backstrap. */
      const sign = job.hand === 0 ? 1 : -1;
      L.setHold(id, {
        long: [0, -1, 0],
        roll: [1, 0, 0],
        longTo: [sign * Math.sin(r), Math.cos(r), 0],
        rollTo: [0, 0, sign * roll],
        grip: g.at,
      });
      T.advanceTime(0.4, 1 / 60);

      /* aim reached while the trigger is held */
      for (let i = 0; i < 55; i += 1) { T.setFiring(true); T.advanceTime(1 / 60, 1 / 60); }
      part.parent.updateWorldMatrix(true, true);
      const q = part.parent.getWorldQuaternion(new THREE.Quaternion());
      mL.fromArray(part.spec.emitterAxis).applyQuaternion(part.mount.quaternion).normalize();
      mW.copy(mL).applyQuaternion(q).normalize();
      T.ctx.render.camera.getWorldDirection(fwd);
      const aimDot = +mW.dot(fwd).toFixed(3);
      T.setFiring(false);
      T.advanceTime(0.5, 1 / 60);

      /* plate: broadside to the palm, so the fist reads against the
         weapon rather than down its length */
      palm.updateWorldMatrix(true, false);
      palm.getWorldPosition(focus);
      /* Stand off along the PALM NORMAL, tilted toward the fingers:
         the weapon is on that side of the hand, so this is the one
         bearing where the fist and what it holds are both in frame.
         Broadside to the palm put the camera inside the gauntlet. */
      eye.set(sign * 0.86, 0.36, 0.36).transformDirection(palm.matrixWorld)
        .normalize().multiplyScalar(1.05).add(focus);
      T.hidePlayer(false);
      p.setFree(true, [eye.x, eye.y, eye.z], [focus.x, focus.y, focus.z], 34);
      T.renderStill();
      T.renderStill();
      cells.push({ grip: g.key, phi, roll, aimDot, url: T.captureDataURL() });
      p.setFree(false);
      T.autoPlayer();
    }
    }
  }
  return { cells };
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
    const page = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
    const url = new URL(`${BASE}/games/saintfall-white-vigil.html`);
    url.searchParams.set("qa", "1");
    url.searchParams.set("quality", "high");
    url.searchParams.set("character", "white-vigil");
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => window.__SF.setTime("goldenhour"));
    const res = await page.evaluate(inPage, { grips: GRIPS, phi: PHI, rolls: ROLLS, hand });
    await page.close();
    if (res.missing) { console.log("no loadout"); return; }

    await mkdir(outDir, { recursive: true });
    console.log(`\n  grip/roll   ${PHI.map((v) => String(v).padStart(6)).join("")}   (muzzle dot camera while firing)`);
    for (const g of GRIPS) {
      for (const roll of ROLLS) {
        const row = PHI.map((phi) => {
          const cell = res.cells.find((c) => c.grip === g.key && c.phi === phi && c.roll === roll);
          return String(cell ? cell.aimDot : "-").padStart(6);
        }).join("");
        console.log(`  ${(g.key + (roll < 0 ? " -" : " +")).padEnd(11)} ${row}`);
      }
    }
    for (const c of res.cells) {
      const rk = c.roll < 0 ? "neg" : "pos";
      await writeFile(path.join(outDir, `${tag}-${c.grip}-${rk}-phi${String(c.phi).padStart(2, "0")}.png`),
        Buffer.from(c.url.slice(c.url.indexOf(",") + 1), "base64"));
    }
    console.log(`\n  ${res.cells.length} plates -> ${path.relative(root, outDir)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
