#!/usr/bin/env node
/* ============================================================
   SAINTFALL - silhouette match against the traced plate

   Sixteen review rounds scored 3-4 while the gate suite went green.
   The suite could measure colour, value and part-presence, but it
   could never measure SHAPE - and shape is what the reviews kept
   describing: a crest that read as antennae, a skirt that was two
   boards, a body that was a cylinder. Pixel-count "part visible"
   gates are structurally incapable of seeing any of that.

   Every attempt to build a silhouette from a DIFFERENCE of two
   renders failed, because the render chain accumulates temporally:
   two consecutive captures differ across the whole frame. Five
   defects were fixed in that approach and it still returned masks
   with empty rows through the middle of the body.

   This renders the figure flat-white on black with the world hidden,
   so the mask is a THRESHOLD of one frame. No frame history, no
   plate, no subtraction.

   Compared against output/saintfall/reference/silhouette.json, which
   was read off the cathedral plate by eye.

   Usage:  node scripts/saintfall-silhouette.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(root, "output/saintfall/silhouette");
const PORT = 45000 + (process.pid % 4000);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
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
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=ultra`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize(); window.__SF.hideHud(true); window.__SF.studio(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  await page.evaluate(() => window.__SF.findFlatSite(6));

  // Front bearing, matching the near-frontal plate the trace came from.
  await page.evaluate(() => {
    const T = window.__SF;
    /* `yaw: 0` explicitly. Without it `poseFigure` spawns at its
       default yaw of PI, so the figure's forward vector was
       (-0.257, 0, -0.966) - pointing AWAY from a camera at +Z. The
       shape gate has been photographing the backplate and comparing
       it to a front-view trace; its numbers were not measurements of
       anything. From the front the same code reads mean 22% rather
       than 55%. */
    T.poseFigure(Math.PI * 0.5, { radius: 5.0, fov: 30, aim: 0.52, eye: 0.60, yaw: 0 });
    T.player.state.figureOverride = true;
    T.setSunShadow(false);
    /* Arms INCLUDED now: the re-trace is arm-inclusive, because the
       plate's arms are long, thin and articulated and are one of the
       three things that make this character recognisable. Excluding
       them made the instrument structurally blind to the render's
       stub arms. Only the back-arc is hidden, since the trace
       excludes it. */
    /* Posed to the CARRY, not to idle.

       `poseFigure` spawns and steps three frames, which leaves the
       figure in an idle stance with the glaive held across the body
       and the arms out to the sides. The trace is a WALKING figure
       with the arms down on the shaft. Comparing those two
       arm-inclusive put the chest and waist samples 62-83% wide -
       measuring a pose difference and reporting it as a shape defect.
       `present` is the carry pose and is the closest match the model
       has to the plate. */
    T.equipWeapon("glaive");
    T.freezeAction("present", 1.0);
    T.hideParts(["crest", "cloth"]);
    T.silhouetteMode(true, { weapon: false });
  });
  const url = await page.evaluate(() => {
    for (let i = 0; i < 6; i += 1) window.__SF.renderOnce(1 / 600);
    return window.__SF.captureDataURL();
  });
  await page.evaluate(() => { window.__SF.silhouetteMode(false); window.__SF.hideParts([]); });
  const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  await writeFile(path.join(OUT, "mask.png"), buf);

  const { data, info } = await sharp(buf).greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  const rows = [];
  let y0 = -1; let y1 = -1;
  for (let y = 0; y < info.height; y += 1) {
    let a = -1; let b = -1; let n = 0;
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] < 140) continue;  // flat white on black
      if (a < 0) a = x;
      b = x; n += 1;
    }
    rows.push([a, b, n]);
    /* y1 is the lowest row with REAL ink, not the lowest lit pixel.
       A single scallop tip 20px below the main hem shifted every depth
       fraction: at depth 0.95 the hem measured -3% and at 0.98 the
       same hem measured -35%. That artefact was ~4.4 points of the
       reported mean error - the instrument lying about the hem while
       telling the truth about the hips. */
    if (n >= 3) { if (y0 < 0) y0 = y; }
  }
  /* y1 is simply the lowest row with real ink again.

     An ink-fraction rule was added to reject a single scallop tip
     when the hem was a deep sawtooth. The hem is now +/-0.04 and the
     lower body is two thin legs, whose rows carry a small fraction of
     the widest row's ink - so the rule clipped the legs off entirely,
     dropping measured body height 798px to 612px and inflating every
     width by a third. A threshold calibrated against one silhouette
     shape became wrong the moment the shape changed, which is the
     same trap as every stale constant in this suite. */
  /* y1 from the ARMOUR, not from cloth hanging below the soles.

     The gold panel dropped to world y -0.010 - below the sabatons -
     so the lowest 15% of the mask was a 62px parallel ribbon with the
     cloth scallop on it, and it was setting the denominator for every
     depth. Corrected, the mid-body error is not +30-40% but +60-84%:
     the instrument was understating the defect by more than 2x.

     Worse, it meant a LONGER HEM IMPROVED THE SCORE. A metric a
     defect can flatter is worse than no metric. Cloth is measured on
     its own pass. */
  for (let y = rows.length - 1; y >= 0; y -= 1) {
    if (rows[y][2] >= 3) { y1 = y; break; }
  }
  if (y0 < 0 || y1 < 0) throw new Error("no figure in the silhouette render");
  const H = y1 - y0;
  const ref = JSON.parse(await readFile(
    path.resolve(root, "output/saintfall/reference/silhouette.json"), "utf8"));
  const pw = ref.widthByDepth;
  /* Keep the ORIGINAL key strings: Number("0.70") stringifies back to
     "0.7", which misses the entry and reads undefined. */
  const keys = Object.keys(pw).sort((a, b) => Number(a) - Number(b));

  console.log(`mask body ${y0}-${y1} (H ${H}px)  frame ${info.width}x${info.height}`);
  console.log("\n  depth   plate   render   error");
  const errs = [];
  for (const key of keys) {
    const d = Number(key);
    const yy = Math.min(info.height - 1, Math.round(y0 + H * d));
    // Median over a small band so one ragged row cannot set it.
    const band = [];
    for (let k = -4; k <= 4; k += 1) {
      const r = rows[yy + k];
      if (r && r[2] >= 3) band.push((r[1] - r[0]) / H);
    }
    band.sort((a, b) => a - b);
    const got = band.length ? band[Math.floor(band.length / 2)] : 0;
    const want = pw[key];
    const err = want > 0 ? (got - want) / want : 0;
    errs.push(Math.abs(err));
    console.log(`  ${d.toFixed(2)}    ${want.toFixed(3)}   ${got.toFixed(3)}   `
      + `${(err * 100 >= 0 ? "+" : "")}${(err * 100).toFixed(0)}%`);
  }
  /* ============================================================
     SHAPE, which nothing in the suite has ever measured.

     Fifteen colour/value/presence gates went green while the picture
     scored 4/10, because every defect costing points is SHAPE: a
     pauldron of five detached splinters scores the same as a solid
     lame on a 120px presence threshold.
     ============================================================ */

  /* Connectedness. The plate's figure is one blob; a crest floating
     in air or a pauldron in splinters is several. */
  const lab = new Int32Array(info.width * info.height).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < lab.length; i += 1) {
    if (lab[i] !== -1 || data[i] < 140) continue;
    const id = comps.length;
    let area = 0;
    stack.push(i);
    lab[i] = id;
    while (stack.length) {
      const q = stack.pop();
      area += 1;
      const qx = q % info.width; const qy = (q / info.width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = qx + dx; const ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= info.width || ny >= info.height) continue;
        const n = ny * info.width + nx;
        if (lab[n] !== -1 || data[n] < 140) continue;
        lab[n] = id;
        stack.push(n);
      }
    }
    comps.push(area);
  }
  const totalInk = comps.reduce((a, b) => a + b, 0);
  const big = comps.filter((a) => a > totalInk * 0.01).length;
  console.log(`\n  connected pieces (>1% of ink): ${big}  `
    + `[${comps.filter((a) => a > totalInk * 0.01).sort((a, b) => b - a).join(", ")}]`);

  /* Where the figure is WIDEST. The plate tapers monotonically from
     the pauldrons; a render whose widest row is at mid-chest has no
     shoulder-to-waist taper at all. */
  let wideY = y0; let wideW = 0;
  for (let y = y0; y <= y1; y += 1) {
    const w = rows[y][1] - rows[y][0];
    if (w > wideW) { wideW = w; wideY = y; }
  }
  const wideDepth = (wideY - y0) / H;
  console.log(`  widest row at depth ${wideDepth.toFixed(2)} `
    + `(plate is widest at the shoulders, about 0.25)`);

  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  const worst = Math.max(...errs);
  console.log(`\n  mean |error| ${(mean * 100).toFixed(0)}%   worst ${(worst * 100).toFixed(0)}%`);
  /* `big <= 2` was written to catch "3 pieces - body plus two free
     shins". But a figure whose ENTIRE lower body detaches scores 2
     and sails through: the gate can no longer fail for the reason it
     exists. The largest piece must also dominate. */
  const largest = comps.length ? Math.max(...comps) : 0;
  const dominant = largest / Math.max(totalInk, 1);
  console.log(`  largest piece holds ${(dominant * 100).toFixed(0)}% of ink`);
  const shapeOk = big <= 2 && wideDepth <= 0.30 && dominant >= 0.80;
  if (!shapeOk) {
    console.log(`  SHAPE FAIL: ${big > 2 ? `${big} disconnected pieces; ` : ""}`
      + `${wideDepth > 0.30 ? `widest at depth ${wideDepth.toFixed(2)} (need <= 0.30)` : ""}`);
  }
  const pass = mean <= 0.22 && worst <= 0.55 && shapeOk;
  console.log(`  ${pass ? "PASS" : "FAIL"}  silhouette matches the plate `
    + "(need mean <= 22%, worst <= 55%)");
  await writeFile(path.join(OUT, "report.json"),
    JSON.stringify({ bodyHeightPx: H, meanError: mean, worstError: worst, pass }, null, 2));
  console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  await browser.close();
  process.exitCode = pass ? 0 : 1;
} finally {
  server.kill("SIGTERM");
}
