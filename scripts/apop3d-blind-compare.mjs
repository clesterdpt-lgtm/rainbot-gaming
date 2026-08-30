#!/usr/bin/env node
/* ============================================================
   APOP DEMON MOGGERS 3D - blind A/B comparison builder

   Pairs our renders against real Super Mario 64 screenshots,
   randomises which side is which, and writes each pair to its own
   folder as A.png / B.png plus a side-by-side sheet.

   The answer key goes to `_key.json`, which the reviewing agent must
   not read. Use `--reveal` afterwards to score.

   Usage:
     node scripts/apop3d-blind-compare.mjs \
       --ours output/apop3d-shots/latest \
       --out  output/apop3d-blind/round-1 --seed 7

     node scripts/apop3d-blind-compare.mjs --reveal output/apop3d-blind/round-1 \
       --answers A,B,A,A,B,B

   ------------------------------------------------------------
   WHY THE PIPELINE LOOKS LIKE THIS

   A blind comparison is only worth running if it is actually blind.
   Several things will otherwise identify the Super Mario 64 side with
   no reference to art quality at all, and each is handled here:

   1. HUD. Every reference frame carries the burned-in N64 HUD - lives
      top-left, coins and stars top-right - and most carry an emulator
      overlay in the bottom-right corner. Ours are captured with the
      HUD hidden. Both sides are therefore cropped to the same central
      band, measured against the actual pool to clear all of it.

   2. RESOLUTION AND COMPRESSION. Ours are 1600x900 PNG (sharp,
      lossless). The references are upscaled captures of a 320x240
      framebuffer, stored as JPEG - soft, with mosquito noise on high
      contrast edges. That difference alone is a giveaway, so both
      sides go through an IDENTICAL resample and JPEG round-trip.

   3. TEXTURE SOFTNESS. The N64's bilinear filtering blurs its small
      textures into a very particular mush that survives any resample.
      `--match-softness` applies a matched blur to whichever side is
      sharper so that pixel sharpness cannot be the discriminator.
      Run at least one round with it on: if we only win when we are
      allowed to be sharper, we have won on resolution, not on art.

   4. ASPECT. 4:3 versus 16:9. The crop is expressed as a fraction of
      each image's own size and then covered into one panel shape, so
      neither side arrives pre-letterboxed.

   5. REPEATS. A reference is used AT MOST ONCE per run, so a panel the
      reviewer recognises from an earlier pair cannot be the tell. This
      caps the pair count at the size of the reference pool.

   6. SIDE BALANCE. A fair per-pair coin can put ours on panel A in 13
      of 14 pairs, which is a free guess after two pairs. The side plan
      is built exactly balanced and then shuffled.
   ============================================================ */

import { readdir, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i += 1; }
    } else args._.push(token);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

function makeRng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- the crop band ----
   MEASURED against the fetched pool at ~1360x1015, not guessed:
     lives / coins / stars HUD row   y 0.00 .. 0.128
     emulator overlay (bottom right) y 0.857 .. 0.946
     occasional letterbox bar        y 0.97 .. 1.00
   Keeping 0.155 .. 0.845 clears all of it with margin at both ends.
   Horizontally 0.04 .. 0.96 trims the frame edges where several
   captures carry a one-pixel border. */
const CROP = { x0: 0.04, x1: 0.96, y0: 0.155, y1: 0.845 };

const PANEL_W = 1120;
// Panel aspect sits between the two sources' cropped bands (ref
// ~1.79:1, ours ~2.37:1) so `cover` trims a comparable amount off each
// rather than gutting one of them.
const PANEL_H = Math.round(PANEL_W / 2.05);

const MATCH_SOFTNESS = Boolean(args["match-softness"]);

async function listImages(dir) {
  const entries = await readdir(dir);
  return entries
    .filter((name) => /\.(png|jpe?g)$/i.test(name))
    .filter((name) => !name.startsWith("_"))
    /* Exclude the metrics gate's control frames.
       apop3d-shots.mjs writes a `<preset>.nosubject.png` beside each
       capture - the same frame with the character hidden - so the gate
       can difference them for a silhouette mask. They are NOT game
       frames and must never reach a reviewer: without this filter a
       7-shot capture built 14 pairs, half of them deliberately
       subject-less, and a blind round scored 43% over a pool that was
       half control images. */
    .filter((name) => !name.includes(".nosubject."))
    .sort()
    .map((name) => path.join(dir, name));
}

/**
 * Normalise any input to one panel: crop the HUD-free band, cover into
 * the panel shape, then round-trip through JPEG so both sides carry
 * the same compression signature.
 *
 * `softenTo` is the effective source width the panel should look like
 * it came from. Downsampling to that width and back is a far better
 * match for the N64's texture mush than a gaussian blur, because it
 * reproduces the same loss of high-frequency detail rather than
 * smearing edges that were never there.
 */
async function panel(file, softenTo) {
  const meta = await sharp(file).metadata();
  const w = meta.width;
  const h = meta.height;

  const left = Math.round(w * CROP.x0);
  const top = Math.round(h * CROP.y0);
  const width = Math.max(8, Math.round(w * (CROP.x1 - CROP.x0)));
  const height = Math.max(8, Math.round(h * (CROP.y1 - CROP.y0)));

  let pipe = sharp(file)
    .extract({ left, top, width, height })
    .resize(PANEL_W, PANEL_H, { fit: "cover", position: "centre" });

  if (softenTo && softenTo < PANEL_W) {
    const small = await pipe.resize(softenTo, Math.round(PANEL_H * softenTo / PANEL_W),
      { fit: "fill", kernel: "cubic" }).toBuffer();
    pipe = sharp(small).resize(PANEL_W, PANEL_H, { fit: "fill", kernel: "cubic" });
  }

  const jpeg = await pipe.jpeg({ quality: 80, chromaSubsampling: "4:2:0" }).toBuffer();
  return sharp(jpeg).png().toBuffer();
}

function labelSvg(text) {
  return Buffer.from(`
    <svg width="${PANEL_W}" height="${PANEL_H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="16" y="16" width="74" height="74" rx="12" fill="rgba(6,10,14,0.78)"
            stroke="rgba(255,255,255,0.7)" stroke-width="3"/>
      <text x="53" y="70" font-family="Helvetica,Arial,sans-serif" font-size="54"
            font-weight="700" fill="#ffffff" text-anchor="middle">${text}</text>
    </svg>
  `);
}

async function sheet(aBuf, bBuf, file) {
  const gap = 18;
  const canvas = sharp({
    create: {
      width: PANEL_W * 2 + gap * 3, height: PANEL_H + gap * 2,
      channels: 3, background: { r: 16, g: 18, b: 24 },
    },
  });
  await canvas.composite([
    { input: aBuf, top: gap, left: gap },
    { input: bBuf, top: gap, left: gap * 2 + PANEL_W },
  ]).png().toFile(file);
}

async function buildPairs() {
  const oursDir = path.resolve(root, args.ours || "output/apop3d-shots/latest");
  const refsDir = path.resolve(root, args.refs || "output/reference/sm64");
  const outDir = path.resolve(root, args.out || "output/apop3d-blind/latest");
  const seed = Number(args.seed || 1);
  const rng = makeRng(seed);

  const ours = await listImages(oursDir);
  const refs = await listImages(refsDir);
  if (!ours.length) throw new Error(`no images in ${oursDir}`);
  if (!refs.length) throw new Error(`no images in ${refsDir}`);

  // The references are upscales of a 320x240 framebuffer. When softness
  // matching is on, both sides are taken down to that effective detail
  // level so neither can win on pixel count.
  const soften = MATCH_SOFTNESS ? 420 : 0;

  const requested = Number(args.pairs || ours.length);
  const count = Math.min(requested, refs.length);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  const refPool = shuffle(refs);
  const ourPool = shuffle(ours);

  const sidePlan = [];
  for (let i = 0; i < count; i += 1) sidePlan.push(i % 2 === 0);
  for (let i = sidePlan.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = sidePlan[i]; sidePlan[i] = sidePlan[j]; sidePlan[j] = t;
  }

  const key = [];

  for (let i = 0; i < count; i += 1) {
    const ourFile = ourPool[i % ourPool.length];
    const refFile = refPool[i];
    const oursIsA = sidePlan[i];

    const pairDir = path.join(outDir, `pair-${String(i + 1).padStart(2, "0")}`);
    await mkdir(pairDir, { recursive: true });

    const rawA = await panel(oursIsA ? ourFile : refFile, soften);
    const rawB = await panel(oursIsA ? refFile : ourFile, soften);

    const aBuf = await sharp(rawA).composite([{ input: labelSvg("A"), top: 0, left: 0 }]).png().toBuffer();
    const bBuf = await sharp(rawB).composite([{ input: labelSvg("B"), top: 0, left: 0 }]).png().toBuffer();

    await writeFile(path.join(pairDir, "A.png"), aBuf);
    await writeFile(path.join(pairDir, "B.png"), bBuf);
    await sheet(aBuf, bBuf, path.join(pairDir, "sheet.png"));

    key.push({
      pair: i + 1,
      oursIs: oursIsA ? "A" : "B",
      ourFile: path.relative(root, ourFile),
      refFile: path.relative(root, refFile),
    });
  }

  await writeFile(path.join(outDir, "_key.json"), JSON.stringify({
    seed, count, matchSoftness: MATCH_SOFTNESS, panel: { w: PANEL_W, h: PANEL_H }, crop: CROP, key,
  }, null, 2));

  await writeFile(path.join(outDir, "README.txt"),
    "BLIND COMPARISON\n\n"
    + `${count} pairs. Each pair-NN/ holds A.png, B.png and sheet.png.\n`
    + "One panel is our render, the other is a real Super Mario 64 frame.\n"
    + "Sides are balanced and shuffled; a reference is never reused.\n\n"
    + "DO NOT OPEN _key.json. Judge each pair on which frame looks like\n"
    + "the better-looking game, then score with --reveal.\n"
    + (MATCH_SOFTNESS
      ? "\nSoftness matching is ON: both sides carry the same effective\ndetail level, so sharpness cannot be the tell.\n"
      : "\nSoftness matching is OFF: our side may be legitimately sharper.\n"));

  process.stdout.write(`Wrote ${count} pair(s) to ${path.relative(root, outDir)}\n`);
  process.stdout.write(`Softness matching: ${MATCH_SOFTNESS ? "ON" : "off"}\n`);
  process.stdout.write("Reviewer: look at each pair-NN/sheet.png and record A or B.\n");
}

async function reveal() {
  const dir = path.resolve(root, String(args.reveal));
  const keyFile = JSON.parse(await readFile(path.join(dir, "_key.json"), "utf8"));
  const answers = String(args.answers || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!answers.length) throw new Error("--answers A,B,A,... is required with --reveal");

  const rows = [];
  let wins = 0, scored = 0;
  for (const entry of keyFile.key) {
    const pick = answers[entry.pair - 1];
    if (!pick) continue;
    scored += 1;
    const pickedOurs = pick === entry.oursIs;
    if (pickedOurs) wins += 1;
    rows.push({
      pair: entry.pair, picked: pick, oursWas: entry.oursIs,
      winner: pickedOurs ? "OURS" : "SM64",
      ourFile: path.basename(entry.ourFile), refFile: path.basename(entry.refFile),
    });
  }

  process.stdout.write(`\nBLIND RESULT  (seed ${keyFile.seed}, softness match ${keyFile.matchSoftness ? "ON" : "off"})\n`);
  process.stdout.write("".padEnd(74, "-") + "\n");
  for (const r of rows) {
    process.stdout.write(
      `pair ${String(r.pair).padStart(2)}  picked ${r.picked}  ours was ${r.oursWas}  `
      + `-> ${r.winner.padEnd(4)}  ${r.ourFile}  vs  ${r.refFile}\n`);
  }
  process.stdout.write("".padEnd(74, "-") + "\n");
  const pct = scored ? (100 * wins / scored) : 0;
  process.stdout.write(`OURS preferred in ${wins}/${scored} pairs (${pct.toFixed(0)}%)\n\n`);

  await writeFile(path.join(dir, "_result.json"), JSON.stringify({
    seed: keyFile.seed, matchSoftness: keyFile.matchSoftness,
    wins, scored, pct: Number(pct.toFixed(1)), rows,
  }, null, 2));
}

if (args.reveal) reveal().catch((err) => { console.error(err); process.exit(1); });
else buildPairs().catch((err) => { console.error(err); process.exit(1); });
