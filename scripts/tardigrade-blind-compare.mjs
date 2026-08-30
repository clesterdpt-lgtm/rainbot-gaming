#!/usr/bin/env node
/* ============================================================
   Tardigrade Simulator - blind A/B comparison builder

   Pairs our renders against real Goat Simulator screenshots,
   randomises which side is which, and writes each pair to its own
   folder as A.png / B.png plus a side-by-side sheet.

   The answer key is written to `_key.json`, which the reviewing
   agent must not read. Use `--reveal` afterwards to score.

   Usage:
     node scripts/tardigrade-blind-compare.mjs \
       --ours output/tardigrade-shots/world-3 \
       --out  output/blind/round-1 --seed 7

     node scripts/tardigrade-blind-compare.mjs --reveal output/blind/round-1 \
       --answers A,B,A,A,B,B
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

/* mulberry32 so pairings are reproducible from a seed */
function makeRng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PANEL_W = 1180;
// The panel's aspect must match the aspect of the region panel() keeps, or
// `fit: "cover"` crops the difference away horizontally. With a 16:9 panel
// against a 0.80 x 0.42 crop of a 16:9 source, each panel was showing about
// 21% of the frame - composition, sky, foreground framing and the horizon
// band all fell outside it, and a reviewer had to score composition from the
// full renders instead. 0.80 wide by 0.42 tall of 16:9 is 3.386:1.
const PANEL_H = Math.round(PANEL_W / ((16 * 0.74) / (9 * 0.40)));

async function listImages(dir) {
  const entries = await readdir(dir);
  return entries
    .filter((name) => /\.(png|jpe?g)$/i.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

/** Normalise any input to one panel size so neither side is favoured by
 *  resolution, and crop away the region where HUD lives.
 *
 *  Five of the six Goat Simulator references carry burned-in HUD - score
 *  counters and challenge banners - so a reviewer could identify which panel
 *  was the reference from the UI alone, regardless of how either image looked.
 *  That silently invalidates the whole comparison, which is supposed to be
 *  blind on rendering quality. The crop is applied to BOTH sides so neither
 *  is favoured; our own frames are captured with the HUD hidden anyway, so
 *  this costs us framing, not information.
 */
async function panel(file, variant = 0) {
  const meta = await sharp(file).metadata();
  const w = meta.width || PANEL_W;
  const h = meta.height || PANEL_H;
  // MEASURED, not guessed. On the 1080-line references the challenge banner
  // occupies roughly y 230-300 and the score counter y 930-985. The first
  // attempt at this kept y 24%-90% (259-972), which clipped the banner's top
  // and the counter's bottom and left both plainly legible - a reviewer
  // identified the reference in 14 of 14 pairs. Keep only the central band
  // that neither element reaches. Verified by eye, twice: the first band
  // (24%-90%) left both legible, the second (32%-82%) still showed the top
  // of the score digits at the bottom edge.
  // THREE text bands, not two. Measured per reference: the challenge banner
  // at y 272-303, a trick ticker at y 325-344, and the score counter from
  // ~930. The first crop (24%) kept all of it; the second (32%) still showed
  // score digits at the bottom edge; the third (31%) cleared the bottom but
  // started at row 335 - nine rows INSIDE the ticker - and left legible white
  // text in 11 of 14 pairs. 0.35 clears the ticker with margin and 0.40 of
  // height still ends at row 810, well above the counter.
  const top = Math.round(h * 0.35);
  const height = Math.max(8, Math.round(h * 0.40));

  // Slide the horizontal window per pair. With only six references cycled
  // across fourteen pairs, reference panels otherwise repeat verbatim - and
  // a panel the reviewer has already seen is necessarily the reference,
  // which handed away 8 of 14 pairs with no reference to render quality at
  // all. Shifting the window makes every panel distinct. Applied to BOTH
  // sides, so it costs each the same framing.
  // The per-pair sliding window existed only to stop repeated reference
  // panels being recognised. References are now used at most once per run, so
  // it buys nothing and costs both sides framing - and it left pair 1
  // centred while every other pair was shifted, for no benefit.
  const span = 0.74;
  const left = Math.round(w * ((1 - span) / 2));
  const width = Math.max(8, Math.round(w * span));

  // Both sides then go through an IDENTICAL resample and JPEG round-trip.
  // Ours are 1600x900 PNG (upscaled, soft); the references are 1920x1080
  // JPEG (downscaled, sharp, with mosquito noise on high-contrast edges).
  // That difference alone identifies the source regardless of HUD.
  const jpeg = await sharp(file)
    .extract({ left, top, width, height })
    .resize(PANEL_W, PANEL_H, { fit: "cover", position: "centre" })
    .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
    .toBuffer();
  return sharp(jpeg).png().toBuffer();
}

function labelSvg(text, width, height) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="18" y="18" width="84" height="84" rx="14" fill="rgba(6,10,14,0.78)" stroke="rgba(255,255,255,0.7)" stroke-width="3"/>
      <text x="60" y="80" font-family="Helvetica,Arial,sans-serif" font-size="62" font-weight="700"
            fill="#ffffff" text-anchor="middle">${text}</text>
    </svg>
  `);
}

async function buildPairs() {
  const oursDir = path.resolve(root, args.ours || "output/tardigrade-shots/latest");
  const refsDir = path.resolve(root, args.refs || "output/reference/goat-sim");
  const outDir = path.resolve(root, args.out || "output/blind/latest");
  const seed = Number(args.seed || 1);
  const rng = makeRng(seed);

  const ours = await listImages(oursDir);
  const refs = await listImages(refsDir);
  if (!ours.length) throw new Error(`no images in ${oursDir}`);
  if (!refs.length) throw new Error(`no images in ${refsDir}`);

  // A reference may be used AT MOST ONCE per run.
  //
  // Cycling 6 references over 14 pairs was tried and is not salvageable: our
  // own shots never repeat, so any panel the reviewer recognises is
  // necessarily the reference, which hands over every repeated pair. Sliding
  // the crop window per pair does not fix it either - it makes panels
  // hash-distinct, not perceptually distinct. Measured: a 74%-wide window can
  // travel at most 26%, the step landed at 91px of 1180, and a reviewer
  // matched the repeats at a mean absolute error of 1-3 grey levels out of
  // 255, i.e. the same picture. It then identified the reference in 14 of 14.
  //
  // So the pair count is capped by the reference pool, and which of our shots
  // are tested rotates with the seed. Coverage per run is lower; the result
  // is actually blind. The real remedy is more reference images.
  const requested = Number(args.pairs || ours.length);
  const count = Math.min(requested, refs.length);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const key = [];

  // Shuffle the reference pool so the same pose is not always against the same shot.
  // `sort(() => rng() - 0.5)` is NOT a uniform shuffle - the comparator is
  // inconsistent, so the permutation it produces is biased and some entries
  // are systematically over-sampled. That matters here because it decides
  // which of our shots get tested across seeds. Fisher-Yates, like sidePlan.
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  const refPool = shuffle(refs);

  // A fair per-pair coin is not good enough: at seed 1 it put ours on panel A
  // in 13 of 14 pairs, which is a free guess after two pairs. Build an
  // exactly balanced assignment and shuffle THAT.
  const sidePlan = [];
  for (let i = 0; i < count; i += 1) sidePlan.push(i % 2 === 0);
  for (let i = sidePlan.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = sidePlan[i]; sidePlan[i] = sidePlan[j]; sidePlan[j] = t;
  }

  // Rotate which of our shots get tested, so successive seeds cover the set.
  const ourPool = shuffle(ours);
  for (let i = 0; i < count; i += 1) {
    const ourFile = ourPool[i % ourPool.length];
    const refFile = refPool[i];
    const oursIsA = sidePlan[i % sidePlan.length];

    const pairDir = path.join(outDir, `pair-${String(i + 1).padStart(2, "0")}`);
    await mkdir(pairDir, { recursive: true });

    const aFile = oursIsA ? ourFile : refFile;
    const bFile = oursIsA ? refFile : ourFile;

    const aBuf = await panel(aFile, i);
    const bBuf = await panel(bFile, i);

    await sharp(aBuf).composite([{ input: labelSvg("A", PANEL_W, PANEL_H), top: 0, left: 0 }])
      .png().toFile(path.join(pairDir, "A.png"));
    await sharp(bBuf).composite([{ input: labelSvg("B", PANEL_W, PANEL_H), top: 0, left: 0 }])
      .png().toFile(path.join(pairDir, "B.png"));

    const GAP = 16;
    await sharp({
      create: {
        width: PANEL_W * 2 + GAP,
        height: PANEL_H,
        channels: 3,
        background: { r: 12, g: 14, b: 18 },
      },
    })
      .composite([
        { input: aBuf, top: 0, left: 0 },
        { input: bBuf, top: 0, left: PANEL_W + GAP },
        { input: labelSvg("A", PANEL_W, PANEL_H), top: 0, left: 0 },
        { input: labelSvg("B", PANEL_W, PANEL_H), top: 0, left: PANEL_W + GAP },
      ])
      .png()
      .toFile(path.join(pairDir, "side-by-side.png"));

    key.push({
      pair: i + 1,
      A: oursIsA ? "ours" : "reference",
      B: oursIsA ? "reference" : "ours",
      oursFile: path.relative(root, ourFile),
      referenceFile: path.relative(root, refFile),
    });
  }

  await writeFile(path.join(outDir, "_key.json"), JSON.stringify({ seed, pairs: key }, null, 2));
  await writeFile(
    path.join(outDir, "README.txt"),
    [
      "BLIND COMPARISON SET",
      "",
      `${count} pairs. Each pair-NN folder holds A.png, B.png and side-by-side.png.`,
      "One of A/B is our game, the other is a shipped commercial game. You are not told which.",
      "",
      "DO NOT OPEN _key.json.",
      "",
      "For each pair, judge ONLY the quality of the 3D rendering:",
      "lighting, material believability, shadow quality, texture detail, sense of depth,",
      "composition, colour, and overall production value.",
      "Ignore HUD/UI overlays entirely - one source ships with its HUD burned in.",
      "Ignore subject matter. A goat is not better or worse than a bug.",
      "",
      "Answer per pair with a single letter and one sentence of reasoning.",
    ].join("\n")
  );

  console.log(`built ${count} blind pairs in ${path.relative(root, outDir)}`);
  console.log(`answer key: ${path.relative(root, path.join(outDir, "_key.json"))} (do not show the reviewer)`);
}

async function reveal() {
  const dir = path.resolve(root, String(args.reveal));
  const key = JSON.parse(await readFile(path.join(dir, "_key.json"), "utf8"));
  const answers = args.answers ? String(args.answers).split(",").map((s) => s.trim().toUpperCase()) : null;

  let oursWins = 0;
  let refWins = 0;

  console.log(`\nseed ${key.seed}\n`);
  key.pairs.forEach((entry, index) => {
    const picked = answers ? answers[index] : null;
    const winner = picked ? entry[picked] : "(no answer supplied)";
    if (winner === "ours") oursWins += 1;
    if (winner === "reference") refWins += 1;
    console.log(
      `pair ${String(entry.pair).padStart(2, "0")}  A=${entry.A.padEnd(9)} B=${entry.B.padEnd(9)}` +
      (picked ? `  picked ${picked} -> ${winner.toUpperCase()}` : "")
    );
    console.log(`         ours: ${entry.oursFile}`);
    console.log(`         ref : ${entry.referenceFile}`);
  });

  if (answers) {
    const total = oursWins + refWins;
    console.log(`\nRESULT: ours ${oursWins} / ${total}   reference ${refWins} / ${total}`);
    if (oursWins > refWins) console.log("Our game won the blind comparison.");
    else if (oursWins === refWins) console.log("Tied - not good enough yet.");
    else console.log("The reference won. Keep working.");
  }
}

(async () => {
  if (args.reveal) await reveal();
  else await buildPairs();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
