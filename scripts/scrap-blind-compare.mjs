#!/usr/bin/env node
/* ============================================================
   SCRAP CIRCUIT — blind A/B comparison builder

   Pairs our renders against real 1995-era vehicular-combat
   screenshots, randomises which side is which, and writes each
   pair as A.png / B.png plus a side-by-side sheet.

   The answer key goes to `_key.json`, which the reviewing agent
   must not read. Use `--reveal` afterwards to score.

   Usage:
     node scripts/scrap-blind-compare.mjs \
       --ours output/scrap-action/latest \
       --out  output/scrap-blind/round-1 --seed 7

     node scripts/scrap-blind-compare.mjs --reveal output/scrap-blind/round-1 \
       --answers A,B,A,A,B,B

   ------------------------------------------------------------
   WHY THE PIPELINE LOOKS LIKE THIS

   A blind comparison is only blind if four giveaways unrelated to
   render quality are dealt with, and all four are handled here:

   1. HUD. Every reference carries burned-in UI — a name banner
      across the top, ammo and turbo bars along the bottom, a
      minimap in a corner. Ours are captured with the HUD hidden.
      Both sides are therefore cropped to the same central band,
      measured to clear all of it.

   2. RESOLUTION AND COMPRESSION. Ours are 1440x810 PNG, sharp and
      lossless; the references are ~640x480 upscaled lossy webp,
      soft with ringing on high-contrast edges. That difference
      alone identifies them. Both sides go through an IDENTICAL
      downsample to console resolution, upscale, and JPEG round
      trip.

   3. ASPECT. 16:9 versus 4:3. The crop is a fraction of each
      image's own size and then covered into one panel shape, so
      neither side arrives pre-letterboxed.

   4. REPEATS. Our shots never repeat within a run, so any panel
      the reviewer recognises from an earlier pair is necessarily
      the reference. A reference is used AT MOST ONCE per run,
      which caps pair count at the reference pool size.
   ============================================================ */

import { readdir, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2); const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) a[k] = true; else { a[k] = n; i += 1; }
    } else a._.push(t);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));

/* Deterministic shuffle so a run can be reproduced from its seed. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/* Crop window, as a fraction of each image's own size. Measured off the
   reference pool: the green name banner runs to y=0.11, the corner
   minimap to y=0.27, and the turbo/ammo bars start at y=0.83. Anything
   above y=0.30 or below y=0.80 leaks HUD, which identifies the reference
   instantly and has nothing to do with how either side renders. */
const CROP = { x: 0.10, y: 0.30, w: 0.80, h: 0.50 };
const PANEL_W = 512;
const PANEL_H = 384;

/**
 * Put both sides through the same pipe: crop to the shared window,
 * cover into the panel shape, drop to console resolution, upscale
 * back, then a lossy round trip. After this, sharpness and
 * compression carry no information about which side is which.
 */
async function normalise(file) {
  const meta = await sharp(file).metadata();
  const left = Math.round(meta.width * CROP.x);
  const top = Math.round(meta.height * CROP.y);
  const width = Math.round(meta.width * CROP.w);
  const height = Math.round(meta.height * CROP.h);
  const cropped = await sharp(file)
    .extract({ left, top, width, height })
    .resize(PANEL_W, PANEL_H, { fit: "cover" })
    .removeAlpha()
    .toBuffer();
  // Console-resolution pass, then back up — this is what equalises the
  // two sources' detail level.
  const smallW = 320;
  const smallH = Math.round((PANEL_H / PANEL_W) * smallW);
  const shrunk = await sharp(cropped).resize(smallW, smallH, { kernel: "cubic" }).toBuffer();
  return sharp(shrunk)
    .resize(PANEL_W, PANEL_H, { kernel: "nearest" })
    .jpeg({ quality: 62 })
    .toBuffer();
}

async function listImages(dir) {
  const names = await readdir(dir);
  return names
    .filter((n) => /\.(png|jpe?g|webp)$/i.test(n) && !n.startsWith("_"))
    .sort()
    .map((n) => path.join(dir, n));
}

async function build() {
  const oursDir = path.resolve(root, args.ours || "output/scrap-action/latest");
  const refDir = path.resolve(root, args.refs || "output/reference/tm");
  const outDir = path.resolve(root, args.out || "output/scrap-blind/latest");
  const seed = Number(args.seed || 1);

  const ours = await listImages(oursDir);
  const refs = await listImages(refDir);
  if (!ours.length) throw new Error(`no renders in ${oursDir}`);
  if (!refs.length) throw new Error(`no references in ${refDir}`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const rand = rng(seed);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // A reference is used at most once, so recognising a repeat can never
  // identify a side.
  const pairCount = Math.min(ours.length, refs.length, Number(args.pairs || 99));
  const pickOurs = shuffle(ours).slice(0, pairCount);
  const pickRefs = shuffle(refs).slice(0, pairCount);

  const key = [];
  for (let i = 0; i < pairCount; i += 1) {
    const pairDir = path.join(outDir, `pair-${String(i + 1).padStart(2, "0")}`);
    await mkdir(pairDir, { recursive: true });
    const oursBuf = await normalise(pickOurs[i]);
    const refBuf = await normalise(pickRefs[i]);
    const oursIsA = rand() < 0.5;
    await writeFile(path.join(pairDir, "A.png"), oursIsA ? oursBuf : refBuf);
    await writeFile(path.join(pairDir, "B.png"), oursIsA ? refBuf : oursBuf);
    await sharp({
      create: { width: PANEL_W * 2 + 12, height: PANEL_H, channels: 3, background: { r: 20, g: 20, b: 24 } },
    })
      .composite([
        { input: oursIsA ? oursBuf : refBuf, left: 0, top: 0 },
        { input: oursIsA ? refBuf : oursBuf, left: PANEL_W + 12, top: 0 },
      ])
      .png()
      .toFile(path.join(pairDir, "pair.png"));
    key.push({
      pair: i + 1,
      oursIs: oursIsA ? "A" : "B",
      ours: path.basename(pickOurs[i]),
      ref: path.basename(pickRefs[i]),
    });
  }

  // One sheet with every pair, for a single-pass review.
  const sheetW = 900;
  const rowH = Math.round((PANEL_H / (PANEL_W * 2 + 12)) * sheetW) + 8;
  const sheets = [];
  for (let i = 0; i < pairCount; i += 1) {
    sheets.push({
      input: await sharp(path.join(outDir, `pair-${String(i + 1).padStart(2, "0")}`, "pair.png"))
        .resize(sheetW).png().toBuffer(),
      left: 0,
      top: i * rowH,
    });
  }
  await sharp({
    create: { width: sheetW, height: pairCount * rowH, channels: 3, background: { r: 20, g: 20, b: 24 } },
  }).composite(sheets).png().toFile(path.join(outDir, "_all-pairs.png"));

  await writeFile(path.join(outDir, "_key.json"), JSON.stringify({ seed, key }, null, 2));
  console.log(`Built ${pairCount} blind pairs in ${path.relative(root, outDir)}`);
  console.log("Review _all-pairs.png (or pair-NN/pair.png). Do NOT read _key.json.");
}

async function reveal() {
  const dir = path.resolve(root, String(args.reveal));
  const { key } = JSON.parse(await readFile(path.join(dir, "_key.json"), "utf8"));
  const answers = String(args.answers || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (answers.length !== key.length) {
    throw new Error(`expected ${key.length} answers, got ${answers.length}`);
  }
  /* `--prefs` is the answer to the question that actually matters. The
     identification score only says the two are telling apart; it cannot
     say which is better, and if our renders are cleaner than the era
     they will score 100% while being an improvement. The preference
     vote is cast blind against the same panels. */
  const prefs = String(args.prefs || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (prefs.length && prefs.length !== key.length) {
    throw new Error(`expected ${key.length} preferences, got ${prefs.length}`);
  }
  let correct = 0;
  let oursPreferred = 0;
  let ties = 0;
  console.log("pair  guessed  actual  ident       preferred  winner   our shot                      reference");
  key.forEach((k, i) => {
    const ok = answers[i] === k.oursIs;
    if (ok) correct += 1;
    let winner = "-";
    if (prefs.length) {
      if (prefs[i] === "T") { ties += 1; winner = "tie"; }
      else if (prefs[i] === k.oursIs) { oursPreferred += 1; winner = "OURS"; }
      else winner = "ref";
    }
    console.log(
      `${String(k.pair).padStart(4)}  ${answers[i].padEnd(7)}  ${k.oursIs.padEnd(6)}  ` +
      `${(ok ? "IDENTIFIED" : "fooled").padEnd(10)}  ${(prefs[i] || "-").padEnd(9)}  ${winner.padEnd(7)}  ` +
      `${k.ours.padEnd(28)}  ${k.ref}`
    );
  });
  const pct = ((correct / key.length) * 100).toFixed(0);
  console.log(`\nIDENTIFICATION: ${correct}/${key.length} correct (${pct}%).`);
  console.log("  50% is chance. A high score only means the two eras look different —");
  console.log("  it does not say which way. Read it with the preference vote below.");
  if (prefs.length) {
    const total = key.length - ties;
    const p = total ? ((oursPreferred / total) * 100).toFixed(0) : "0";
    console.log(`\nPREFERENCE:     ours ${oursPreferred} / reference ${total - oursPreferred}` +
      `${ties ? ` / ${ties} tie` : ""}  (${p}% of decided pairs).`);
    console.log("  This is the goal metric: at or above 50%, the renders are on par or better.");
  }
}

(args.reveal ? reveal() : build()).catch((e) => { console.error(e); process.exit(1); });
