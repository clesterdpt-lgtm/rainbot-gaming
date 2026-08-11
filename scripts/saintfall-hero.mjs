#!/usr/bin/env node
/* ============================================================
   SAINTFALL - hero shots

   Four compositions chosen to match the reference concept art, so
   the two can be judged side by side rather than by impression.
   Matching the FRAMING matters as much as matching the model: a
   figure photographed from a different height, distance and lens
   than the reference will read as a different design even when the
   geometry agrees.

   Usage:
     node scripts/saintfall-hero.mjs
     node scripts/saintfall-hero.mjs --time dusk
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true])
);
const OUT = path.resolve(root, args.out || "output/saintfall/hero");
const TIME = String(args.time || "goldenhour");
const PORT = 42000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;

/* Each entry mirrors one reference image.
   `bearing` is around the figure, `pitch` tilts the camera up from
   the ground plane - the reference leans on low, looking-up angles,
   which is most of why the figure reads as monumental. */
/* Each entry mirrors one reference image.

   Framing is as much of the match as the model. The reference leans
   on low, looking-up angles and a long lens, which is most of why
   its figure reads as monumental - and a first pass at 4.4m with a
   30-degree lens cropped the legs off and photographed the belly.
   The answer then was to back off to 7.2m, which fixed the crop by
   making the knight a quarter of the frame height in a great deal of
   empty sand: the reference fills its frame, and five of seven plates
   here did not. The crop was never a distance problem - it was an AIM
   problem, the camera pointed at the belt instead of the mass. These
   radii are computed from the subject's real extent and a 30-degree
   lens: 1.95m of figure (3.2m with the glaive raised) at 75% of frame
   height puts the camera at 4.9m and 6.1m respectively. */
const SHOTS = [
  {
    id: "1-hero-front",
    note: "Front-on, low camera looking up, glaive presented. Cathedral-steps plate.",
    weapon: "glaive", action: "present", t: 1.0,
    cam: { bearing: Math.PI * 0.5, radius: 6.1, pitch: 0.04, height: 1.30, aim: 1.55, fov: 30 },
  },
  {
    id: "2-combat",
    note: "Three-quarter, mid-swing. Shattered-glass combat plate.",
    weapon: "glaive", action: "melee1", t: 0.30,
    cam: { bearing: Math.PI * 0.80, radius: 5.9, pitch: 0.04, height: 1.25, aim: 1.45, fov: 32 },
  },
  {
    id: "3-march",
    note: "Side three-quarter, weapon carried. Desert-march plate.",
    weapon: "glaive", action: "present", t: 1.0,
    cam: { bearing: Math.PI * 1.18, radius: 6.1, pitch: 0.03, height: 1.30, aim: 1.55, fov: 31 },
  },
  {
    id: "4-ranged",
    note: "Autogun shouldered, three-quarter.",
    weapon: "autogun", action: null, t: 0,
    cam: { bearing: Math.PI * 0.64, radius: 5.0, pitch: 0.01, height: 1.15, aim: 1.05, fov: 31 },
  },
  {
    id: "5-detail-head",
    note: "Helm, gorget, pauldrons and halo. Where the crispness has to hold up.",
    weapon: null, action: null, t: 0,
    cam: { bearing: Math.PI * 0.5, radius: 2.5, pitch: 0.05, height: 1.66, aim: 1.63, fov: 30 },
  },
  {
    id: "6-detail-legs",
    note: "Faulds, tassets, greaves and sabatons.",
    weapon: null, action: null, t: 0,
    cam: { bearing: Math.PI * 0.5, radius: 2.7, pitch: 0.01, height: 0.66, aim: 0.55, fov: 32 },
  },
  {
    id: "7-back",
    note: "Rear three-quarter: halo, reliquary pack, tabard.",
    weapon: "glaive", action: "present", t: 1.0,
    cam: { bearing: Math.PI * 1.62, radius: 5.9, pitch: 0.03, height: 1.25, aim: 1.48, fov: 31 },
  },
];

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await rm(OUT, { recursive: true, force: true });
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 1375 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=ultra`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await page.evaluate((t) => {
    window.__SF.maximize();
    window.__SF.hideHud(true);
    window.__SF.setTime(t);
    window.__SF.studio(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }, TIME);

  const site = await page.evaluate(() => window.__SF.findFlatSite(7));
  console.log(`site ${Math.round(site[0])},${Math.round(site[1])} · time ${TIME}`);

  for (const shot of SHOTS) {
    await page.evaluate((s) => {
      const T = window.__SF;
      /* Facing +Z, so a bearing of pi/2 puts the camera in FRONT.
         The default spawn faces -Z, and every "front" shot in the
         first pass photographed the figure's back - which is why the
         review saw a green slab where the breastplate should be. */
      T.poseFigure(0, { radius: 4, yaw: 0 });
      T.player.state.figureOverride = true;
      // Detail shots hide the weapon: it swings across the head and
      // legs in the carry pose and obscures the very thing the shot
      // exists to inspect.
      if (s.weapon) T.equipWeapon(s.weapon);
      T.weapons.group.visible = !!s.weapon;
      if (T.weapons.current) T.weapons.current.root.visible = !!s.weapon;
      T.advanceTime(0.3, 1 / 60);
      if (s.action) T.freezeAction(s.action, s.t);
      T.heroCamera(s.cam);
    }, shot);
    const url = await page.evaluate(() => {
      for (let i = 0; i < 4; i += 1) window.__SF.renderOnce(1 / 600);
      return window.__SF.captureDataURL();
    });
    await writeFile(path.join(OUT, `${shot.id}.png`),
      Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    console.log(`  ${shot.id.padEnd(16)} ${shot.note}`);
  }

  if (pageErrors.length) console.error("page errors:", pageErrors.slice(0, 3));
  console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
