#!/usr/bin/env node
/* ============================================================
   SAINTFALL - melee swing visual audit

   The one question a contact sheet of a swing has to answer is
   whether the LIGHT and the BLADE are the same object. That needs
   the weapon visible in frame, several moments of the same swing,
   and more than one bearing - a crescent that tracks the blade from
   behind can still be drawn on the wrong side of the body, and only
   a side-on and a front-on shot together will say so.

   Each row is one combo step. Columns are moments through the clip.
   `--bearing` picks the camera's angle off the trooper's facing.

   Usage:
     node scripts/saintfall-melee-audit.mjs --tag after
     node scripts/saintfall-melee-audit.mjs --tag after --bearing 1.5
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((part) => part.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true])
);
const tag = typeof args.tag === "string" ? args.tag : "current";
const outDir = path.resolve(root, args.out || `output/saintfall/melee-audit-${tag}`);
const port = 54900 + (process.pid % 5000);
const base = `http://127.0.0.1:${port}`;
const W = 560;
const H = 420;

/* Bearings the swing is judged from, as an offset from the trooper's
   facing. Behind-the-shoulder is how it is played; the flank is where
   an arc's shape actually reads; the front is the only angle that
   shows which side of the body the crescent is on. */
const VIEWS = [
  { name: "chase", bearing: Math.PI, dist: 4.6, height: 2.0, lookY: 1.35 },
  { name: "flank", bearing: Math.PI * 0.5, dist: 4.2, height: 1.9, lookY: 1.35 },
  { name: "front", bearing: 0.35, dist: 4.4, height: 1.8, lookY: 1.40 },
];

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const label = async (text, width, height = 22) => sharp({
  create: { width, height, channels: 4, background: { r: 8, g: 8, b: 10, alpha: 1 } },
}).composite([{
  input: Buffer.from(
    `<svg width="${width}" height="${height}">
       <text x="8" y="15" font-family="monospace" font-size="13"
             fill="#e8e2d6">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>
     </svg>`
  ),
  top: 0, left: 0,
}]).png().toBuffer();

try {
  await mkdir(outDir, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&intro=skip`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.hideHud(true);
    T.invulnerable(true);
    T.clearEnemies();
    T.setBreachAuto?.(false);
    T.equipWeapon("glaive");
    /* Pin a HIGH sun. The default golden hour rakes in at 13 degrees
       and puts the trooper's whole front in shadow, which is the one
       lighting condition under which a gold crescent on gold armour
       cannot be judged at all - the first pass photographed a swing in
       the dark and reported the effect as detached. */
    T.setTime("noon");
    const terr = T.terrain;
    let best = null;
    for (let sx = -90; sx <= 90; sx += 6) {
      for (let sz = 780; sz <= 880; sz += 6) {
        const h = terr.heightAt(sx, sz);
        let worst = 0;
        for (let a = 0; a < 8; a += 1) {
          const ang = (a / 8) * Math.PI * 2;
          worst = Math.max(worst, Math.abs(terr.heightAt(sx + Math.cos(ang) * 8,
            sz + Math.sin(ang) * 8) - h));
        }
        if (!best || worst < best.relief) best = { x: sx, z: sz, relief: worst };
      }
    }
    window.__SITE = best;
  });

  /* One swing, photographed live. The clip is driven by the REAL
     input path (`pressMelee`) and stepped frame by frame, because a
     frozen pose has no effect attached to it - the crescent is spawned
     by combat on the hit frame and has its own life. */
  async function shootStep(step, view) {
    return page.evaluate(async ([stepIndex, v, siteRef]) => {
      const T = window.__SF;
      const site = window.__SITE;
      // Settle: let the previous swing's combo lapse and its VFX die.
      T.vfx.reset?.();
      T._teleportRaw(site.x, site.z, 0);
      T.setBodyHeading(0);
      T.setCam(0, -0.08, 5.0);
      T.hidePlayer(false);
      for (let i = 0; i < 100; i += 1) T.renderOnce(1 / 60);

      const ps = T.player.state;
      const terr = T.terrain;
      /* Something to hit. A whiff draws the crescent at its dimmest
         and spawns none of the contact sparks, so a sheet shot in an
         empty desert audits the weakest frame the effect ever has. */
      T.spawnEnemy("thresher", ps.x + Math.sin(ps.yaw) * 2.2,
        ps.z + Math.cos(ps.yaw) * 2.2, { yaw: ps.yaw + Math.PI });
      for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
      const place = () => {
        const a = ps.yaw + v.bearing;
        const px = ps.x + Math.sin(a) * v.dist;
        const pz = ps.z + Math.cos(a) * v.dist;
        const py = Math.max(terr.heightAt(px, pz) + 0.5, ps.y + v.height);
        T.lookAt([px, py, pz], [ps.x, ps.y + v.lookY, ps.z], 46);
      };

      /* Walk the combo up to the requested clip, WAITING FOR EACH ONE
         TO GO LIVE.

         A press during a swing only queues; the chained clip does not
         begin until the running one ends. Pressing three times with a
         fixed 30-frame gap therefore left melee2 running when the tap
         counter started, and the whole melee3 row of the first sheet
         was photographs of melee2 with no crescent in them at all -
         the effect looked broken when it was the harness that was
         early. Spin until the action NAME is the one being audited. */
      const want = `melee${stepIndex + 1}`;
      let guard = 0;
      T.pressMelee();
      while (T.player.action !== want && guard < 400) {
        T.renderOnce(1 / 60);
        guard += 1;
        // Re-press inside the buffer window until the chain reaches it.
        if (T.player.action && T.player.action !== want && guard % 12 === 0) {
          T.pressMelee();
        }
      }
      if (T.player.action !== want) return [{ tap: -1, url: T.captureDataURL(), miss: want }];

      /* The free camera FREEZES the figure - `player.update` returns
         early in free mode - so the swing has to be advanced with the
         chase camera and only re-framed for the capture itself. */
      const taps = [6, 10, 14, 18, 24, 32];
      const shots = [];
      let frame = 0;
      for (const tap of taps) {
        while (frame < tap) { T.renderOnce(1 / 60); frame += 1; }
        place();
        T.renderOnce(0);
        shots.push({ tap, url: T.captureDataURL() });
        T.releaseCamera();
        T.hidePlayer(false);
      }
      return shots;
    }, [step, view, null]);
  }

  const rows = [];
  for (const view of VIEWS) {
    for (let step = 0; step < 3; step += 1) {
      const shots = await shootStep(step, view);
      const tiles = [];
      for (const s of shots) {
        const head = await label(`melee${step + 1} · ${view.name} · +${s.tap}f`, W);
        tiles.push(await sharp({
          create: { width: W, height: H + 22, channels: 4,
            background: { r: 8, g: 8, b: 10, alpha: 1 } },
        }).composite([
          { input: head, top: 0, left: 0 },
          { input: Buffer.from(s.url.split(",")[1], "base64"), top: 22, left: 0 },
        ]).png().toBuffer());
      }
      const strip = await sharp({
        create: { width: W * tiles.length, height: H + 22, channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 } },
      }).composite(tiles.map((input, i) => ({ input, left: W * i, top: 0 })))
        .png().toBuffer();
      await writeFile(path.join(outDir, `${view.name}-melee${step + 1}.png`), strip);
      rows.push(strip);
      console.log(`captured ${view.name} melee${step + 1}`);
    }
  }

  const sheet = await sharp({
    create: { width: W * 6, height: (H + 22) * rows.length, channels: 4,
      background: { r: 8, g: 8, b: 10, alpha: 1 } },
  }).composite(rows.map((input, i) => ({ input, top: (H + 22) * i, left: 0 })))
    .png().toBuffer();
  await writeFile(path.join(outDir, "sheet.png"), sheet);

  if (errors.length) console.log(`\nPAGE ERRORS:\n${errors.slice(0, 6).join("\n")}`);
  console.log(`\nwrote ${outDir}`);
  await browser.close();
} finally {
  server.kill();
}
