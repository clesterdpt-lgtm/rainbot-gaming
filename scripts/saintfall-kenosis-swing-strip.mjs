#!/usr/bin/env node
/* FILMSTRIPS of the melee clips - the frames of one swing laid out
   left to right, so the shape of the motion can be judged rather
   than inferred from a speed trace.

   A still cannot show a jolt and a number cannot show a silhouette,
   which is why both exist: `saintfall-kenosis-swing-probe.mjs` says
   whether the tip accelerates smoothly and lands its contact on the
   fastest frame, and this says whether the resulting pose reads as a
   person swinging something heavy.

   Frames are sampled at even intervals across the clip's own working
   span - coil through follow-through - and composited in the page,
   so what is tiled is exactly what the renderer drew. */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/kenosis-swing-strip");
const port = 47420 + (process.pid % 900);
const base = `http://127.0.0.1:${port}`;

const SHOTS = {
  "bastion-penitent": ["melee1", "meleeLunge", "melee3", "meleeTurn"],
  "white-vigil": ["melee1", "melee3"],
};
const COLS = 9;

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}
async function waitServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall-white-vigil.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function strip(browser, character) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  await page.goto(
    `${base}/games/saintfall-white-vigil.html?qa=1&character=${character}&quality=high&time=goldenhour`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    document.documentElement.classList.add("sf-maximised");
    const T = window.__SF;
    T.hideHud(true);
    T.teleport(120, 930, Math.PI);
    T.advanceTime(1.2, 1 / 60);
  });

  for (const clip of SHOTS[character]) {
    await page.evaluate(async ({ clip, cols }) => {
      const T = window.__SF;
      const P = T.player;
      const spec = P.actionSpec(clip);
      const scale = P.figure.meleeProfile?.timeScale || 1;
      const wall = spec.dur / scale;
      /* Three-quarters of the clip: the coil, the strike and the
         first of the follow-through. The tail is the figure standing
         up again and tells nobody anything. */
      const span = wall * 0.78;
      const gap = span / (cols - 1);
      const src = document.getElementById("sf-canvas");
      /* CENTRE-CROPPED. A full 16:9 frame per tile makes the figure a
         thumbnail nine times over; the swing is judged on the body,
         so each tile is a portrait crop of the middle of the frame. */
      const cropW = Math.round(src.width * 0.30);
      const cropH = Math.round(src.height * 0.86);
      const cropX = Math.round((src.width - cropW) / 2);
      const cropY = Math.round(src.height * 0.06);
      const tileW = 300;
      const tileH = Math.round(tileW * cropH / cropW);
      const strip = document.createElement("canvas");
      strip.width = tileW * cols;
      strip.height = tileH;
      const g = strip.getContext("2d");
      g.fillStyle = "#05080d";
      g.fillRect(0, 0, strip.width, strip.height);

      const ps = P.state;
      /* One warm render before the first tile. `setCam` takes effect
         on the NEXT draw, so without this the opening frame of a
         strip is composed with the previous shot's camera and the
         first tile is framed differently from the other eight. */
      /* Three-quarter from behind the hammer shoulder. A side view
         was tried for the thrust and is worse: the tower shield is on
         the other fist and occludes the whole blow. */
      const camYaw = ps.yaw - 2.35;
      const camDist = 4.4;
      /* WARMED WITH REAL TIME, not with a still. `setCam` feeds a
         DAMPED follow and `renderStill()` advances zero seconds, so
         any number of warm draws leaves the camera exactly where it
         started and tile 0 is composed with the previous shot's
         framing. A tenth of a second before the clip starts is what
         actually moves it. */
      T.hidePlayer(false);
      T.setCam(camYaw, 0.10, camDist);
      T.advanceTime(0.12, 1 / 60);
      T.renderStill();
      P.beginAction(clip);
      for (let i = 0; i < cols; i += 1) {
        T.hidePlayer(false);
        /* Three-quarter front, high enough to see the weapon's plane
           and the stance at the same time. */
        T.setCam(camYaw, 0.10, camDist);
        T.renderStill();
        g.drawImage(src, cropX, cropY, cropW, cropH, i * tileW, 0, tileW, tileH);
        g.strokeStyle = "rgba(255,255,255,0.10)";
        g.strokeRect(i * tileW + 0.5, 0.5, tileW - 1, tileH - 1);
        g.fillStyle = "rgba(255,255,255,0.55)";
        g.font = "13px monospace";
        g.fillText(`${(i / (cols - 1) * 0.78).toFixed(2)}`, i * tileW + 8, tileH - 8);
        if (i < cols - 1) T.advanceTime(gap, 1 / 120);
      }
      strip.id = "sf-strip";
      /* Displayed at its NATIVE size: an element screenshot captures
         the CSS box, so a scaled-down strip is a scaled-down capture
         and the whole point is lost. */
      Object.assign(strip.style, {
        position: "fixed", left: "0", top: "0", zIndex: "99999",
        width: `${strip.width}px`, height: `${strip.height}px`,
      });
      document.body.appendChild(strip);
      T.advanceTime(1.6, 1 / 60);
    }, { clip, cols: COLS });

    const el = await page.$("#sf-strip");
    await el.screenshot({ path: path.join(outDir, `${character}-${clip}.png`) });
    await page.evaluate(() => document.getElementById("sf-strip")?.remove());
    console.log(`strip ${character}-${clip}`);
  }
  if (errors.length) console.log("   pageErrors:", errors.slice(0, 3));
  await context.close();
  return errors;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  const errs = {};
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const character of Object.keys(SHOTS)) errs[character] = await strip(browser, character);
  } finally {
    await browser?.close();
    child.kill();
  }
  console.log(`\nstrips: ${outDir}`);
  const bad = Object.entries(errs).filter(([, e]) => e.length);
  if (bad.length) { console.log("FAIL - page errors:", JSON.stringify(bad)); process.exit(1); }
  console.log("every strip rendered without a page error");
}

main().catch((e) => { console.error(e); process.exit(1); });
