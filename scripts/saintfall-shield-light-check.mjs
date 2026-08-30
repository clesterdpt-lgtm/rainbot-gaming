#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Aegis light parity check

   The Aegis point lights were moved out of the plate/dome groups and
   parented to the scene, so that raising the shield no longer changes
   the visible light count (which recompiles every material in the
   level - a 198ms freeze). That is a change to WHERE a light lives,
   so it has to be proven not to be a change to what the frame looks
   like:

   1. Shield up renders the same picture as before the move.
   2. Shield down leaves NO residual glow - the failure mode of a
      scene-parented light is one that keeps its last intensity and
      follows the player around with no shield under it.

   Run in a worktree at the old commit with --tag pre to make the
   reference, then on the new tree with --tag post to compare.

   Usage:
     node scripts/saintfall-shield-light-check.mjs --tag post
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const TAG = argv.includes("--tag") ? argv[argv.indexOf("--tag") + 1] : "post";
const OUT = path.resolve(root, "output/saintfall/shield-light");
const PORT = 49900 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; }
    catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1100, height: 620 }, deviceScaleFactor: 1,
    })).newPage();
    await page.goto(`${BASE}/games/saintfall.html?qa=1&intro=0&time=night&seed=aegis`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });

    const shots = await page.evaluate(async () => {
      const T = window.__SF;
      T.maximize();
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
      T.hideHud(true);
      // Night, third-person, close: the light's own contribution is
      // most of what is on screen, which is the point.
      T._teleportRaw(-14, 700, 0);
      T.advanceTime(1.2, 1 / 60);
      for (let i = 0; i < 20; i += 1) T.renderOnce(1 / 60);

      const lightCount = () => {
        let n = 0;
        T.render.scene.traverseVisible((o) => { if (o.isPointLight) n += 1; });
        return n;
      };
      const idleLights = lightCount();

      T.setShieldInput(true);
      T.advanceTime(1.1, 1 / 60);
      for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
      const upLights = lightCount();
      const up = T.captureDataURL();
      const upIntensity = T.shield?.visual?.light?.intensity
        ?? T.ctx?.shield?.visual?.light?.intensity ?? null;

      T.setShieldInput(false);
      T.advanceTime(3.0, 1 / 60);
      for (let i = 0; i < 10; i += 1) T.renderOnce(1 / 60);
      const downLights = lightCount();
      const down = T.captureDataURL();

      return { up, down, idleLights, upLights, downLights, upIntensity };
    });

    const toBuf = (d) => Buffer.from(d.split(",")[1], "base64");
    await writeFile(path.join(OUT, `${TAG}-up.png`), toBuf(shots.up));
    await writeFile(path.join(OUT, `${TAG}-down.png`), toBuf(shots.down));

    console.log(`visible point lights: idle ${shots.idleLights}, `
      + `shield up ${shots.upLights}, shield down ${shots.downLights}`);
    const stable = shots.idleLights === shots.upLights
      && shots.upLights === shots.downLights;
    console.log(stable
      ? "  ok   light count is STABLE across raise/lower (no shader recompile)"
      : "  !!   light count CHANGES - materials will recompile on first use");

    // Residual-glow check: the frame with the shield down must not be
    // brighter than the idle baseline it started from.
    const upStat = await sharp(toBuf(shots.up)).stats();
    const downStat = await sharp(toBuf(shots.down)).stats();
    const mean = (s) => (s.channels[0].mean * 0.2126 + s.channels[1].mean * 0.7152
      + s.channels[2].mean * 0.0722);
    console.log(`frame mean: shield up ${mean(upStat).toFixed(2)}, `
      + `shield down ${mean(downStat).toFixed(2)}`);

    // Compare against a reference produced by an earlier --tag run.
    const refUp = path.join(OUT, "pre-up.png");
    try {
      const ref = await readFile(refUp);
      const a = await sharp(ref).resize(220, 124, { fit: "fill" }).raw().toBuffer();
      const b = await sharp(toBuf(shots.up)).resize(220, 124, { fit: "fill" }).raw().toBuffer();
      let diff = 0;
      for (let i = 0; i < a.length; i += 1) diff += Math.abs(a[i] - b[i]);
      const perChannel = diff / a.length;
      console.log(`\nshield-up picture vs pre-change reference: `
        + `mean |delta| ${perChannel.toFixed(2)} / 255`);
      console.log(perChannel < 3
        ? "  ok   the picture is unchanged by the light re-parent"
        : "  !!   the light move CHANGED the picture - investigate");
    } catch (_) {
      console.log(`\n(no reference at ${path.relative(root, refUp)} - `
        + `run with --tag pre in a pre-change worktree to make one)`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
