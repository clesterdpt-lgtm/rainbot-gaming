#!/usr/bin/env node
/* ============================================================
   SAINTFALL - hitch and black-frame probe

   Two symptoms are reported that no existing harness can see:
   stutter/freeze on first use of an ability, and random BLACK
   FRAMES. Both are properties of what the compositor PRESENTS, so
   this probe watches that surface directly:

   - CDP `Page.startScreencast` captures the frames the browser
     actually composites. Reading the canvas back instead would
     require preserveDrawingBuffer, which is one of the variables
     under test - the instrument would change the experiment.
   - An in-page rAF meter records presented cadence, and wraps
     `setRenderScale` so every dynamic-resolution reallocation is
     timestamped. A hitch can then be attributed instead of guessed.

   The script drives real abilities on the player path (no ?qa) and
   reports every stall over a threshold with what it coincided with.

   Usage:
     node scripts/saintfall-hitch-probe.mjs
     node scripts/saintfall-hitch-probe.mjs --headed
     node scripts/saintfall-hitch-probe.mjs --dynres 0
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(root, "output/saintfall/hitch");
const argv = process.argv.slice(2);
const HEADED = argv.includes("--headed");
const DYNRES = argv.includes("--dynres") ? argv[argv.indexOf("--dynres") + 1] : null;
const STALL_MS = argv.includes("--stall")
  ? Number(argv[argv.indexOf("--stall") + 1]) : 60;
const SHADOW_EVERY = argv.includes("--shadow-every")
  ? Number(argv[argv.indexOf("--shadow-every") + 1]) : null;
const VW = argv.includes("--width") ? Number(argv[argv.indexOf("--width") + 1]) : 1600;
const VH = argv.includes("--height") ? Number(argv[argv.indexOf("--height") + 1]) : 900;
const PORT = 49200 + (process.pid % 400);
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
    try {
      const res = await fetch(`${BASE}/games/saintfall.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* The in-page instrument. Installed before any ability is used. */
const INSTRUMENT = () => {
  const T = window.__SF;
  const log = {
    frames: [],        // {t, dt}
    events: [],        // {t, kind, detail}
    started: performance.now(),
  };
  window.__hitch = log;
  const mark = (kind, detail) => log.events.push({
    t: performance.now() - log.started, kind, detail: detail ?? null,
  });
  window.__hitchMark = mark;

  /* Every dynamic-resolution step reallocates the whole target chain.
     Guarded so this same probe runs against builds from before that
     control loop existed - which is how "did I introduce the black
     frames?" gets an answer instead of an opinion. */
  if (typeof T.render.setRenderScale === "function") {
    const origScale = T.render.setRenderScale.bind(T.render);
    T.render.setRenderScale = (s) => {
      const before = T.render.renderScale;
      const t0 = performance.now();
      const r = origScale(s);
      const cost = performance.now() - t0;
      if (Math.abs(r - before) > 1e-4) {
        mark("realloc", { from: Number(before.toFixed(3)), to: Number(r.toFixed(3)),
          costMs: Number(cost.toFixed(2)) });
      }
      return r;
    };
  }

  /* Programs-per-frame is the decisive test for "was that stall a
     shader compile?". A compile shows as the count stepping up on
     exactly the stalling frame; anything else does not. */
  const info = T.render.renderer.info;
  log.programsAtStart = info.programs ? info.programs.length : 0;

  /* And an in-page readback of the DRAWING BUFFER, so a black frame
     can be attributed. If the canvas reads non-black here while the
     compositor screencast shows black, the picture is fine and the
     PRESENTATION is dropping it - a completely different bug from the
     renderer producing a black image. Costs a GPU sync per frame, so
     this is a diagnostic build only. */
  const gl = T.render.renderer.getContext();
  const px = new Uint8Array(4 * 64);

  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    let mean = -1;
    try {
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1,
        8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = 0;
      for (let i = 0; i < 64; i += 1) {
        s += px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722;
      }
      mean = s / 64;
    } catch (_) { /* context lost or readback refused */ }
    log.frames.push({
      t: now - log.started,
      dt: now - last,
      progs: info.programs ? info.programs.length : 0,
      canvasMean: Number(mean.toFixed(1)),
      scale: T.render.renderScale ?? 1,
    });
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: !HEADED,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({
      viewport: { width: VW, height: VH }, deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    const url = `${BASE}/games/saintfall.html?intro=0&time=goldenhour`
      + (DYNRES !== null ? `&dynres=${DYNRES}` : "");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
      const T = window.__SF;
      T.teleport(-14, 700, 0);
      // A real firefight around the player: the load the controller is
      // meant to react to, and the population whose VFX compile on first
      // hit. An empty dune never triggers either symptom.
      for (let i = 0; i < 22; i += 1) {
        const a = (i / 22) * Math.PI * 2;
        T.spawnEnemy("thresher", -14 + Math.cos(a) * (16 + (i % 5) * 4),
          700 + Math.sin(a) * (16 + (i % 5) * 4));
      }
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        T.spawnEnemy("gleaner", -14 + Math.cos(a) * 36, 700 + Math.sin(a) * 36);
      }
    });
    if (SHADOW_EVERY !== null) {
      await page.evaluate((n) => window.__SF.render.setShadowEvery?.(n), SHADOW_EVERY);
      console.log(`forced shadowEvery=${SHADOW_EVERY}`);
    }
    await page.evaluate(INSTRUMENT);
    await delay(1200);   // settle before recording

    /* ---- capture what the COMPOSITOR presents ---- */
    const cdp = await context.newCDPSession(page);
    const shots = [];
    cdp.on("Page.screencastFrame", async (f) => {
      shots.push({ t: Date.now(), data: f.data });
      try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); }
      catch (_) { /* session closing */ }
    });
    const t0Wall = Date.now();
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, everyNthFrame: 1 });

    /* ---- drive the real abilities ---- */
    const script = [
      ["walk forward", async () => { await page.keyboard.down("w"); await delay(2500); }],
      ["AEGIS SHIELD first use", async () => {
        await page.evaluate(() => window.__hitchMark("shield-on"));
        await page.evaluate(() => window.__SF.setShieldInput(true));
        await delay(2000);
        await page.evaluate(() => window.__SF.setShieldInput(false));
        await page.evaluate(() => window.__hitchMark("shield-off"));
        await delay(1200);
      }],
      ["shield second use", async () => {
        await page.evaluate(() => window.__hitchMark("shield2-on"));
        await page.evaluate(() => window.__SF.setShieldInput(true));
        await delay(1500);
        await page.evaluate(() => window.__SF.setShieldInput(false));
        await delay(1000);
      }],
      ["JETPACK first use", async () => {
        await page.evaluate(() => window.__hitchMark("jet-on"));
        await page.evaluate(() => window.__SF.setJetInput(true));
        await delay(2200);
        await page.evaluate(() => window.__SF.setJetInput(false));
        await delay(1800);
      }],
      ["FIRE first shots", async () => {
        await page.evaluate(() => window.__hitchMark("fire"));
        await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__SF.shoot?.(); });
        await delay(1800);
      }],
    ];
    for (const [label, fn] of script) {
      await page.evaluate((l) => window.__hitchMark("phase", l), label);
      await fn();
    }
    await page.keyboard.up("w");
    await delay(800);

    await cdp.send("Page.stopScreencast").catch(() => {});
    const log = await page.evaluate(() => window.__hitch);
    await page.close();

    /* ---- analyse presented frames for black flashes ---- */
    console.log(`\ncaptured ${shots.length} composited frames`);
    const lum = [];
    for (let i = 0; i < shots.length; i += 1) {
      const buf = Buffer.from(shots[i].data, "base64");
      // Mean of a 1x1 resize is the frame's average luminance.
      const { data } = await sharp(buf).resize(1, 1, { fit: "fill" })
        .raw().toBuffer({ resolveWithObject: true });
      const mean = (data[0] * 0.2126 + data[1] * 0.7152 + data[2] * 0.0722);
      lum.push({ i, tRel: shots[i].t - t0Wall, mean, raw: buf });
    }
    const bright = lum.filter((f) => f.mean > 8);
    const median = bright.length
      ? [...bright].sort((a, b) => a.mean - b.mean)[Math.floor(bright.length / 2)].mean
      : 0;
    // A black flash is a presented frame far darker than the run's norm.
    const black = lum.filter((f) => f.mean < Math.max(6, median * 0.35));
    console.log(`median presented luminance ${median.toFixed(1)}`);
    console.log(`BLACK/near-black presented frames: ${black.length}`);
    for (const f of black.slice(0, 12)) {
      console.log(`   frame ${f.i} at t+${(f.tRel / 1000).toFixed(2)}s  mean ${f.mean.toFixed(1)}`);
    }
    for (let i = 0; i < Math.min(black.length, 4); i += 1) {
      await writeFile(path.join(OUT, `black-${black[i].i}.jpg`), black[i].raw);
    }

    /* ---- analyse cadence ---- */
    /* Did the canvas itself ever go black, or only the presented
       frame? These two answers have different fixes. */
    const dark = log.frames.filter((f) => f.canvasMean >= 0 && f.canvasMean < 6);
    console.log(`\nin-page canvas readback: ${dark.length} near-black frame(s) `
      + `of ${log.frames.length}`);
    for (const d of dark.slice(0, 8)) {
      console.log(`   t+${(d.t / 1000).toFixed(2)}s  mean ${d.canvasMean}  dt ${d.dt.toFixed(0)}ms`);
    }
    console.log(`programs: ${log.programsAtStart} at record start -> `
      + `${log.frames.length ? log.frames[log.frames.length - 1].progs : "?"} at end`);

    const stalls = log.frames.filter((f) => f.dt > STALL_MS);
    console.log(`\nframe stalls over ${STALL_MS}ms: ${stalls.length}`);
    for (const s of stalls) {
      const i = log.frames.indexOf(s);
      const prev = i > 0 ? log.frames[i - 1].progs : s.progs;
      if (s.progs !== prev) {
        console.log(`   >> t+${(s.t / 1000).toFixed(2)}s COMPILED `
          + `${s.progs - prev} program(s) on this frame`);
      }
    }
    const near = (t) => log.events
      .filter((e) => Math.abs(e.t - t) < 900)
      .map((e) => e.kind === "realloc"
        ? `realloc ${e.detail.from}->${e.detail.to} (${e.detail.costMs}ms)`
        : `${e.kind}${e.detail && typeof e.detail === "string" ? ` ${e.detail}` : ""}`)
      .join(", ");
    for (const s of stalls.slice(0, 20)) {
      console.log(`   t+${(s.t / 1000).toFixed(2)}s  ${s.dt.toFixed(0)}ms   [${near(s.t) || "-"}]`);
    }
    /* Derived from the per-frame scale, NOT from the wrapper on the
       exported setRenderScale: the controller calls its own closure,
       so that wrapper never fires and reported zero reallocations
       while two were happening in front of it. Read the state, not
       the call. */
    const steps = [];
    for (let i = 1; i < log.frames.length; i += 1) {
      if (Math.abs(log.frames[i].scale - log.frames[i - 1].scale) > 1e-4) {
        steps.push({ t: log.frames[i].t, from: log.frames[i - 1].scale,
          to: log.frames[i].scale, mean: log.frames[i].canvasMean });
      }
    }
    console.log(`\nresolution steps (from per-frame state): ${steps.length}`);
    for (const s of steps) {
      console.log(`   t+${(s.t / 1000).toFixed(2)}s  ${s.from.toFixed(3)} -> ${s.to.toFixed(3)}`
        + `   canvas mean on that frame ${s.mean}${s.mean === 0 ? "   <-- BLACK" : ""}`);
    }
    if (pageErrors.length) {
      console.log(`\npage errors: ${pageErrors.length}`);
      for (const e of pageErrors.slice(0, 3)) console.log(`   ${e.slice(0, 200)}`);
    }
    await writeFile(path.join(OUT, "log.json"),
      JSON.stringify({ log, black: black.map(({ raw, ...r }) => r) }, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
