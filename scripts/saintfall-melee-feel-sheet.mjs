#!/usr/bin/env node
/* ============================================================
   SAINTFALL - melee feel sheet

   Visual evidence for the two responsiveness moves added in the
   melee-feel pass:

     TURN SLASH (meleeTurn / meleeTurnCw) - a press with the reticle
     90 degrees or more off the body spins the root through the
     offset as the swing itself. The live sequence here runs a full
     about-face against a ring of Gleaners and photographs the spin
     at the gather, the strike and the settle.

     LUNGE (meleeLunge) - a press with forward held becomes a
     committed dash along the reticle. The sequence starts a body
     length short of a target the standing swing cannot reach and
     photographs the coil, the drive and the connect.

   Frozen hero poses of both clips are captured first so the
   silhouettes can be judged without motion blur or VFX.

   Usage:
     node scripts/saintfall-melee-feel-sheet.mjs [outdir]
     (default output/saintfall/melee-feel)
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, process.argv[2] || "output/saintfall/melee-feel");
const PORT = 46900 + (process.pid % 1800);
const BASE = `http://127.0.0.1:${PORT}`;
/* A black or empty frame compresses to almost nothing; a real one of
   this scene never does. */
const MIN_PNG_BYTES = 30_000;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = startServer();
  let browser = null;
  const shots = [];
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=low`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

    await page.evaluate(() => {
      const T = window.__SF;
      T.maximize();
      document.getElementById("sf-boot")?.remove();
      T.ctx.runtime.paused = true;
      T.hideHud(true);
      T.invulnerable(true);
      T.clearEnemies();
      T.autoStow(false);
      T.equipWeapon("glaive");
      const site = T.findFlatSite(14);
      window.__SHEET = {
        site: [site[0], site[1]],
        step(frames) {
          for (let i = 0; i < frames; i += 1) T.renderOnce(1 / 60);
        },
        reset(bodyYaw = 0, camYaw = 0) {
          T.player.input.clearAll?.();
          T.clearEnemies();
          T.releaseCamera();
          T.setGaitInput(null);
          T.teleport(window.__SHEET.site[0], window.__SHEET.site[1], bodyYaw);
          T.setBodyHeading(bodyYaw);
          T.setCam(camYaw, -0.08, 5.6);
          window.__SHEET.step(120);
        },
      };
    });

    const shoot = async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file });
      const size = (await stat(file)).size;
      shots.push({ name, size, ok: size >= MIN_PNG_BYTES });
      console.log(`  ${size >= MIN_PNG_BYTES ? "shot" : "SUSPECT (tiny)"}  ${name}.png (${size} bytes)`);
    };

    /* --- frozen hero poses ------------------------------------
       Chase camera, not heroCamera: the free-camera solve framed the
       road instead of the figure here, and the chase rig is the
       view the player actually judges these silhouettes from. Camera
       yaw is set past pi so it looks back INTO the figure's front
       three-quarter. */
    const poses = [
      ["pose-lunge-coil", "meleeLunge", 0.18, Math.PI - 0.75],
      ["pose-lunge-ram", "meleeLunge", 0.36, Math.PI - 0.75],
      ["pose-turn-carry", "meleeTurn", 0.30, Math.PI - 1.1],
    ];
    for (const [name, clip, t, camYaw] of poses) {
      await page.evaluate(([clipName, at, cy]) => {
        const T = window.__SF;
        window.__SHEET.reset(0, cy);
        T.setCam(cy, 0.04, 3.8);
        window.__SHEET.step(30);
        T.freezeAction(clipName, at);
        T.renderOnce(0);
      }, [clip, t, camYaw]);
      await shoot(name);
    }

    /* --- live turn slash: full about-face into a Gleaner ring --- */
    await page.evaluate(() => {
      const T = window.__SF;
      const S = window.__SHEET;
      S.reset(0, Math.PI);
      const ps = T.player.state;
      const aim = ps.aimViewYaw ?? ps.camYaw;
      for (const off of [0, 0.9, -0.9]) {
        T.enemies.spawn("gleaner",
          ps.x + Math.sin(aim + off) * 2.6,
          ps.z + Math.cos(aim + off) * 2.6,
          { health: 1000, yaw: aim + off + Math.PI });
      }
      S.step(2);
      T.pressMelee();
      S.step(1);
    });
    for (const [name, frames] of [
      ["turn-01-gather", 4],   // 0.08s: shaft levelled, spin beginning
      ["turn-02-strike", 8],   // 0.20s: mid-spin, crescent firing
      ["turn-03-carve", 7],    // 0.32s: late whip through the ring
      ["turn-04-settled", 8],  // 0.45s: on the new bearing
    ]) {
      await page.evaluate((n) => window.__SHEET.step(n), frames);
      await shoot(name);
    }

    /* --- live lunge: W held, target beyond standing reach ------- */
    await page.evaluate(() => {
      const T = window.__SF;
      const S = window.__SHEET;
      S.reset(0, 0);
      const ps = T.player.state;
      const aim = ps.aimViewYaw ?? ps.camYaw;
      T.enemies.spawn("gleaner",
        ps.x + Math.sin(aim) * 6.5,
        ps.z + Math.cos(aim) * 6.5,
        { health: 1000, yaw: aim + Math.PI });
      T.setGaitInput(0, -1);   // W held
      S.step(2);
      T.pressMelee();
      S.step(1);
    });
    for (const [name, frames] of [
      ["lunge-01-coil", 9],     // 0.17s: blade cocked, drive ramping
      ["lunge-02-drive", 9],    // 0.32s: low split at full speed, hit opening
      ["lunge-03-connect", 8],  // 0.45s: contact at full extension
      ["lunge-04-recover", 14], // 0.68s: rising out of the follow-through
    ]) {
      await page.evaluate((n) => window.__SHEET.step(n), frames);
      await shoot(name);
    }
    await page.evaluate(() => window.__SF.setGaitInput(null));

    console.log("=".repeat(64));
    const bad = shots.filter((s) => !s.ok);
    if (pageErrors.length) {
      console.log("PAGE ERRORS:", JSON.stringify(pageErrors));
      process.exitCode = 1;
    }
    if (bad.length) {
      console.log(`SUSPECT FRAMES: ${bad.map((s) => s.name).join(", ")}`);
      process.exitCode = 1;
    }
    console.log(`wrote ${shots.length} frames to ${path.relative(root, outDir)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
