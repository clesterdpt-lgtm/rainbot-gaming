#!/usr/bin/env node
/* ============================================================
   SAINTFALL - cutscene shader-freeze check

   The game froze for seconds on Windows at three beats: the drop
   cinematic (cloud break and egress), the Apostate reveal, and the
   phase-2 collapse. All three were the same mechanism: a light
   entering the level's VISIBLE light state mid-session (the pod's
   interior spill returning with the borrowed hull, the trooper's
   heart lamp and the lance's reliquary lamp unhiding with the rig,
   the undercroft lamps unhiding with the chamber group). A light
   count change re-keys the program of every lit material, and every
   hidden object keeps a stale program until ITS first draw - so the
   boot warm-up was being invalidated wholesale and repaid, one
   ubershader compile at a time, on the exact frames that must not
   hitch. Fix: every one of those lights is scene-parented and
   permanently counted, driven by intensity only.

   This harness proves the invariant the fix establishes:

     1. renderer.info.programs.length is CONSTANT from post-boot
        through the whole drop cinematic, the Apostate reveal and the
        undercroft collapse. Any recompile shows up as new programs
        (three keeps the old ones cached), so delta == 0 is "nothing
        compiled on a cutscene frame".
     2. The ctx.scene visible-light census (dir/point/hemi counts) is
        CONSTANT across all of the above. This is the root cause
        detector - it fails loudly on any future re-introduction.
     3. The undercroft still actually lights (frame mean well above
        black) and the lamps sit where the room expects them.

   Wall-clock per-step times are recorded but informational: this
   Mac's ANGLE-Metal compiles are fast; the program/light invariants
   are the platform-independent proof.

   Usage:
     node scripts/saintfall-cutscene-freeze-check.mjs [--tag post]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const TAG = argv.includes("--tag") ? argv[argv.indexOf("--tag") + 1] : "post";
const OUT = path.resolve(root, "output/saintfall/cutscene-freeze");
const PORT = 49700 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
function check(ok, label) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures += 1;
}

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

/* Census + program count, evaluated in-page. The census walks with
   traverseVisible because that is exactly what three's light collector
   does - an invisible light IS a light-count change waiting to render. */
const PAGE_HELPERS = `
  window.__freezeProbe = {
    census() {
      const T = window.__SF;
      const out = { dir: 0, point: 0, hemi: 0, other: 0 };
      T.render.scene.traverseVisible((o) => {
        if (!o.isLight) return;
        if (o.isDirectionalLight) out.dir += 1;
        else if (o.isPointLight) out.point += 1;
        else if (o.isHemisphereLight) out.hemi += 1;
        else out.other += 1;
      });
      return out;
    },
    /* Split by class. LIT programs are the freeze: a light-count
       change re-keys every one of them and a patched standard
       material is hundreds of ms of D3D compile on ANGLE. DEPTH
       variants (shadow-map materials) are tiny unlit shaders that
       renderer.compile() has no API to prebuild - one of those
       slipping through is milliseconds, and tolerated. */
    programs() {
      const list = window.__SF.render.renderer.info.programs || [];
      let depth = 0;
      for (const p of list) {
        if (String(p.cacheKey).startsWith("depth,")) depth += 1;
      }
      return { total: list.length, lit: list.length - depth, depth };
    },
  };
`;

const sameCensus = (a, b) => a.dir === b.dir && a.point === b.point
  && a.hemi === b.hemi && a.other === b.other;
const censusText = (c) => `dir ${c.dir} / point ${c.point} / hemi ${c.hemi}`;

async function newPage(browser, url) {
  const page = await (await browser.newContext({
    viewport: { width: 1100, height: 620 }, deviceScaleFactor: 1,
  })).newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(),
    null, { timeout: 240000 });
  await page.evaluate(PAGE_HELPERS);
  return page;
}

const toBuf = (dataUrl) => Buffer.from(dataUrl.split(",")[1], "base64");
async function meanLuma(buf) {
  const s = await sharp(buf).stats();
  return s.channels[0].mean * 0.2126 + s.channels[1].mean * 0.7152
    + s.channels[2].mean * 0.0722;
}

/* ------------------------------------------------------------------
   Part 1: the drop cinematic, stepped on the manual clock.
   ------------------------------------------------------------------ */
async function runIntro(browser) {
  console.log("\n== drop cinematic ==");
  const page = await newPage(browser,
    `${BASE}/games/saintfall.html?qa=1&intro=force&introClock=manual&seed=freeze`);

  const result = await page.evaluate(async () => {
    const T = window.__SF;
    const P = window.__freezeProbe;
    T.maximize();
    const boot = document.getElementById("sf-boot");
    if (boot && boot.parentNode) boot.parentNode.removeChild(boot);

    // Enter the timeline without the audio-unlock path (seek flips
    // awaiting-gesture -> running), then render a settling frame.
    T.seekIntroForQA(0.05);
    T.advanceIntroForQA(0.2, 1 / 30);

    const baseline = { programs: P.programs(), census: P.census() };
    const markers = T.introMarkers();
    const beats = [
      ["pre-entry", Math.max(0.5, (markers.entry ?? 5.0) - 0.5)],
      ["entry", (markers.entry ?? 5.0) + 0.7],
      ["pre-break", (markers.cloudBreak ?? 11.8) - 0.4],
      ["cloud-break", (markers.cloudBreak ?? 11.8) + 0.8],
      ["terminal", (markers.terminal ?? 15.0) + 0.5],
      ["impact", (markers.impact ?? 17.9) + 0.8],
      ["egress", (markers.egress ?? 21.1) + 0.8],
      // Past DROP_INTRO_DURATION (23.6), so advance() calls complete().
      ["handoff", 23.7],
    ];

    const rows = [];
    let cursor = 0.25;
    for (const [name, until] of beats) {
      let worst = 0;
      while (cursor < until) {
        const step = Math.min(1 / 30, until - cursor);
        const t0 = performance.now();
        T.advanceIntroForQA(step, 1 / 60);
        worst = Math.max(worst, performance.now() - t0);
        cursor += step;
      }
      rows.push({
        name,
        at: Number(cursor.toFixed(2)),
        worstMs: Number(worst.toFixed(1)),
        programs: P.programs(),
        census: P.census(),
      });
    }
    const status = T.introState();
    return { baseline, rows, completed: !!status?.completed, shot: status?.shot };
  });

  console.log(`baseline: ${result.baseline.programs.lit} lit + `
    + `${result.baseline.programs.depth} depth programs, `
    + `lights ${censusText(result.baseline.census)}`);
  for (const row of result.rows) {
    console.log(`  beat ${row.name.padEnd(11)} t=${String(row.at).padStart(5)}  `
      + `programs ${row.programs.lit}+${row.programs.depth}d  `
      + `lights ${censusText(row.census)}  worst step ${row.worstMs}ms`);
  }
  const last = result.rows[result.rows.length - 1].programs;
  check(result.rows.every((r) => r.programs.lit === result.baseline.programs.lit),
    `no LIT shader compiled on any cinematic beat (lit delta ${
      last.lit - result.baseline.programs.lit})`);
  check(last.depth - result.baseline.programs.depth <= 1,
    `at most one stray depth variant over the whole drop (depth delta ${
      last.depth - result.baseline.programs.depth})`);
  check(result.rows.every((r) => sameCensus(r.census, result.baseline.census)),
    "ctx.scene visible-light census constant through the whole drop");
  check(result.completed, "cinematic ran to completion under the manual clock");

  const shot = await page.evaluate(() => window.__SF.captureDataURL());
  await writeFile(path.join(OUT, `${TAG}-intro-handoff.png`), toBuf(shot));
  await page.context().close();
}

/* ------------------------------------------------------------------
   Part 2: the Apostate reveal and the phase-2 collapse.
   ------------------------------------------------------------------ */
async function runBoss(browser) {
  console.log("\n== apostate reveal + collapse ==");
  const page = await newPage(browser,
    `${BASE}/games/saintfall.html?qa=1&boss=apostate&seed=freeze`);

  const result = await page.evaluate(async () => {
    const T = window.__SF;
    const P = window.__freezeProbe;
    T.maximize();
    const boot = document.getElementById("sf-boot");
    if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
    T.hideHud(true);
    for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);

    const baseline = { programs: P.programs(), census: P.census() };
    const stepTimed = (seconds) => {
      let worst = 0;
      const steps = Math.ceil(seconds / 0.1);
      for (let i = 0; i < steps; i += 1) {
        T.advanceTime(0.1, 1 / 60);
        const t0 = performance.now();
        T.renderOnce(1 / 60);
        worst = Math.max(worst, performance.now() - t0);
      }
      return Number(worst.toFixed(1));
    };

    // The spawn is 18m out; the reveal trips on proximity inside the
    // nave. Step until the phase moves, then ride the reveal out.
    let revealWorst = 0;
    for (let i = 0; i < 100; i += 1) {
      revealWorst = Math.max(revealWorst, stepTimed(0.2));
      const phase = T.apostateState()?.phase;
      if (phase && phase !== "dormant" && phase !== "alert") break;
    }
    revealWorst = Math.max(revealWorst, stepTimed(3));
    const afterReveal = {
      programs: P.programs(), census: P.census(),
      phase: T.apostateState()?.phase, worstMs: revealWorst,
    };
    const revealShot = T.captureDataURL();

    // Phase 2: force the collapse and ride fracture -> fall -> settle
    // -> live (2.4 + 3.4 + 2.6s plus slack).
    const began = T.undercroftCollapse();
    const collapseWorst = stepTimed(12);
    const afterCollapse = {
      programs: P.programs(), census: P.census(),
      undercroft: T.undercroftState()?.phase, worstMs: collapseWorst,
      began,
    };
    const caveShot = T.captureDataURL();

    return { baseline, afterReveal, afterCollapse, revealShot, caveShot };
  });

  console.log(`baseline: ${result.baseline.programs.lit} lit + `
    + `${result.baseline.programs.depth} depth programs, `
    + `lights ${censusText(result.baseline.census)}`);
  console.log(`  reveal   -> phase ${result.afterReveal.phase}, `
    + `programs ${result.afterReveal.programs.lit}+${result.afterReveal.programs.depth}d, `
    + `lights ${censusText(result.afterReveal.census)}, `
    + `worst frame ${result.afterReveal.worstMs}ms`);
  console.log(`  collapse -> undercroft ${result.afterCollapse.undercroft}, `
    + `programs ${result.afterCollapse.programs.lit}+${result.afterCollapse.programs.depth}d, `
    + `lights ${censusText(result.afterCollapse.census)}, `
    + `worst frame ${result.afterCollapse.worstMs}ms`);

  check(result.afterReveal.phase && result.afterReveal.phase !== "dormant",
    "the reveal actually ran");
  check(result.afterCollapse.began === true, "undercroft collapse began");
  check(["live", "settle", "fall"].includes(result.afterCollapse.undercroft),
    `undercroft reached the chamber (phase ${result.afterCollapse.undercroft})`);
  check(result.afterReveal.programs.lit === result.baseline.programs.lit,
    `no LIT shader compiled at the reveal (lit delta ${
      result.afterReveal.programs.lit - result.baseline.programs.lit})`);
  check(result.afterCollapse.programs.lit === result.baseline.programs.lit,
    `no LIT shader compiled at the collapse (lit delta ${
      result.afterCollapse.programs.lit - result.baseline.programs.lit})`);
  check(result.afterCollapse.programs.depth - result.baseline.programs.depth <= 1,
    `at most one stray depth variant across reveal+collapse (depth delta ${
      result.afterCollapse.programs.depth - result.baseline.programs.depth})`);
  check(sameCensus(result.afterReveal.census, result.baseline.census)
    && sameCensus(result.afterCollapse.census, result.baseline.census),
    "visible-light census constant through reveal and collapse");

  const revealBuf = toBuf(result.revealShot);
  const caveBuf = toBuf(result.caveShot);
  await writeFile(path.join(OUT, `${TAG}-reveal.png`), revealBuf);
  await writeFile(path.join(OUT, `${TAG}-undercroft.png`), caveBuf);
  const caveLuma = await meanLuma(caveBuf);
  console.log(`  undercroft frame mean luma ${caveLuma.toFixed(1)}`);
  check(caveLuma > 8,
    "the undercroft is lit (scene-parented lamps still land in the room)");
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
        "--enable-unsafe-swiftshader", "--mute-audio",
        "--autoplay-policy=no-user-gesture-required"],
    });
    await runIntro(browser);
    await runBoss(browser);
    console.log(failures === 0
      ? "\nALL CHECKS PASSED"
      : `\n${failures} CHECK(S) FAILED`);
    if (failures) process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
