#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Garner, photographed

   Four questions this answers that no assertion can:

     1. does the PIT read as a hole in the ground from a trooper's own
        eye height, or only from a review camera looking down at it;
     2. does the mouth read as a MOUTH - can you tell open from shut at
        forty metres, and is the gullet the warmest thing in a district
        made of bone;
     3. does a tentacle read as muscle, or as a pale ribbon: raised,
        striking, and lying dead across the sand;
     4. does the ribcage read as the backdrop it was moved out to be,
        rather than as the set the fight is buried in.

   Usage:  node scripts/saintfall-garner-shots.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/garner-shots");
const PORT = 49957;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
    // The HUD is the game's, not the animal's. Every frame here is
    // about whether the creature reads.
    document.querySelectorAll(".sf-hud, #sf-hud").forEach((el) => {
      el.style.visibility = "hidden";
    });
  });

  const pit = await page.evaluate(() => {
    const T = window.__SF;
    T.teleportToGarner(40);
    T.advanceToGarnerPhase("feeding", 18);
    const c = T.garner.config;
    return { x: c.pitX, z: c.pitZ };
  });

  /* Each shot is [name, camera offset from the pit, target offset, fov,
     and what to set up first]. Offsets rather than absolutes so moving
     the encounter does not silently reframe every photograph. */
  /* THE LIMBS COME UP NEAR THE PLAYER, not out of the pit - that is the
     whole point of them - so a photograph of one is a photograph of
     wherever the trooper is standing. Every shot that wants a tentacle
     in it has to put the player somewhere the camera is already
     looking first, or the animal reaches into empty desert off-frame. */
  /* `stand` is redefined inside each setup rather than shared, because
     setups are stringified and evaluated in the PAGE - nothing from
     this module's scope travels with them. */
  const shots = [
    /* Camera heights are ABSOLUTE world Y, and the Ossuary pan sits at
       about zero - so a shot "on the rim" is a few metres up and a shot
       "into the pit" is aimed nine metres below that. */
    ["01-approach", [-70, 9, -52], [0, -6, 0], 55, (T) => {
      const c = T.garner.config;
      T.forceGarnerPhase("feeding");
      T._teleportRaw(c.pitX - 30, c.pitZ - 22, 0);
      T.advanceTime(1 / 60, 1 / 60);
      for (let i = 0; i < 3; i += 1) T.forceGarnerLash(i);
      T.advanceTime(1.1, 1 / 60);
    }],
    // Standing on the funnel's rim, looking down into it.
    ["02-rim", [-32, 3, -22], [0, -7, 0], 62, (T) => {
      T.advanceTime(0.5, 1 / 60);
    }],
    ["03-lash", [-44, 10, -36], [-16, 4, -12], 60, (T) => {
      const c = T.garner.config;
      T._teleportRaw(c.pitX - 18, c.pitZ - 14, 0);
      T.advanceTime(1 / 60, 1 / 60);
      for (let i = 3; i < 6; i += 1) T.forceGarnerLash(i);
      T.advanceTime(1.55, 1 / 60);
    }],
    ["04-limb-down", [-40, 6, -26], [-14, -4, -10], 62, (T) => {
      const c = T.garner.config;
      T._teleportRaw(c.pitX - 20, c.pitZ - 14, 0);
      T.advanceTime(1 / 60, 1 / 60);
      for (let i = 0; i < 4; i += 1) T.forceGarnerArmDown(i);
      T.advanceTime(1.0, 1 / 60);
    }],
    // At the mouth's own rim, where a polearm reaches the gullet.
    ["05-gorge", [-15, -4, -11], [0, -8, 0], 62, (T) => {
      T.forceGarnerPhase("gorge", 11);
      T.advanceTime(2.2, 1 / 60);
    }],
    ["06-down-the-throat", [-2, 14, -2], [0, -9, 0], 66, null],
    /* The one that answers question 4: the pit against the ribcage it
       was deliberately moved out of. */
    ["07-ribcage", [52, 14, 38], [-40, 16, -30], 55, null],
    ["08-sealed", [-46, 10, -32], [0, -6, 0], 58, (T) => {
      T.forceGarnerPhase("dormant");
      T.advanceTime(0.5, 1 / 60);
    }],
  ];

  for (const [name, off, tOff, fov, setup] of shots) {
    if (setup) await page.evaluate(`(${setup.toString()})(window.__SF)`);
    await page.evaluate(([p, o, t, f]) => {
      const T = window.__SF;
      T.lookAt([p.x + o[0], o[1], p.z + o[2]], [p.x + t[0], t[1], p.z + t[2]], f);
      for (let i = 0; i < 4; i += 1) T.renderOnce(1 / 60);
    }, [pit, off, tOff, fov]);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`shot  ${name}`);
  }

  console.log(`\nShots: ${OUT}`);
  await browser.close();
} finally {
  server.kill();
}
