#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Abbess, photographed

   Four questions no assertion can answer:

     1. does she read as a QUEEN - a small armoured animal in front of
        an enormous swollen body it can no longer carry - or as a grub
        with a hat on;
     2. do the segments read? A physogastric abdomen is a row of
        separate swellings cinched by hard plates, and if that does not
        survive to forty metres she is a sausage;
     3. does the clutch read as a threat on a clock - can you tell a
        fresh egg from one that is about to split;
     4. does the raised abdomen read as an INVITATION as well as a
        warning, which is the whole of her design.

   Usage:  node scripts/saintfall-abbess-shots.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/abbess-shots");
const PORT = 49983;
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
    channel: "chromium", headless: true,
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
    document.querySelectorAll(".sf-hud, #sf-hud").forEach((el) => {
      el.style.visibility = "hidden";
    });
  });

  /* Her chamber is at the bottom of one of the Bloom's sunken pits -
     about 28m below zero - so every camera offset here is relative to
     HER floor. Absolute heights put the lens in the sky. */
  const c = await page.evaluate(() => {
    const T = window.__SF;
    const k = T.abbess.config;
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 20);
    return { x: k.lairX, z: k.lairZ, y: T.abbess.instance().y, yaw: k.yaw };
  });

  const shots = [
    // The whole animal, from her flank: head left, twenty metres right.
    ["01-flank", [18, 6, -28], [-6, 3, 5], 56, (T) => {
      T.advanceTime(0.4, 1 / 60);
    }],
    // Head-on, which is what a player walking into the Throat sees:
    // armour, and the body behind it.
    ["02-head-on", [26, 3.2, 20], [0, 3, 0], 60, null],
    // A clutch on the ground, mid-swell.
    ["03-clutch", [-30, 5, -20], [-14, 1, -10], 60, (T) => {
      T.forceAbbessClutch();
      T.advanceTime(3.2, 1 / 60);
    }],
    // The brood it becomes.
    ["04-brood", [-26, 6, -18], [-8, 2, -6], 60, (T) => {
      T.advanceTime(3.4, 1 / 60);
    }],
    // THE WINDOW: twenty metres of abdomen up, underside lit.
    ["05-raised", [-26, 2.5, -16], [-6, 9, -3], 62, (T) => {
      T.forceAbbessSlam();
      T.advanceTime(1.42, 1 / 60);
    }],
    // ...and from underneath it, which is where the fight is won.
    ["06-underneath", [-11, 1.4, -7], [-2, 8, -1], 68, null],
  ];

  for (const [name, off, tOff, fov, setup] of shots) {
    if (setup) await page.evaluate(`(${setup.toString()})(window.__SF)`);
    await page.evaluate(([p, o, t, f]) => {
      const T = window.__SF;
      T.lookAt([p.x + o[0], p.y + o[1], p.z + o[2]],
        [p.x + t[0], p.y + t[1], p.z + t[2]], f);
      for (let i = 0; i < 4; i += 1) T.renderOnce(1 / 60);
    }, [c, off, tOff, fov]);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`shot  ${name}`);
  }

  console.log(`\nShots: ${OUT}`);
  await browser.close();
} finally {
  server.kill();
}
