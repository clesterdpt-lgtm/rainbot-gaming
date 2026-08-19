#!/usr/bin/env node
/* ============================================================
   SAINTFALL - does the Undercroft light its own fight?

   The gallery's 04-impact frame photographed the Apostate as a flat
   black cutout with two gold slivers on it, four metres outside the
   daylight pool, in the same session where 01-portrait - taken IN the
   pool - showed the whole corrupted atlas. A boss that reads in one
   corner of a room and disappears in the rest is not a lighting
   style, it is a hole in the encounter, and "it looked fine in the
   screenshot I chose" is exactly the failure this project keeps
   writing notes about.

   So this measures it. The boss is planted at a grid of positions
   across the fighting pan, framed identically each time from a fixed
   relative offset, and the pixels INSIDE its own projected box are
   measured. What comes out is a luminance map of the room from the
   boss's point of view, plus the two numbers that decide whether it
   reads: how dark the darkest station is, and how far the best and
   worst stations are apart.

   Usage:
     node scripts/saintfall-undercroft-light.mjs [--out dir] [--shots 1]
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
const outDir = path.resolve(root, args.out || "output/saintfall/undercroft-light");
const keepShots = args.shots === "1";
/* `--surface` measures the SAME boss, the same pose and the same
   stations in the Cathedral nave instead of the hive. It is the
   control: the model, the atlas and the lens are identical, so any
   difference is the room's lighting and nothing else. */
const surfaceControl = args.surface === true || args.surface === "1";
const port = 55300 + (process.pid % 3000);
const base = `http://127.0.0.1:${port}`;

/* Eight bearings at three radii, plus the pool itself as a control.
   Twenty-five stations is enough to see a falloff and cheap enough to
   re-run after every lighting change. */
const BEARINGS = 8;
const RADII = [8, 20, 34];

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

/**
 * The BOSS's own pixels, isolated by a visibility diff.
 *
 * The first version of this measured a centred crop and reported a
 * flat, bright, 1.23:1 room - because at six metres a two-metre
 * figure is a tenth of the frame's width and the crop was almost
 * entirely FLOOR. It measured the hemisphere fill on the pan, which
 * is uniform by construction, and would have reported "no problem"
 * on a frame where the boss is a black cutout.
 *
 * So the subject is masked instead of cropped: the same station is
 * rendered twice, once with the figure hidden, and every pixel that
 * changed by more than a threshold is the figure. Exact, needs no
 * projection arithmetic, and cannot drift from where the boss
 * actually is.
 */
async function measure(withPng, withoutPng) {
  const a = await sharp(Buffer.from(withPng, "base64")).raw()
    .toBuffer({ resolveWithObject: true });
  const b = await sharp(Buffer.from(withoutPng, "base64")).raw().toBuffer();
  const { data, info } = a;
  const ch = info.channels;
  const lum = [];
  for (let i = 0; i + 2 < data.length; i += ch) {
    const d = Math.abs(data[i] - b[i]) + Math.abs(data[i + 1] - b[i + 1])
      + Math.abs(data[i + 2] - b[i + 2]);
    if (d < 12) continue;
    lum.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
  }
  if (lum.length < 200) return { mean: -1, p90: -1, p99: -1, px: lum.length };
  lum.sort((x, y) => x - y);
  const mean = lum.reduce((x, y) => x + y, 0) / lum.length;
  return {
    mean: Number(mean.toFixed(1)),
    p90: Number(lum[Math.floor(lum.length * 0.9)].toFixed(1)),
    p99: Number(lum[Math.floor(lum.length * 0.99)].toFixed(1)),
    /* Share of the figure's own pixels that are effectively black.
       This is the number the gallery frame was actually failing: a
       silhouette is not "dark", it is MOSTLY UNDER 24. */
    blackPct: Number((lum.filter((v) => v < 24).length / lum.length * 100).toFixed(1)),
    px: lum.length,
  };
}

try {
  await mkdir(outDir, { recursive: true });
  for (let i = 0; i < 300; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(`${base}/games/saintfall.html?boss=apostate&quality=high&qa=1`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate((on) => { window.__SURFACE_CONTROL = on; }, surfaceControl);

  const room = await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.advanceToApostatePhase("duel", 14, 1 / 60);
    if (!window.__SURFACE_CONTROL) {
      T.combat.damageEnemy(T.apostate.instance(), 1e9, { source: "audit" });
      for (let i = 0; i < 60 * 16; i += 1) {
        T.renderOnce(1 / 60);
        if (T.undercroftState().phase === "live") break;
      }
    }
    T.hideHud(true);
    T.hideVfx(true);
    T.invulnerable(true);
    /* The clutch and the limbs are the fight, not the lighting: a
       Thresher walking through frame changes the box's mean by more
       than the lamps do. Measure the room empty. */
    const boss = T.apostate.instance();
    for (const e of [...T.enemies.live]) if (e !== boss) T.enemies.remove(e);
    const u = T.undercroftState();
    const cfg = { x: T.undercroft.config.x, z: T.undercroft.config.z };
    if (window.__SURFACE_CONTROL) {
      const g = T.collide.groundHeight(cfg.x, cfg.z);
      return { cfg, floorY: g, pool: { x: cfg.x + 6, z: cfg.z + 6 },
        phase: "surface" };
    }
    return { cfg, floorY: u.floorY, pool: u.landing, phase: u.phase };
  });
  const wantPhase = surfaceControl ? "surface" : "live";
  if (room.phase !== wantPhase) throw new Error(`never reached ${wantPhase}: ${room.phase}`);

  const stations = [{ name: "pool", x: room.pool.x, z: room.pool.z }];
  const radii = surfaceControl ? [8, 16, 24] : RADII;
  for (const r of radii) {
    for (let b = 0; b < BEARINGS; b += 1) {
      const a = (b / BEARINGS) * Math.PI * 2;
      stations.push({
        name: `r${r}-b${b}`,
        x: room.cfg.x + Math.cos(a) * r,
        z: room.cfg.z + Math.sin(a) * r,
      });
    }
  }

  const results = [];
  for (const st of stations) {
    const shot = await page.evaluate(({ st, floorY }) => {
      const T = window.__SF;
      const inst = T.apostate.instance();
      inst.x = st.x;
      inst.z = st.z;
      inst.y = floorY;
      inst.root.position.set(st.x, floorY, st.z);
      /* Faced at the camera every time. A figure's read depends on
         which way it is turned relative to the one directional light
         in the room, and this is measuring the ROOM - so the pose is
         held constant and only the position moves. */
      inst.yaw = Math.PI * 0.75;
      T.renderStill();
      T.renderStill();
      /* Fixed relative offset, so the boss lands in the same pixels
         at every station and the crop is comparable. */
      const d = 6.5;
      T.lookAt([st.x + Math.sin(Math.PI * 0.75) * d, floorY + 2.4,
        st.z + Math.cos(Math.PI * 0.75) * d], [st.x, floorY + 1.15, st.z], 40);
      T.renderStill();
      const withBoss = T.captureDataURL();
      /* DRAWN, NOT STEPPED, for the masking pass. `renderStill` is
         `step(0, true)`, and stepping runs the encounter - whose
         `ensureSpawned`/`setEncounterGate` writes `root.visible`
         straight back to true. The first attempt at this diff hid the
         figure, stepped, and photographed it still standing there:
         zero changed pixels at all twenty-five stations, which read
         as "nothing to measure" rather than as a broken instrument. */
      inst.root.visible = false;
      T.render.render(T.render.camera);
      const withoutBoss = T.captureDataURL();
      inst.root.visible = true;
      T.render.render(T.render.camera);
      return { withBoss, withoutBoss };
    }, { st, floorY: room.floorY });
    const raw = shot.withBoss.slice(shot.withBoss.indexOf(",") + 1);
    const bare = shot.withoutBoss.slice(shot.withoutBoss.indexOf(",") + 1);
    const m = await measure(raw, bare);
    results.push({ ...st, ...m });
    if (keepShots) {
      await writeFile(path.join(outDir, `${st.name}.png`), Buffer.from(raw, "base64"));
    }
  }

  /* Stations where the figure was behind something contribute no
     pixels and report -1. They are not dark, they are absent, and
     letting them win "darkest" turns the spread into nonsense. */
  const ring = results.filter((r) => r.name !== "pool" && r.mean >= 0);
  const means = ring.map((r) => r.mean).sort((a, b) => a - b);
  const darkest = ring.reduce((a, b) => (a.mean <= b.mean ? a : b));
  const brightest = ring.reduce((a, b) => (a.mean >= b.mean ? a : b));
  const pool = results[0];
  const median = means[Math.floor(means.length / 2)];
  const spread = Number((brightest.mean / Math.max(0.1, darkest.mean)).toFixed(2));

  console.log("station        mean   p90   p99  black%   px");
  for (const r of results) {
    console.log(`${r.name.padEnd(12)} ${String(r.mean).padStart(6)}`
      + ` ${String(r.p90).padStart(5)} ${String(r.p99).padStart(5)}`
      + ` ${String(r.blackPct).padStart(7)} ${String(r.px).padStart(6)}`);
  }
  console.log(`\npool ${pool.mean}  |  ring median ${median}`
    + `  |  darkest ${darkest.name} ${darkest.mean}`
    + `  |  brightest ${brightest.name} ${brightest.mean}`);
  console.log(`brightest:darkest = ${spread}:1`);

  await writeFile(path.join(outDir, "report.json"),
    JSON.stringify({ room, results, pool, median, darkest, brightest, spread }, null, 2));
  await browser.close();
} finally {
  server.kill();
}
