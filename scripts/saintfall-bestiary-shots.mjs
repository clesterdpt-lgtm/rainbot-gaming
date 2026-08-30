#!/usr/bin/env node
/* ============================================================
   SAINTFALL - bestiary review harness

   Spawns each species next to the trooper and photographs it from
   several angles and in each of its clips.

   Two things it checks that no image metric can:

   - SCALE, measured in world units against the trooper's known
     1.85m, and photographed with the trooper actually in frame. A
     creature judged in isolation is judged against nothing.

   - CLIP COVERAGE. Every clip is played and captured, so a clip
     that exports with zero tracks - which is what Blender produces
     if an action is assigned without a slot on 4.4+ - shows up as
     an identical frame rather than as a silent nothing.

   Usage:
     node scripts/saintfall-bestiary-shots.mjs
     node scripts/saintfall-bestiary-shots.mjs --species thresher
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

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
const OUT = path.resolve(root, args.out || "output/saintfall/bestiary");
const WIDTH = Number(args.width || 1400);
const HEIGHT = Number(args.height || 900);
const PORT = Number(args.port || 47000 + (process.pid % 9000));
const BASE = `http://127.0.0.1:${PORT}`;

/* Staged on open sand at the Bloom's EDGE, not inside the spire
   field. Backed by its own district the creature is a dark thing in
   front of dark things and cannot be read at all - a review stage
   has to separate the subject from the background even when the
   final game will not. */
const STAGE = { x: -388, z: -448 };

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
  const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  if (file) await writeFile(file, buf);
  return buf;
}

async function fingerprint(buf) {
  /* A perceptual hash of the CREATURE, not of the frame.
     The first version hashed the whole 1400x900 image at 16x16.
     A one-metre creature occupies a couple of those cells, so the
     landscape behind it dominated every bit and five genuinely
     different poses hashed identically - the check reported the
     animations were broken when they were not, and the frames it
     was reporting on were 90% sand.
     Cropping to the middle third, where the harness frames the
     subject, and hashing at 32x32 makes it sensitive to the thing
     it is supposed to be measuring. */
  const meta = await sharp(buf).metadata();
  const w = Math.round(meta.width * 0.34);
  const h = Math.round(meta.height * 0.42);
  const { data } = await sharp(buf)
    .extract({
      left: Math.round((meta.width - w) / 2),
      top: Math.round((meta.height - h) / 2),
      width: w, height: h,
    })
    .greyscale().normalise().resize(32, 32, { fit: "fill" })
    .raw().toBuffer({ resolveWithObject: true });
  let mean = 0;
  for (let i = 0; i < data.length; i += 1) mean += data[i];
  mean /= data.length;
  let bits = "";
  for (let i = 0; i < data.length; i += 1) bits += data[i] > mean ? "1" : "0";
  return bits;
}

const hamming = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
  return d;
};

/**
 * FIGURE-GROUND separation, measured rather than eyeballed.
 *
 * Takes the same frame with and without the creature, diffs them to
 * get an exact pixel mask of the creature, and reports its mean
 * luma against the mean luma of whatever was behind it. "Too dark"
 * is then a number that can be tuned toward and re-checked, instead
 * of an opinion that gets argued about across rounds.
 *
 * The number that matters is the SEPARATION, not the creature's
 * absolute brightness: a dark enemy on pale sand is perfectly
 * readable, and a mid-grey one on mid-grey rock is not.
 */
async function figureGround(withBuf, withoutBuf) {
  const a = sharp(withBuf).removeAlpha();
  const b = sharp(withoutBuf).removeAlpha();
  const [ra, rb] = await Promise.all([
    a.raw().toBuffer({ resolveWithObject: true }),
    b.raw().toBuffer({ resolveWithObject: true }),
  ]);
  const A = ra.data;
  const B = rb.data;
  const luma = (buf, i) => buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;

  let n = 0;
  let sumFig = 0;
  let sumGnd = 0;
  let minFig = 255;
  let maxFig = 0;
  const figRGB = [0, 0, 0];
  const gndRGB = [0, 0, 0];
  for (let i = 0; i < A.length; i += 3) {
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    if (d < 24) continue;
    const lf = luma(A, i);
    sumFig += lf;
    sumGnd += luma(B, i);
    for (let c = 0; c < 3; c += 1) { figRGB[c] += A[i + c]; gndRGB[c] += B[i + c]; }
    if (lf < minFig) minFig = lf;
    if (lf > maxFig) maxFig = lf;
    n += 1;
  }
  if (!n) return null;
  const fig = sumFig / n;
  const gnd = sumGnd / n;
  const f = figRGB.map((v) => v / n);
  const g = gndRGB.map((v) => v / n);

  /* Redmean colour distance, not luma alone.
     A luma-only gate called this creature unreadable at a
     separation of -15 while it was, in the frame, an unmistakable
     violet thing on orange sand: it separates by HUE, and a metric
     that cannot see hue reports a false failure on exactly the
     designs the palette was built to support. Measure the quantity
     that matters. */
  const rbar = (f[0] + g[0]) / 2;
  const dR = f[0] - g[0];
  const dG = f[1] - g[1];
  const dB = f[2] - g[2];
  const distance = Math.sqrt(
    (2 + rbar / 256) * dR * dR + 4 * dG * dG + (2 + (255 - rbar) / 256) * dB * dB
  );

  return {
    pixels: n,
    coveragePct: Number(((n / (A.length / 3)) * 100).toFixed(2)),
    figureLuma: Number(fig.toFixed(1)),
    groundLuma: Number(gnd.toFixed(1)),
    lumaSeparation: Number((fig - gnd).toFixed(1)),
    colourDistance: Number(distance.toFixed(1)),
    figureRange: [Math.round(minFig), Math.round(maxFig)],
    figureRGB: f.map((v) => Math.round(v)),
    groundRGB: g.map((v) => Math.round(v)),
  };
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  const pageErrors = [];
  const consoleErrors = [];

  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--force-device-scale-factor=1",
        "--hide-scrollbars", "--mute-audio"],
    });
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      window.__SF.hideHud(true);
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    const speciesList = await page.evaluate(() => window.__SF.listSpecies());
    const wanted = args.species && args.species !== true
      ? String(args.species).split(",").map((s) => s.trim())
      : speciesList;
    console.log(`species available: ${speciesList.join(", ") || "(none)"}`);

    const rows = [];
    for (const key of wanted) {
      if (!speciesList.includes(key)) { console.warn(`skipping unknown "${key}"`); continue; }

      // The trooper stands at the stage point; the creature four
      // metres in front of it.
      const setup = await page.evaluate((s) => {
        const T = window.__SF;
        T.clearEnemies();
        T.releaseCamera();
        T.teleport(s.x, s.z, 0);
        T.hidePlayer(false);
        const inst = T.spawnEnemy(s.key, s.x + 4.2, s.z - 1.4, { yaw: Math.PI * 0.82 });
        T.advanceTime(2.0, 1 / 60);
        return { inst, scale: T.enemyScaleCheck(0) };
      }, { ...STAGE, key });

      if (!setup.inst) { console.error(`  ${key}: SPAWN FAILED`); continue; }
      const sc = setup.scale;
      console.log(`\n${key}: ${sc.heightM}m tall · ${sc.lengthM}m long · ${sc.widthM}m wide `
        + `· ${sc.ratio}x the trooper`);

      /* Framing is COMPUTED from the subject's measured height, not
         hand-tuned. The constants that were here - aim at +0.45,
         orbit at 3.6m - were fitted to a 1.16m Thresher, and applied
         unchanged to a 2.88m Cantor they put the camera at its knees
         and every single shot in the review, including the
         figure-ground measurement, framed a pair of shins.

         A review harness whose framing only works for the subject it
         was written against will pass the next subject while showing
         you the wrong thing, which is worse than failing. */
      const FOV = 40;
      const view = {
        h: sc.heightM,
        // Distance that makes the subject fill ~55% of the frame
        // height at this field of view.
        dist: sc.heightM / (2 * Math.tan((FOV / 2) * Math.PI / 180) * 0.55),
        aim: sc.heightM * 0.52,
        eye: sc.heightM * 0.72,
      };
      console.log(`  framing: aim ${view.aim.toFixed(2)}m · dist ${view.dist.toFixed(2)}m`);

      const clipNames = await page.evaluate(() => {
        const inst = window.__SF.enemies.live[0];
        return inst ? [...inst.actions.keys()] : [];
      });

      const prints = [];
      for (const clip of clipNames) {
        await page.evaluate((c) => window.__SF.playEnemyClip(c, 0), clip);
        // Land mid-clip, not on frame 1, where every clip looks the
        // same because every clip starts from rest.
        await page.evaluate(() => window.__SF.advanceTime(0.55, 1 / 60));
        await page.evaluate((v) => {
          const T = window.__SF;
          const e = T.enemies.live[0];
          // Framed so the creature fills the middle of the frame,
          // which is also where fingerprint() crops.
          const k = v.dist / Math.hypot(2.5, 2.3);
          T.lookAt([e.x + 2.5 * k, e.y + v.eye, e.z + 2.3 * k],
            [e.x, e.y + v.aim, e.z], 40);
          for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
        }, view);
        const file = path.join(OUT, `${key}-${clip}.png`);
        const buf = await grab(page, file);
        prints.push({ clip, print: await fingerprint(buf) });
        console.log(`  clip ${clip}`);
      }

      // Any two clips that render identically are a red flag: an
      // action exported with no tracks looks exactly like this.
      for (let i = 0; i < prints.length; i += 1) {
        for (let j = i + 1; j < prints.length; j += 1) {
          const d = hamming(prints[i].print, prints[j].print);
          if (d <= 2) {
            console.error(`  !! "${prints[i].clip}" and "${prints[j].clip}" are `
              + `visually identical (hamming ${d}) - is one of them empty?`);
          }
        }
      }

      // Turnaround, with the trooper in frame for scale.
      for (let i = 0; i < 6; i += 1) {
        await page.evaluate((spec) => {
          const T = window.__SF;
          const e = T.enemies.live[0];
          const a = (spec.i / spec.n) * Math.PI * 2;
          // Wider than the clip framing, because the turnaround has
          // the trooper in it for scale and the scale is the point.
          const r = spec.v.dist * 1.15;
          T.lookAt(
            [e.x + Math.cos(a) * r, e.y + spec.v.eye, e.z + Math.sin(a) * r],
            [e.x, e.y + spec.v.aim, e.z], 44
          );
          for (let k = 0; k < 6; k += 1) T.renderOnce(1 / 60);
        }, { i, n: 6, v: view });
        await grab(page, path.join(OUT, `${key}-turn-${i}.png`));
      }
      console.log(`  turnaround: 6 angles`);

      /* Figure-ground, measured on the idle pose at the standard
         review framing, with the creature masked exactly by an A/B
         against the same frame with it hidden. */
      await page.evaluate((v) => {
        const T = window.__SF;
        const e = T.enemies.live[0];
        T.playEnemyClip("idle", 0);
        T.advanceTime(0.4, 1 / 60);
        const k = v.dist / Math.hypot(2.5, 2.3);
        T.lookAt([e.x + 2.5 * k, e.y + v.eye, e.z + 2.3 * k],
          [e.x, e.y + v.aim, e.z], 40);
        for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
      }, view);
      const withBuf = await grab(page, path.join(OUT, `${key}-figure.png`));
      await page.evaluate(() => {
        window.__SF.enemies.group.visible = false;
        for (let i = 0; i < 6; i += 1) window.__SF.renderOnce(1 / 60);
      });
      const withoutBuf = await grab(page, null);
      await page.evaluate(() => {
        window.__SF.enemies.group.visible = true;
        for (let i = 0; i < 4; i += 1) window.__SF.renderOnce(1 / 60);
      });
      const fg = await figureGround(withBuf, withoutBuf);
      if (fg) {
        console.log(`  figure/ground: creature luma ${fg.figureLuma} rgb `
          + `${JSON.stringify(fg.figureRGB)} vs ground ${fg.groundLuma} `
          + `${JSON.stringify(fg.groundRGB)}`);
        console.log(`                 luma sep ${fg.lumaSeparation > 0 ? "+" : ""}`
          + `${fg.lumaSeparation} · colour distance ${fg.colourDistance} `
          + `· range ${fg.figureRange[0]}-${fg.figureRange[1]} `
          + `· ${fg.coveragePct}% of frame`);
        // Gated on COLOUR distance. Luma alone gives a false failure
        // on any design that separates by hue, which is most of this
        // palette.
        if (fg.colourDistance < 60) {
          console.error("  !! weak separation - the creature will disappear "
            + "against this ground at distance");
        }
        // Internal range is a separate question from separation: a
        // creature can stand out perfectly and still be a flat
        // cut-out with no form in it.
        if (fg.figureRange[1] - fg.figureRange[0] < 70) {
          console.error("  !! narrow internal value range - the creature is a "
            + "silhouette, not a modelled form");
        }
      }
      rows.push({ key, scale: sc, clips: clipNames, figureGround: fg });
    }

    const report = await page.evaluate(() => window.__SF.report());
    await writeFile(path.join(OUT, "report.json"), JSON.stringify({
      capturedAt: new Date().toISOString(), stage: STAGE,
      species: rows, engine: report, pageErrors, consoleErrors,
    }, null, 2));

    console.log(`\nfps ${report.fps} · frame ${report.frameMs}ms · `
      + `enemies ${JSON.stringify(report.enemies)}`);
    if (pageErrors.length) {
      console.error(`\n${pageErrors.length} page error(s):`);
      pageErrors.slice(0, 5).forEach((e) => console.error(`  ${e}`));
      process.exitCode = 1;
    }
    if (consoleErrors.length) {
      console.error(`\n${consoleErrors.length} console error(s):`);
      consoleErrors.slice(0, 8).forEach((e) => console.error(`  ${e}`));
    }
    console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
