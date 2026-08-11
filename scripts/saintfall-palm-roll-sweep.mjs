#!/usr/bin/env node
/* ============================================================
   SAINTFALL - palm roll sweep

   The hold has one parameter no gate can grade. Contact error,
   wrist error, reach and slack are all blind to the palm's ROLL
   ABOUT ITS OWN FINGER AXIS, because the palm sits on the shaft
   either way - so the suite went green with both gauntlets gripping
   a few degrees edge-on rather than wrapping the haft.

   Anything a metric cannot see has to be set by looking, and the
   cheap way to look is to sweep it in ONE live session rather than
   rebuilding per value: `qa.setPalmRoll` writes it at runtime, so
   this renders a strip of close-ups over a range of angles from the
   same two camera bearings.

   Usage:
     node scripts/saintfall-palm-roll-sweep.mjs
     node scripts/saintfall-palm-roll-sweep.mjs --range -0.5,0.5 --steps 9
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) args[k] = true;
      else { args[k] = n; i += 1; }
    } else args._.push(t);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(root, args.out || "output/saintfall/palm-roll");
const PORT = 47000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const RANGE = String(args.range || "-0.45,0.45").split(",").map(Number);
const STEPS = Number(args.steps || 7);
const PAIR = args.pair ? String(args.pair).split(",").map(Number) : null;

/* Two bearings, because a roll about the finger axis is invisible
   from the one direction the palm normal happens to point. Behind is
   how the player sees it; outboard is where the wrap actually reads. */
const VIEWS = [
  { id: "behind", dir: [0.10, 0.34, -1.0], dist: 2.05, fov: 30 },
  { id: "outboard", dir: [-1.0, 0.30, -0.30], dist: 1.85, fov: 30 },
];

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const r = await fetch(`${BASE}/games/saintfall.html`, { cache: "no-store" });
      if (r.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function grab(page, file) {
  const url = await page.evaluate(() => window.__SF.captureDataURL());
  await writeFile(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--force-device-scale-factor=1",
        "--hide-scrollbars", "--mute-audio"],
    });
    const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(),
      null, { timeout: 300000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      window.__SF.hideHud(true);
      window.__SF.invulnerable(true);
      // The figure is HIDDEN in free-camera mode by default, so a
      // hand close-up driven by `lookAt` photographs empty ground
      // unless the override is forced on.
      window.__SF.hidePlayer(false);
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    const values = PAIR
      ? [PAIR[0]]
      : Array.from({ length: STEPS }, (_, i) =>
        RANGE[0] + (RANGE[1] - RANGE[0]) * (i / (STEPS - 1)));

    for (const v of values) {
      const roll = PAIR || [v, v];
      const info = await page.evaluate((r) => {
        const T = window.__SF;
        T.setPalmRoll(r[0], r[1]);
        T.hidePlayer(false);
        // Settle the hold: the wrist solve is iterative and the hand
        // orientation is rate-limited, so one frame shows a pose
        // halfway to the one being judged.
        T.advanceTime(1.2, 1 / 60);
        return T.armReachCheck ? T.armReachCheck() : null;
      }, roll);

      for (const view of VIEWS) {
        await page.evaluate((spec) => {
          const T = window.__SF;
          const fig = T.player.figure;
          const THREE = T.THREE;
          // Frame the two grips, which is where the hands are.
          /* Framed on the GRIPS, not on the wrist bones. The wrist
             sits 11-12cm back up the forearm from the thing the hand
             is holding, so aiming there put the shoulder in frame and
             the hands off the bottom edge. */
          const w = T.weapons.current;
          const mid = new THREE.Vector3();
          const a = new THREE.Vector3();
          const b = new THREE.Vector3();
          w.gripFront.updateWorldMatrix(true, false);
          w.gripRear.updateWorldMatrix(true, false);
          a.setFromMatrixPosition(w.gripFront.matrixWorld);
          b.setFromMatrixPosition(w.gripRear.matrixWorld);
          mid.copy(a).add(b).multiplyScalar(0.5);
          const d = new THREE.Vector3(...spec.dir).normalize();
          T.lookAt(
            [mid.x + d.x * spec.dist, mid.y + d.y * spec.dist, mid.z + d.z * spec.dist],
            [mid.x, mid.y, mid.z], spec.fov
          );
          for (let i = 0; i < 6; i += 1) T.renderStill();
        }, view);
        const tag = String(v.toFixed(3)).replace("-", "n").replace(".", "p");
        await grab(page, path.join(OUT, `${view.id}-${tag}.png`));
      }
      const err = info
        ? info.map((r) => `${r.arm} contact ${r.palmContactError}m`).join(" · ")
        : "";
      console.log(`  roll ${v.toFixed(3)}  ${err}`);
    }
    console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
