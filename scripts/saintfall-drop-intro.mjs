#!/usr/bin/env node
/* Deterministic release gate for Saintfall's orbital drop cinematic.

   The intro owns a separate scene and clock, so this harness deliberately
   uses only the intro-specific __SF controls. Calling renderStill() or
   advanceTime() here would step gameplay and overwrite the cinematic frame.

   Coverage:
     - legacy ?qa=1 bypass remains immediately playable
     - desktop and true-touch portrait/landscape contexts
     - pre-gesture input/audio lock and a real click/tap audio unlock
     - every authored timeline marker, direct WebGL captures, DOM captures,
       semantic state, renderer diagnostics, pixel metrics, and frame timing
     - natural handoff, idempotent skip, HUD/touch restoration, and movement
     - first-frame camera/pixel continuity and timeline-inclusive frame timing
     - real-clock cues, composed pause reasons, async audio resume ordering
     - prefers-reduced-motion timing, VFX, CSS, and production disposal

   Usage:
     node scripts/saintfall-drop-intro.mjs
     node scripts/saintfall-drop-intro.mjs --headed
     node scripts/saintfall-drop-intro.mjs --profiles desktop,touch-portrait
     node scripts/saintfall-drop-intro.mjs --out output/saintfall/my-intro-proof
*/

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(root,
  String(args.out || `output/saintfall/drop-intro-qa/${runId}`));
const port = Number(args.port || 48000 + (process.pid % 1400));
const baseUrl = `http://127.0.0.1:${port}`;
const headed = Boolean(args.headed);

const allProfiles = [
  {
    id: "desktop", width: 1280, height: 720, dpr: 1,
    isMobile: false, hasTouch: false, reducedMotion: "no-preference",
  },
  {
    id: "touch-portrait", width: 390, height: 844, dpr: 2,
    isMobile: true, hasTouch: true, reducedMotion: "no-preference",
  },
  {
    id: "touch-landscape", width: 844, height: 390, dpr: 2,
    isMobile: true, hasTouch: true, reducedMotion: "no-preference",
  },
  {
    id: "desktop-reduced-motion", width: 1280, height: 720, dpr: 1,
    isMobile: false, hasTouch: false, reducedMotion: "reduce",
  },
  {
    id: "touch-portrait-reduced-motion", width: 390, height: 844, dpr: 2,
    isMobile: true, hasTouch: true, reducedMotion: "reduce",
  },
];

const selectedIds = args.profiles
  ? new Set(String(args.profiles).split(",").map((id) => id.trim()).filter(Boolean))
  : null;
const profiles = selectedIds
  ? allProfiles.filter((profile) => selectedIds.has(profile.id))
  : allProfiles;
if (!profiles.length) throw new Error("--profiles did not match a known profile");

const markerSpecs = [
  { id: "standby", marker: 0, sample: 0, phase: "restrained", shot: "orbit" },
  { id: "release", marker: 1.5, sample: 1.75, phase: "release", shot: "orbit" },
  { id: "orbit", marker: 3.2, sample: 3.55, phase: "orbit", shot: "orbit" },
  { id: "entry", marker: 5.0, sample: 5.4, phase: "entry", shot: "orbit", plasma: true },
  { id: "turbulence", marker: 8.6, sample: 8.95, phase: "turbulence", shot: "orbit", plasma: true },
  {
    id: "cloudBreak", marker: 11.8, sample: 12.2, phase: "cloud-break",
    shot: "descent", plasma: false, clouds: true, live: true,
  },
  {
    id: "terminal", marker: 15.0, sample: 15.45, phase: "terminal",
    shot: "descent", live: true, minVelocity: 1000,
  },
  {
    id: "impact", marker: 17.9, sample: 18.15, phase: "impact",
    shot: "surface", dust: true, shockwave: true, live: true,
    siteErrorMax: 0.05,
  },
  {
    id: "hatch", marker: 19.3, sample: 20.4, phase: "hatch",
    shot: "surface", hatchMin: 0.05, live: true, petalsMin: 0.5,
  },
  {
    id: "egress", marker: 21.1, sample: 21.5, phase: "egress",
    shot: "egress", live: true, petalsMin: 0.99, trooper: true,
  },
];

const expectedMarkers = Object.freeze({
  standby: 0,
  release: 1.5,
  orbit: 3.2,
  entry: 5.0,
  turbulence: 8.6,
  cloudBreak: 11.8,
  terminal: 15.0,
  impact: 17.9,
  hatch: 19.3,
  egress: 21.1,
  handoff: 23.6,
});

/* Two sets, because the cinematic has two halves with genuinely
   different costs. The orbital act draws an isolated scene of its own
   and is budgeted tightly. From cloud-break onward the camera is
   inside the REAL level, so the renderer's census is the level's
   census - gating that against an intro-sized budget would either
   fail every descent frame or force the number so wide it stopped
   meaning anything. What stays tight there is `scene`, which reports
   only the cinematic's OWN meshes, materials and triangles. */
const budgets = Object.freeze({
  desktopP95Ms: 22,
  touchP95Ms: 33,
  sceneCalls: 140,
  sceneTriangles: 220000,
  scenePoints: 4000,
  sceneMaterials: 72,
  liveCalls: 340,
  liveTriangles: 1000000,
  livePoints: 200000,
  liveOwnMeshes: 130,
  liveOwnMaterials: 24,
});

const requiredHooks = [
  "introState", "introMarkers", "startIntroForQA", "seekIntroForQA",
  "advanceIntroForQA", "setIntroPausedForQA", "skipIntroForQA",
  "renderIntroStill", "audioState", "captureDataURL", "report",
];

function addCheck(scope, id, pass, actual, expected) {
  scope.checks.push({ id, pass: Boolean(pass), actual, expected });
  return Boolean(pass);
}

function round(value, places = 3) {
  return Number(Number(value).toFixed(places));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1,
    Math.floor((sorted.length - 1) * p))];
}

function distance(a, b) {
  return Math.hypot(
    Number(a?.x || 0) - Number(b?.x || 0),
    Number(a?.y || 0) - Number(b?.y || 0),
    Number(a?.z || 0) - Number(b?.z || 0),
  );
}

function dataUrlBuffer(dataUrl) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

async function analyseImage(buffer) {
  const image = sharp(buffer).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const pixels = data.length / info.channels;
  const lumaHistogram = new Uint32Array(32);
  const colourBins = new Uint8Array(4096);
  let sum = 0;
  let sumSq = 0;
  let nonBlack = 0;
  let clippedLow = 0;
  let clippedHigh = 0;
  let colourfulness = 0;

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    sum += luma;
    sumSq += luma * luma;
    if (luma > 3) nonBlack += 1;
    if (luma <= 2) clippedLow += 1;
    if (luma >= 253) clippedHigh += 1;
    colourfulness += Math.max(r, g, b) - Math.min(r, g, b);
    lumaHistogram[Math.min(31, Math.floor(luma / 8))] += 1;
    colourBins[((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)] = 1;
  }

  const mean = sum / pixels;
  const stdDev = Math.sqrt(Math.max(0, sumSq / pixels - mean * mean));
  const tonalRange = lumaHistogram.reduce(
    (count, value) => count + (value > pixels * 0.0002 ? 1 : 0), 0);
  const uniqueColourBins = colourBins.reduce((count, used) => count + used, 0);

  const edgeImage = await sharp(buffer).greyscale()
    .resize(320, 180, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let edges = 0;
  const ew = edgeImage.info.width;
  const eh = edgeImage.info.height;
  const gray = edgeImage.data;
  for (let y = 1; y < eh - 1; y += 1) {
    for (let x = 1; x < ew - 1; x += 1) {
      const at = y * ew + x;
      const gx = gray[at + 1] - gray[at - 1];
      const gy = gray[at + ew] - gray[at - ew];
      if (Math.hypot(gx, gy) > 20) edges += 1;
    }
  }

  return {
    width: info.width,
    height: info.height,
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    meanLuma: round(mean, 2),
    stdDevLuma: round(stdDev, 2),
    nonBlackPct: round(nonBlack / pixels * 100, 3),
    clippedLowPct: round(clippedLow / pixels * 100, 3),
    clippedHighPct: round(clippedHigh / pixels * 100, 3),
    saturation: round(colourfulness / pixels, 2),
    tonalRange,
    uniqueColourBins,
    edgeDensityPct: round(edges / (ew * eh) * 100, 3),
  };
}

async function changedPixelPct(before, after) {
  const [a, b] = await Promise.all([before, after].map((buffer) => sharp(buffer)
    .removeAlpha().resize(320, 180, { fit: "fill" }).raw().toBuffer()));
  let changed = 0;
  const pixels = a.length / 3;
  for (let offset = 0; offset < a.length; offset += 3) {
    const delta = Math.max(
      Math.abs(a[offset] - b[offset]),
      Math.abs(a[offset + 1] - b[offset + 1]),
      Math.abs(a[offset + 2] - b[offset + 2]),
    );
    if (delta > 12) changed += 1;
  }
  return round(changed / pixels * 100, 3);
}

function makeUrl({ intro = true, touch = false, manual = true, qa = true } = {}) {
  const params = new URLSearchParams({ quality: "high", seed: "drop-intro-qa" });
  if (qa) params.set("qa", "1");
  if (intro) {
    params.set("intro", qa ? "force" : "1");
    if (manual) params.set("introClock", "manual");
  }
  if (touch) params.set("touch", "1");
  return `${baseUrl}/games/saintfall.html?${params}`;
}

function pageDiagnostics() {
  return { consoleErrors: [], warnings: [], pageErrors: [], httpErrors: [], requestFailures: [] };
}

function watchPage(page, diagnostics) {
  page.on("console", (message) => {
    const entry = {
      type: message.type(),
      text: message.text(),
      location: message.location(),
    };
    if (message.type() === "error") diagnostics.consoleErrors.push(entry);
    else if (message.type() === "warning") diagnostics.warnings.push(entry);
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push({
    message: error.message,
    stack: error.stack || "",
  }));
  page.on("response", (response) => {
    if (response.status() >= 400) diagnostics.httpErrors.push({
      status: response.status(), url: response.url(),
    });
  });
  page.on("requestfailed", (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || "unknown",
  }));
}

function addDiagnosticChecks(scope, diagnostics) {
  const unexpectedFailures = diagnostics.requestFailures.filter(
    (failure) => failure.error !== "net::ERR_ABORTED");
  addCheck(scope, "console-errors", diagnostics.consoleErrors.length === 0,
    diagnostics.consoleErrors, "none");
  addCheck(scope, "page-errors", diagnostics.pageErrors.length === 0,
    diagnostics.pageErrors, "none");
  addCheck(scope, "http-errors", diagnostics.httpErrors.length === 0,
    diagnostics.httpErrors, "none");
  addCheck(scope, "network-failures", unexpectedFailures.length === 0,
    unexpectedFailures, "none (ERR_ABORTED is recorded but ignored)");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/games/saintfall.html`, { cache: "no-store" });
      if (response.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`Static server did not start at ${baseUrl}`);
}

async function bootIntroPage(context, profile, diagnostics) {
  const page = await context.newPage();
  watchPage(page, diagnostics);
  const url = makeUrl({ intro: true, touch: profile.hasTouch });
  const started = performance.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.getElementById("sf-boot")
    && document.querySelector(".sf-stage.sf-intro-active"), null, { timeout: 300000 });
  const loaderShield = await page.evaluate(() => {
    const canvas = document.getElementById("sf-canvas");
    const stage = document.querySelector(".sf-stage");
    return {
      bootPresent: Boolean(document.getElementById("sf-boot")),
      stageIntroActive: stage?.classList.contains("sf-intro-active"),
      canvasPointerEvents: canvas ? getComputedStyle(canvas).pointerEvents : null,
      pointerLockElement: document.pointerLockElement?.id || null,
    };
  });
  await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });
  await page.evaluate(() => window.__SF.maximize());
  await page.waitForTimeout(80);
  return { page, url, bootMs: round(performance.now() - started, 1), loaderShield };
}

async function inspectPreGesture(page) {
  return page.evaluate((hooks) => {
    const T = window.__SF;
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: Number(value.left.toFixed(2)), top: Number(value.top.toFixed(2)),
        right: Number(value.right.toFixed(2)), bottom: Number(value.bottom.toFixed(2)),
        width: Number(value.width.toFixed(2)), height: Number(value.height.toFixed(2)),
      };
    };
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0.01 && box.width > 0 && box.height > 0;
    };
    const stage = document.querySelector(".sf-stage");
    const intro = document.getElementById("sf-intro");
    const start = document.querySelector("[data-intro-start]");
    const skip = document.querySelector("[data-intro-skip]");
    const hud = document.getElementById("sf-hud");
    const boot = document.getElementById("sf-boot");
    const style = getComputedStyle(intro);
    const backgroundHit = document.elementFromPoint(8, Math.max(8, innerHeight * 0.5));
    const params = Object.fromEntries(new URL(location.href).searchParams.entries());
    return {
      hooks: Object.fromEntries(hooks.map((name) => [name, typeof T[name]])),
      query: params,
      status: T.introState(),
      report: T.report(),
      audio: T.audioState(),
      runtime: { ...T.ctx.runtime },
      player: { ...T.report().player },
      combat: T.combatState(),
      mission: T.missionState(),
      touch: T.touchState(),
      navigator: {
        maxTouchPoints: navigator.maxTouchPoints,
        coarse: matchMedia("(pointer: coarse)").matches,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        userActivation: {
          active: navigator.userActivation?.isActive ?? false,
          hasBeenActive: navigator.userActivation?.hasBeenActive ?? false,
        },
      },
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      layout: {
        stage: rect(stage), intro: rect(intro), start: rect(start), skip: rect(skip),
        startVisible: visible(start),
        skipDisabled: !!skip?.disabled,
        introAriaHidden: intro?.getAttribute("aria-hidden"),
        introPosition: style.position,
        introZIndex: style.zIndex,
        introPointerEvents: style.pointerEvents,
        canvasPointerEvents: getComputedStyle(document.getElementById("sf-canvas")).pointerEvents,
        backgroundHitInsideIntro: Boolean(backgroundHit
          && (backgroundHit === intro || intro?.contains(backgroundHit))),
        backgroundHit: backgroundHit?.id || backgroundHit?.className || backgroundHit?.tagName || null,
        bootPresent: Boolean(boot),
        stageIntroActive: stage?.classList.contains("sf-intro-active"),
        hudDisplay: hud ? getComputedStyle(hud).display : null,
      },
    };
  }, requiredHooks);
}

function rectInside(inner, outer, tolerance = 1.5) {
  return Boolean(inner && outer
    && inner.left >= outer.left - tolerance
    && inner.top >= outer.top - tolerance
    && inner.right <= outer.right + tolerance
    && inner.bottom <= outer.bottom + tolerance);
}

async function realStart(page, profile) {
  const button = page.locator("[data-intro-start]");
  if (profile.hasTouch) await button.tap({ timeout: 10000 });
  else await button.click({ timeout: 10000 });
  await page.waitForFunction(() => window.__SF.introState()?.started, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const audio = window.__SF.audioState();
    return audio.state === "running" && audio.cinematic?.active
      && audio.cinematic.sources > 0;
  }, null, { timeout: 10000 });
  try {
    await page.waitForFunction(() => {
      const cinematic = window.__SF.audioState().cinematic;
      return cinematic.buffers >= 8 || cinematic.loadErrors.length > 0;
    }, null, { timeout: 10000 });
  } catch (_) { /* recorded and gated from the final state */ }
  const state = await page.evaluate(() => ({
    status: window.__SF.introState(),
    audio: window.__SF.audioState(),
    runtime: { ...window.__SF.ctx.runtime },
    userActivation: {
      active: navigator.userActivation?.isActive ?? false,
      hasBeenActive: navigator.userActivation?.hasBeenActive ?? false,
    },
  }));
  return { ...state, gesture: profile.hasTouch ? "tap" : "click" };
}

async function captureMarker(page, spec, perfFrames) {
  return page.evaluate(({ marker, frames }) => {
    const T = window.__SF;
    const status = T.seekIntroForQA(marker);
    T.renderIntroStill();
    const gl = T.render.renderer.getContext();
    const finish = () => { if (typeof gl.finish === "function") gl.finish(); };
    finish();

    const frameMs = [];
    if (frames > 0) {
      const dt = 1 / 60;
      for (let i = 0; i < 3; i += 1) { T.advanceIntroForQA(dt, dt); finish(); }
      T.seekIntroForQA(marker);
      for (let i = 0; i < frames; i += 1) {
        const before = performance.now();
        // Advance and render together so this includes timeline math,
        // particle-buffer uploads, telemetry DOM writes and the GPU.
        T.advanceIntroForQA(dt, dt);
        finish();
        frameMs.push(performance.now() - before);
      }
      T.seekIntroForQA(marker);
    }
    T.renderIntroStill();
    finish();
    const canvas = T.render.renderer.domElement;
    return {
      status: T.introState() || status,
      audio: T.audioState(),
      report: T.report(),
      render: T.render.info(),
      frameMs,
      canvas: {
        css: [canvas.clientWidth, canvas.clientHeight],
        backing: [canvas.width, canvas.height],
        dpr: devicePixelRatio,
      },
      telemetry: {
        phase: document.querySelector("[data-intro-phase]")?.textContent?.trim() || "",
        title: document.querySelector("[data-intro-title]")?.textContent?.trim() || "",
        altitude: document.querySelector("[data-intro-alt]")?.textContent?.trim() || "",
        velocity: document.querySelector("[data-intro-vel]")?.textContent?.trim() || "",
        heat: document.querySelector("[data-intro-heat]")?.textContent?.trim() || "",
        signal: document.querySelector("[data-intro-signal]")?.textContent?.trim() || "",
      },
      image: T.captureDataURL(),
    };
  }, { marker: spec.sample, frames: perfFrames });
}

async function completeNaturally(page) {
  return page.evaluate(() => {
    const T = window.__SF;
    const before = T.introState();
    const canonicalRemaining = Math.max(0, before.duration - before.elapsed);
    const playbackRemaining = canonicalRemaining
      * (before.playbackDuration / before.duration) + 0.02;
    T.advanceIntroForQA(playbackRemaining, 1 / 120);
    T.renderIntroStill();
    const gl = T.render.renderer.getContext();
    if (typeof gl.finish === "function") gl.finish();
    const handoffImage = T.captureDataURL();
    /* THE CUT ITSELF: the live camera on the live scene with NOTHING
       simulated. If this is byte-identical to the last cinematic
       frame then the handoff is exact, which is the claim the
       cinematic is actually responsible for.

       The frame after it is not the same claim. `step()` advances the
       whole game once, and at dt=0 that still ticks frame-counted
       state deep in enemies and the mixer - a sub-code-value
       difference over zero changed pixels. Asserting byte equality
       THERE was asserting that the game's first simulation step is a
       no-op, which it never promised to be. */
    T.render.render(T.render.camera);
    if (typeof gl.finish === "function") gl.finish();
    const pureHandoffImage = T.captureDataURL();
    const cameraPose = (camera) => ({
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      fov: camera.fov,
    });
    const introCamera = cameraPose(T.intro.camera);
    const liveCameraBefore = cameraPose(T.render.camera);
    const immediate = {
      status: T.introState(),
      audio: T.audioState(),
      runtime: { ...T.ctx.runtime },
      player: { ...T.report().player },
      combat: T.combatState(),
      mission: T.missionState(),
      touch: T.touchState(),
      hudDisplay: getComputedStyle(document.getElementById("sf-hud")).display,
      stageIntroActive: document.querySelector(".sf-stage")?.classList.contains("sf-intro-active"),
    };
    // Retain the deterministic zero-delta proof, then separately capture
    // the browser's next genuinely presented animation frame below.
    T.renderOnce(0);
    if (typeof gl.finish === "function") gl.finish();
    const liveCameraAfter = cameraPose(T.render.camera);
    const positionDelta = Math.hypot(...introCamera.position.map(
      (value, index) => value - liveCameraAfter.position[index]));
    const dot = Math.abs(introCamera.quaternion.reduce(
      (sum, value, index) => sum + value * liveCameraAfter.quaternion[index], 0));
    const angularDelta = 2 * Math.acos(Math.min(1, dot));
    const result = {
      ...immediate,
      image: handoffImage,
      pureHandoffImage,
      firstGameplayImage: T.captureDataURL(),
      cameraContinuity: {
        intro: introCamera,
        liveBefore: liveCameraBefore,
        liveAfter: liveCameraAfter,
        positionDelta,
        angularDelta,
        fovDelta: Math.abs(introCamera.fov - liveCameraAfter.fov),
      },
    };
    /* Register the capture before yielding this browser task. That makes
       the already-scheduled game loop's held handoff frame the one we
       inspect, with no Playwright command gap in which another rAF can run. */
    return new Promise((resolve) => requestAnimationFrame(() => {
      if (typeof gl.finish === "function") gl.finish();
      const camera = T.render.camera;
      const gate = document.querySelector(".sf-intro__gate");
      const host = document.getElementById("sf-intro");
      resolve({
        ...result,
        firstPresentedFrame: {
          image: T.captureDataURL(),
          camera: {
            position: camera.position.toArray(),
            quaternion: camera.quaternion.toArray(),
            fov: camera.fov,
          },
          runtime: { ...T.ctx.runtime },
          gate: {
            hostOpacity: Number(getComputedStyle(host).opacity),
            opacity: Number(getComputedStyle(gate).opacity),
            visibility: getComputedStyle(gate).visibility,
            pointerEvents: getComputedStyle(gate).pointerEvents,
          },
        },
      });
    }));
  });
}

async function inspectRestored(page) {
  return page.evaluate(() => {
    const T = window.__SF;
    const intro = document.getElementById("sf-intro");
    return {
      status: T.introState(),
      audio: T.audioState(),
      runtime: { ...T.ctx.runtime },
      player: { ...T.report().player },
      touch: T.touchState(),
      hudDisplay: getComputedStyle(document.getElementById("sf-hud")).display,
      introAriaHidden: intro?.getAttribute("aria-hidden"),
      stageIntroActive: document.querySelector(".sf-stage")?.classList.contains("sf-intro-active"),
      gate: (() => {
        const gate = document.querySelector(".sf-intro__gate");
        if (!gate) return null;
        const style = getComputedStyle(gate);
        return { opacity: Number(style.opacity), visibility: style.visibility,
          pointerEvents: style.pointerEvents };
      })(),
    };
  });
}

async function verifyPostHandoffPause(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.body.classList.contains("rb-escape-menu-open")
    && window.__SF.ctx.runtime.paused && window.__SF.audioState().paused,
  null, { timeout: 5000 });
  const before = await page.evaluate(() => ({
    player: { ...window.__SF.report().player },
    mission: window.__SF.missionState(),
    runtime: { ...window.__SF.ctx.runtime },
    audio: window.__SF.audioState(),
  }));
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(450);
  await page.keyboard.up("KeyW");
  const after = await page.evaluate(() => ({
    player: { ...window.__SF.report().player },
    mission: window.__SF.missionState(),
    runtime: { ...window.__SF.ctx.runtime },
    audio: window.__SF.audioState(),
  }));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.body.classList.contains("rb-escape-menu-open")
    && !window.__SF.ctx.runtime.paused && !window.__SF.audioState().paused
    && window.__SF.audioState().state === "running", null, { timeout: 5000 });
  return {
    before, after,
    movedM: round(distance(before.player, after.player), 4),
    missionDelta: round(after.mission.elapsed - before.mission.elapsed, 4),
  };
}

async function measurePostHandoffMovement(context, page, profile) {
  await page.evaluate(() => window.__SF.invulnerable(true));
  const before = await page.evaluate(() => ({ ...window.__SF.report().player }));
  if (profile.hasTouch) {
    const box = await page.locator("[data-touch-stick]").boundingBox();
    if (!box) return { before, after: before, movedM: 0, input: "touch-stick-unavailable" };
    const session = await context.newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const endY = y - Math.min(box.width, box.height) * 0.42;
    const point = (py) => ({ x, y: py, id: 7, radiusX: 8, radiusY: 8, force: 0.8 });
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(y)] });
    for (let step = 1; step <= 5; step += 1) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove", touchPoints: [point(y + (endY - y) * step / 5)],
      });
      await page.waitForTimeout(35);
    }
    await page.waitForTimeout(320);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(420);
    await page.keyboard.up("KeyW");
  }
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({ ...window.__SF.report().player }));
  return {
    before, after, movedM: round(distance(before, after), 3),
    input: profile.hasTouch ? "cdp-touch-joystick" : "keyboard-KeyW",
  };
}

async function reducedMotionCss(page) {
  return page.evaluate(() => {
    const host = document.getElementById("sf-intro");
    const nodes = [host, ...host.querySelectorAll("*")];
    const toSeconds = (value) => String(value).split(",").reduce((max, token) => {
      const clean = token.trim();
      const seconds = clean.endsWith("ms") ? Number.parseFloat(clean) / 1000
        : Number.parseFloat(clean) || 0;
      return Math.max(max, seconds);
    }, 0);
    let maxAnimationSeconds = 0;
    let maxTransitionSeconds = 0;
    for (const node of nodes) {
      const style = getComputedStyle(node);
      maxAnimationSeconds = Math.max(maxAnimationSeconds, toSeconds(style.animationDuration));
      maxTransitionSeconds = Math.max(maxTransitionSeconds, toSeconds(style.transitionDuration));
    }
    return {
      mediaMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      maxAnimationSeconds,
      maxTransitionSeconds,
      scanDisplay: getComputedStyle(host.querySelector(".sf-intro__scan")).display,
      flashDisplay: getComputedStyle(host.querySelector(".sf-intro__flash")).display,
    };
  });
}

async function runProfile(browser, profile) {
  const scope = { id: profile.id, profile, checks: [], diagnostics: pageDiagnostics(), markers: [] };
  const profileDir = path.join(outDir, profile.id);
  await mkdir(profileDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    reducedMotion: profile.reducedMotion,
    colorScheme: "dark",
  });
  let page;
  try {
    const booted = await bootIntroPage(context, profile, scope.diagnostics);
    page = booted.page;
    scope.url = booted.url;
    scope.bootMs = booted.bootMs;
    scope.loaderShield = booted.loaderShield;
    const pre = await inspectPreGesture(page);
    scope.preGesture = pre;
    await page.locator(".sf-stage").screenshot({ path: path.join(profileDir, "00-pre-gesture-stage.png") });

    addCheck(scope, "public-intro-hooks",
      requiredHooks.every((name) => pre.hooks[name] === "function"), pre.hooks, "all functions");
    addCheck(scope, "force-query-contract",
      pre.query.qa === "1" && pre.query.intro === "force"
        && pre.query.introClock === "manual" && pre.query.seed === "drop-intro-qa",
      pre.query, "qa=1&intro=force&introClock=manual&seed=drop-intro-qa");
    addCheck(scope, "manual-clock-awaits-gesture",
      pre.status?.enabled && pre.status?.active && !pre.status?.started
        && pre.status?.manualClock && pre.status?.gameplayLocked
        && pre.status?.phase === "restrained",
      pre.status, "enabled, manual, locked, restrained, not started");
    addCheck(scope, "runtime-awaiting-deploy", pre.runtime.phase === "awaiting-deploy",
      pre.runtime, { phase: "awaiting-deploy" });
    // Headless Chromium may initialize Web Audio in `running` and report
    // sticky user activation before any Playwright action. Zero owned
    // sources/buffers is the portable pre-gesture contract; realStart then
    // performs a hit-tested click/tap and must populate the cinematic graph.
    addCheck(scope, "pre-gesture-audio-idle",
      !pre.audio.ambience && !pre.audio.cinematic.active
        && pre.audio.cinematic.sources === 0
        && pre.audio.cinematic.buffers === 0,
      { activation: pre.navigator.userActivation, audio: pre.audio },
      "no ambience, cinematic sources, or decoded buffers before Deploy");
    addCheck(scope, "hud-and-touch-suppressed",
      pre.layout.hudDisplay === "none" && pre.touch?.enabled === false,
      { hudDisplay: pre.layout.hudDisplay, touch: pre.touch },
      "HUD hidden and touch disabled while blocked");
    addCheck(scope, "intro-overlay-fills-stage",
      pre.layout.introPosition === "absolute"
        && rectInside(pre.layout.intro, pre.layout.stage)
        && rectInside(pre.layout.stage, {
          left: 0, top: 0, right: pre.viewport.width, bottom: pre.viewport.height,
        }, 2.5),
      pre.layout, "absolute intro and maxed stage within viewport");
    addCheck(scope, "start-control-usable",
      pre.layout.startVisible && rectInside(pre.layout.start, pre.layout.stage)
        && pre.layout.start.height >= 44 && pre.layout.skipDisabled,
      pre.layout.start, "visible, inside stage, >=44px high");
    addCheck(scope, "intro-accessibility-state",
      pre.layout.introAriaHidden === "false" && pre.layout.stageIntroActive,
      pre.layout, "aria-hidden=false and stage intro-active");
    addCheck(scope, "loader-handoff-complete",
      !pre.layout.bootPresent,
      pre.layout, "loader removed before Deploy gate is exposed");
    addCheck(scope, "loader-fade-pointer-shield",
      scope.loaderShield.bootPresent && scope.loaderShield.stageIntroActive
        && scope.loaderShield.canvasPointerEvents === "none"
        && scope.loaderShield.pointerLockElement === null,
      scope.loaderShield, "canvas pointer-inert before the loader has been removed");
    addCheck(scope, "intro-blocks-background-pointer",
      pre.layout.introPointerEvents === "auto" && pre.layout.canvasPointerEvents === "none"
        && pre.layout.backgroundHitInsideIntro,
      pre.layout, "full intro layer intercepts background clicks");
    addCheck(scope, "true-touch-context",
      profile.hasTouch
        ? pre.navigator.maxTouchPoints > 0 && pre.navigator.coarse && pre.query.touch === "1"
        : pre.navigator.maxTouchPoints === 0 && pre.query.touch === undefined,
      { navigator: pre.navigator, query: pre.query },
      profile.hasTouch ? "touch points, coarse pointer, touch=1" : "desktop pointer");
    addCheck(scope, "motion-preference",
      pre.navigator.reducedMotion === (profile.reducedMotion === "reduce")
        && pre.status.reducedMotion === (profile.reducedMotion === "reduce"),
      { navigator: pre.navigator.reducedMotion, status: pre.status.reducedMotion },
      profile.reducedMotion === "reduce");

    // Inject intent without a browser gesture: a real keydown would unlock
    // Web Audio before the authored Deploy control gets its chance to do so.
    await page.evaluate(() => window.__SF.player.input.inject(0, -1));
    await page.waitForTimeout(160);
    await page.evaluate(() => window.__SF.player.input.inject(null, null));
    const lockedProbe = await page.evaluate(() => ({
      player: { ...window.__SF.report().player },
      combat: window.__SF.combatState(),
      mission: window.__SF.missionState(),
      status: window.__SF.introState(),
    }));
    addCheck(scope, "gameplay-frozen-before-gesture",
      distance(pre.player, lockedProbe.player) < 0.001
        && pre.combat.hp === lockedProbe.combat.hp
        && pre.mission.elapsed === lockedProbe.mission.elapsed
        && lockedProbe.status.elapsed === 0,
      { before: { player: pre.player, combat: pre.combat, mission: pre.mission }, after: lockedProbe },
      "no player, health, mission, or intro-clock movement");

    const afterStart = await realStart(page, profile);
    scope.afterStart = afterStart;
    addCheck(scope, "real-gesture-starts-cinematic",
      afterStart.status.started && afterStart.status.active
        && afterStart.status.gameplayLocked && afterStart.runtime.phase === "intro"
        && await page.locator("[data-intro-skip]").isEnabled(),
      afterStart, "started, active, locked, runtime phase intro");
    addCheck(scope, "gesture-unlocks-audio",
      afterStart.gesture === (profile.hasTouch ? "tap" : "click")
        && afterStart.audio.state === "running" && afterStart.audio.cinematic.active
        && afterStart.audio.cinematic.sources > 0
        && afterStart.audio.cinematic.buffers >= 8
        && afterStart.audio.cinematic.loadErrors.length === 0,
      { activation: afterStart.userActivation, audio: afterStart.audio },
      "hit-tested click/tap; running; sources >0; 8 buffers; no load errors");

    if (profile.reducedMotion === "reduce") {
      scope.reducedMotionCss = await reducedMotionCss(page);
      addCheck(scope, "reduced-motion-css",
        scope.reducedMotionCss.mediaMatches
          && scope.reducedMotionCss.maxAnimationSeconds <= 0.001
          && scope.reducedMotionCss.maxTransitionSeconds <= 0.001
          && scope.reducedMotionCss.scanDisplay === "none"
          && scope.reducedMotionCss.flashDisplay === "none",
        scope.reducedMotionCss, "no intro animation/transition; scan and flash hidden");
    }

    const markers = await page.evaluate(() => window.__SF.introMarkers());
    scope.markerContract = markers;
    addCheck(scope, "marker-contract",
      JSON.stringify(markers) === JSON.stringify(expectedMarkers), markers, expectedMarkers);

    const buffers = new Map();
    let priorAltitude = Number.POSITIVE_INFINITY;
    for (let index = 0; index < markerSpecs.length; index += 1) {
      const spec = markerSpecs[index];
      const perfFrames = (spec.id === "entry" || spec.id === "impact")
        ? (profile.hasTouch ? 16 : 24) : 0;
      const captured = await captureMarker(page, spec, perfFrames);
      const buffer = dataUrlBuffer(captured.image);
      const fileStem = `${String(index + 1).padStart(2, "0")}-${spec.id}`;
      const webglPath = path.join(profileDir, `${fileStem}-webgl.png`);
      const stagePath = path.join(profileDir, `${fileStem}-stage.png`);
      await writeFile(webglPath, buffer);
      await page.waitForTimeout(30);
      await page.evaluate(() => window.__SF.renderIntroStill());
      await page.locator(".sf-stage").screenshot({ path: stagePath });
      const image = await analyseImage(buffer);
      buffers.set(spec.id, buffer);
      const perf = captured.frameMs.length ? {
        frames: captured.frameMs.length,
        p50Ms: round(percentile(captured.frameMs, 0.5), 2),
        p95Ms: round(percentile(captured.frameMs, 0.95), 2),
        maxMs: round(Math.max(...captured.frameMs), 2),
        overBudget: captured.frameMs.filter((value) => value
          > (profile.hasTouch ? budgets.touchP95Ms : budgets.desktopP95Ms)).length,
      } : null;
      const marker = {
        id: spec.id,
        marker: spec.marker,
        sample: spec.sample,
        status: captured.status,
        audio: captured.audio,
        render: captured.render,
        canvas: captured.canvas,
        telemetry: captured.telemetry,
        image,
        perf,
        files: {
          webgl: path.relative(root, webglPath),
          stage: path.relative(root, stagePath),
        },
      };
      scope.markers.push(marker);

      addCheck(scope, `marker-${spec.id}-state`,
        captured.status.phase === spec.phase && captured.status.shot === spec.shot
          && Math.abs(captured.status.elapsed - spec.sample) <= 0.011
          && captured.status.gameplayLocked && !captured.status.completed,
        captured.status, { phase: spec.phase, shot: spec.shot, elapsed: spec.sample, locked: true });
      addCheck(scope, `marker-${spec.id}-telemetry`,
        Object.values(captured.telemetry).every((value) => value.length > 0),
        captured.telemetry, "all telemetry labels populated");
      addCheck(scope, `marker-${spec.id}-nonblank`,
        image.nonBlackPct >= 2 && image.stdDevLuma >= 5
          && image.tonalRange >= 7 && image.uniqueColourBins >= 12
          && image.edgeDensityPct >= 0.08,
        image, "nonblack>=2%, stddev>=5, tonal>=7, colours>=12, edges>=0.08%");
      addCheck(scope, `marker-${spec.id}-canvas`,
        image.width === captured.canvas.backing[0]
          && image.height === captured.canvas.backing[1]
          && captured.canvas.css[0] === profile.width
          && captured.canvas.css[1] === profile.height,
        { image: [image.width, image.height], canvas: captured.canvas },
        `CSS ${profile.width}x${profile.height}; PNG matches backing store`);
      addCheck(scope, `marker-${spec.id}-altitude-order`,
        captured.status.pod.altitude <= priorAltitude + 1,
        captured.status.pod.altitude, `<= ${priorAltitude}`);
      priorAltitude = captured.status.pod.altitude;

      if (spec.plasma !== undefined) addCheck(scope, `marker-${spec.id}-plasma`,
        captured.status.effects.plasma === spec.plasma,
        captured.status.effects.plasma, spec.plasma);
      if (spec.dust !== undefined) addCheck(scope, `marker-${spec.id}-dust`,
        captured.status.effects.dust === spec.dust,
        captured.status.effects.dust, spec.dust);
      if (spec.shockwave !== undefined) addCheck(scope, `marker-${spec.id}-shockwave`,
        captured.status.effects.shockwave === spec.shockwave,
        captured.status.effects.shockwave, spec.shockwave);
      if (spec.hatchMin !== undefined) addCheck(scope, `marker-${spec.id}-hatch`,
        captured.status.pod.hatch >= spec.hatchMin,
        captured.status.pod.hatch, `>= ${spec.hatchMin}`);
      if (spec.clouds !== undefined) addCheck(scope, `marker-${spec.id}-clouds`,
        captured.status.effects.clouds === spec.clouds,
        captured.status.effects.clouds, spec.clouds);
      /* It arrives under gravity and nothing else. A velocity that
         has bled off on approach is the tell that something braked
         it, and nothing on this pod can. */
      if (spec.minVelocity !== undefined) addCheck(scope, `marker-${spec.id}-no-braking`,
        captured.status.pod.velocity >= spec.minVelocity
          && captured.status.effects.stress > 0.2,
        { velocity: captured.status.pod.velocity, stress: captured.status.effects.stress },
        `still doing >= ${spec.minVelocity} m/s under load`);
      if (spec.petalsMin !== undefined) addCheck(scope, `marker-${spec.id}-petals`,
        captured.status.pod.petals >= spec.petalsMin,
        captured.status.pod.petals, `>= ${spec.petalsMin}`);
      /* THE POINT OF THE WHOLE CINEMATIC. From cloud-break onward the
         lander must be falling through the level's own coordinates
         toward the level's own drop site - not through a stand-in
         plane that gets cut away from afterwards. */
      if (spec.siteErrorMax !== undefined) addCheck(scope, `marker-${spec.id}-landed-on-site`,
        captured.status.pod.siteError <= spec.siteErrorMax && captured.status.pod.landed,
        { siteError: captured.status.pod.siteError, landed: captured.status.pod.landed },
        `within ${spec.siteErrorMax}m of the level's drop site`);
      if (spec.trooper) addCheck(scope, `marker-${spec.id}-trooper`,
        !!captured.status.trooper?.visible && captured.status.trooper.toSpawn > 0.1,
        captured.status.trooper, "trooper out of the pod and short of the spawn mark");
      if (spec.id === "turbulence") addCheck(scope, "turbulence-motion-policy",
        profile.reducedMotion === "reduce"
          ? captured.status.effects.turbulence === 0
          : captured.status.effects.turbulence > 0.2,
        captured.status.effects.turbulence,
        profile.reducedMotion === "reduce" ? 0 : "> 0.2");

      addCheck(scope, `marker-${spec.id}-scene-budget`,
        spec.live
          ? (captured.render.calls <= budgets.liveCalls
            && captured.render.triangles <= budgets.liveTriangles
            && captured.render.points <= budgets.livePoints
            && captured.status.scene.meshes <= budgets.liveOwnMeshes
            && captured.status.scene.materials <= budgets.liveOwnMaterials)
          : (captured.render.calls <= budgets.sceneCalls
            && captured.render.triangles <= budgets.sceneTriangles
            && captured.render.points <= budgets.scenePoints
            && captured.status.scene.materials <= budgets.sceneMaterials),
        { render: captured.render, scene: captured.status.scene, live: !!spec.live },
        budgets);
      if (perf) addCheck(scope, `marker-${spec.id}-p95`,
        perf.p95Ms <= (profile.hasTouch ? budgets.touchP95Ms : budgets.desktopP95Ms),
        perf, `p95 <= ${profile.hasTouch ? budgets.touchP95Ms : budgets.desktopP95Ms}ms`);
    }

    /* The crater is TERRAIN, not a decal. Measured off the height
       field the whole game reads - collision, foot IK and spawn all
       come through the same function - so this fails if the dish ever
       becomes a prop laid on flat ground. */
    scope.crater = await page.evaluate(() => {
      const T = window.__SF;
      const site = T.ctx.terrain;
      const pod = T.ctx.pod;
      const { x, z } = pod.site;
      const floor = site.heightAt(x, z);
      const grade = (site.heightAt(x, z + 14.5) + site.heightAt(x, z - 14.5)) / 2;
      /* MEANS of opposite pairs, not a max. The drop site sits on a
         shaped shelf, so any single sample carries the local slope;
         averaging opposite points cancels it and leaves the crater's
         own contribution, which is what this is measuring. */
      /* Sampled along Z ONLY. The causeway runs roughly north-south
         16.5m to the east, so an X sample at any useful radius walks
         onto authored road profile and measures the road's cut
         instead of the crater's. Opposite pairs cancel the local
         slope; staying off the X axis keeps the road out of it. */
      const rim = (site.heightAt(x, z + 8.6) + site.heightAt(x, z - 8.6)) / 2;
      return {
        floor, grade, rim,
        depth: grade - floor,
        rampart: rim - grade,
        hullBelowGrade: grade - (pod.restY + 0.0),
      };
    });
    addCheck(scope, "impact-crater-is-terrain",
      scope.crater.depth >= 2.2 && scope.crater.rampart >= 0.3
        && scope.crater.hullBelowGrade >= 2.4,
      scope.crater,
      "height field dips >=2.2m, rampart >=0.3m, hull base >=2.4m below grade");

    const visualDiffs = {};
    for (const [a, b] of [["standby", "entry"], ["release", "orbit"],
      ["entry", "impact"], ["impact", "hatch"]]) {
      visualDiffs[`${a}-to-${b}`] = await changedPixelPct(buffers.get(a), buffers.get(b));
    }
    scope.visualDiffs = visualDiffs;
    addCheck(scope, "authored-shot-differences",
      Object.values(visualDiffs).every((value) => value >= 1),
      visualDiffs, "each selected shot pair changes >=1% of pixels");
    addCheck(scope, "unique-marker-frames",
      new Set(scope.markers.map((marker) => marker.image.sha256)).size === scope.markers.length,
      scope.markers.map((marker) => ({ id: marker.id, sha256: marker.image.sha256 })),
      "no byte-identical marker frames");

    const handoff = await completeNaturally(page);
    const handoffBuffer = dataUrlBuffer(handoff.image);
    const firstGameplayBuffer = dataUrlBuffer(handoff.firstGameplayImage);
    const firstPresentedBuffer = dataUrlBuffer(handoff.firstPresentedFrame.image);
    const pureHandoffBuffer = dataUrlBuffer(handoff.pureHandoffImage);
    const pureHandoffByteExact = handoffBuffer.equals(pureHandoffBuffer);
    const handoffWebgl = path.join(profileDir, "10-handoff-webgl.png");
    const firstGameplayWebgl = path.join(profileDir, "11-first-gameplay-webgl.png");
    const firstPresentedWebgl = path.join(profileDir, "12-first-presented-gameplay-webgl.png");
    await writeFile(handoffWebgl, handoffBuffer);
    await writeFile(firstGameplayWebgl, firstGameplayBuffer);
    await writeFile(firstPresentedWebgl, firstPresentedBuffer);
    const handoffImage = await analyseImage(handoffBuffer);
    const firstGameplayImage = await analyseImage(firstGameplayBuffer);
    const firstPresentedImage = await analyseImage(firstPresentedBuffer);
    const firstFramePixelDelta = await changedPixelPct(handoffBuffer, firstGameplayBuffer);
    const firstPresentedPixelDelta = await changedPixelPct(handoffBuffer, firstPresentedBuffer);
    const firstPresentedByteExact = handoffBuffer.equals(firstPresentedBuffer);
    await page.waitForTimeout(profile.reducedMotion === "reduce" ? 140 : 1050);
    await page.locator(".sf-stage").screenshot({ path: path.join(profileDir, "10-handoff-stage.png") });
    const restored = await inspectRestored(page);
    scope.handoff = {
      pureHandoffByteExact,
      immediate: { ...handoff, image: undefined, pureHandoffImage: undefined,
        firstGameplayImage: undefined,
        firstPresentedFrame: { ...handoff.firstPresentedFrame, image: undefined } },
      restored,
      image: handoffImage,
      firstGameplayImage,
      firstFramePixelDelta,
      firstPresentedImage,
      firstPresentedPixelDelta,
      firstPresentedByteExact,
      files: {
        webgl: path.relative(root, handoffWebgl),
        firstGameplayWebgl: path.relative(root, firstGameplayWebgl),
        firstPresentedWebgl: path.relative(root, firstPresentedWebgl),
        stage: path.relative(root, path.join(profileDir, "10-handoff-stage.png")),
      },
    };
    addCheck(scope, "natural-handoff-once",
      handoff.status.completed && !handoff.status.skipped
        && !handoff.status.gameplayLocked && handoff.status.handoffCount === 1
        && handoff.status.elapsed === handoff.status.duration,
      handoff.status, "completed naturally once at canonical duration");
    /* The trooper DOES move now - walking out of the lander under the
       game's own locomotion is the last beat of the cinematic. What
       must still be untouched is everything that would mean the game
       had started: no mission clock, no combat state, no damage. */
    addCheck(scope, "handoff-does-not-start-the-game",
      pre.combat.hp === handoff.combat.hp
        && pre.combat.kills === handoff.combat.kills
        && pre.mission.elapsed === handoff.mission.elapsed
        && pre.mission.phase === handoff.mission.phase,
      { before: { combat: pre.combat, mission: pre.mission },
        handoff: { combat: handoff.combat, mission: handoff.mission } },
      "combat and mission untouched until handoff");
    addCheck(scope, "egress-walk-reaches-spawn",
      handoff.status.trooper && handoff.status.trooper.visible
        && handoff.status.trooper.toSpawn <= 1.4,
      handoff.status.trooper, "trooper walked out and stopped on the spawn mark");
    addCheck(scope, "lander-left-standing-on-site",
      handoff.status.pod.siteError <= 0.05 && handoff.status.pod.petals >= 0.99,
      handoff.status.pod, "the flown lander is the landed one, buried and open");
    addCheck(scope, "hud-restored",
      restored.hudDisplay !== "none" && restored.runtime.phase === "playing"
        && !restored.stageIntroActive && restored.introAriaHidden === "true",
      restored, "HUD visible, runtime playing, intro hidden and inactive");
    addCheck(scope, "touch-restored",
      restored.touch?.enabled === profile.hasTouch,
      restored.touch, { enabled: profile.hasTouch });
    addCheck(scope, "audio-handoff",
      restored.audio.state === "running" && restored.audio.ambience
        && !restored.audio.cinematic.active && restored.audio.cinematic.sources === 0
        && restored.audio.cinematic.loadErrors.length === 0,
      restored.audio, "ambience running; cinematic stopped cleanly");
    addCheck(scope, "handoff-frame-nonblank",
      handoffImage.nonBlackPct >= 2 && handoffImage.stdDevLuma >= 5,
      handoffImage, "nonblank final cinematic frame");
    addCheck(scope, "first-gameplay-camera-continuity",
      handoff.cameraContinuity.positionDelta <= 0.01
        && handoff.cameraContinuity.angularDelta <= 0.001
        && handoff.cameraContinuity.fovDelta <= 0.01,
      handoff.cameraContinuity, "<=1cm, <=0.001rad and <=0.01deg from handoff camera");
    addCheck(scope, "first-gameplay-frame-continuity",
      firstGameplayImage.nonBlackPct >= 2 && firstGameplayImage.stdDevLuma >= 5
        && firstFramePixelDelta <= 1,
      { image: firstGameplayImage, changedPixelsPct: firstFramePixelDelta },
      "nonblank and <=1% changed pixels from the handoff frame");
    const presentedCamera = handoff.firstPresentedFrame.camera;
    const introCamera = handoff.cameraContinuity.intro;
    const presentedPositionDelta = Math.hypot(...introCamera.position.map(
      (value, index) => value - presentedCamera.position[index]));
    const presentedDot = Math.abs(introCamera.quaternion.reduce(
      (sum, value, index) => sum + value * presentedCamera.quaternion[index], 0));
    const presentedAngularDelta = 2 * Math.acos(Math.min(1, presentedDot));
    /* Bytes are the real assertion; the pose numbers are a sanity
       rail beside them. `angularDelta` is `2*acos(|dot|)` and acos is
       ill-conditioned at 1, so two bit-identical quaternions can
       still report a few times 1e-8 - asserting an exact zero there
       fails on float noise while the frames are provably identical. */
    addCheck(scope, "handoff-cut-is-byte-exact",
      pureHandoffByteExact
        && handoff.cameraContinuity.positionDelta <= 1e-6
        && handoff.cameraContinuity.angularDelta <= 1e-6
        && handoff.cameraContinuity.fovDelta <= 1e-6,
      { pureHandoffByteExact, camera: handoff.cameraContinuity },
      "the live camera on the live scene reproduces the last cinematic frame exactly");
    addCheck(scope, "first-presented-frame-match-cut",
      presentedPositionDelta <= 0.01 && presentedAngularDelta <= 0.001
        && firstPresentedPixelDelta <= 0.5,
      { byteExact: firstPresentedByteExact, changedPixelsPct: firstPresentedPixelDelta,
        positionDelta: presentedPositionDelta, angularDelta: presentedAngularDelta },
      "next real rAF holds the pose and changes under 0.5% of pixels");
    addCheck(scope, "handoff-gate-stays-retired",
      handoff.firstPresentedFrame.gate.opacity === 0
        && handoff.firstPresentedFrame.gate.visibility === "hidden"
        && handoff.firstPresentedFrame.gate.pointerEvents === "none"
        && restored.gate?.opacity === 0 && restored.gate?.visibility === "hidden",
      { firstPresented: handoff.firstPresentedFrame.gate, restored: restored.gate },
      "Deploy card remains invisible and inert throughout the handoff fade");

    if (profile.id === "desktop") {
      scope.postHandoffPause = await verifyPostHandoffPause(page);
      addCheck(scope, "post-handoff-menu-pauses-game-and-audio",
        scope.postHandoffPause.movedM <= 0.01
          && Math.abs(scope.postHandoffPause.missionDelta) <= 0.02
          && scope.postHandoffPause.after.runtime.paused
          && scope.postHandoffPause.after.audio.paused
          && scope.postHandoffPause.after.audio.state !== "running",
        scope.postHandoffPause,
        "no movement/mission time behind menu; shared AudioContext suspended");
    }

    scope.postHandoffMovement = await measurePostHandoffMovement(context, page, profile);
    addCheck(scope, "gameplay-input-restored",
      scope.postHandoffMovement.movedM >= 0.05,
      scope.postHandoffMovement, "player moves >=0.05m through real input");
  } catch (error) {
    scope.fatal = { message: error.message, stack: error.stack || "" };
    addCheck(scope, "profile-completed", false, scope.fatal, "no fatal exception");
  } finally {
    addDiagnosticChecks(scope, scope.diagnostics);
    await context.close();
  }
  return scope;
}

async function runSkipFlow(browser, profile) {
  const scope = { id: `${profile.id}-skip`, checks: [], diagnostics: pageDiagnostics() };
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    reducedMotion: profile.reducedMotion,
    colorScheme: "dark",
  });
  try {
    const { page, url, bootMs } = await bootIntroPage(context, profile, scope.diagnostics);
    scope.url = url;
    scope.bootMs = bootMs;
    const before = await inspectPreGesture(page);
    await realStart(page, profile);
    await page.evaluate(() => {
      window.__SF.seekIntroForQA(7.4);
      window.__SF.renderIntroStill();
    });
    const skipDir = path.join(outDir, profile.id);
    await page.locator(".sf-stage").screenshot({ path: path.join(skipDir, "skip-before-stage.png") });
    const skipButton = page.locator("[data-intro-skip]");
    if (profile.hasTouch) await skipButton.tap({ timeout: 10000 });
    else await skipButton.click({ timeout: 10000 });
    await page.waitForFunction(() => window.__SF.introState()?.completed, null, { timeout: 5000 });
    const immediate = await page.evaluate(() => {
      const T = window.__SF;
      const first = T.introState();
      const repeatedSkip = T.skipIntroForQA();
      return {
        first,
        repeatedSkip,
        afterRepeat: T.introState(),
        runtime: { ...T.ctx.runtime },
        player: { ...T.report().player },
        combat: T.combatState(),
        mission: T.missionState(),
        touch: T.touchState(),
        hudDisplay: getComputedStyle(document.getElementById("sf-hud")).display,
      };
    });
    await page.waitForTimeout(profile.reducedMotion === "reduce" ? 140 : 1050);
    const restored = await inspectRestored(page);
    await page.locator(".sf-stage").screenshot({ path: path.join(skipDir, "skip-handoff-stage.png") });
    scope.before = before;
    scope.immediate = immediate;
    scope.restored = restored;
    addCheck(scope, "real-skip-completes-once",
      immediate.first.completed && immediate.first.skipped
        && immediate.first.handoffCount === 1 && !immediate.first.gameplayLocked
        && immediate.repeatedSkip === false && immediate.afterRepeat.handoffCount === 1,
      immediate, "skipped once; second skip false; handoffCount=1");
    /* A skip can now be taken from either side of the egress, so the
       invariant is no longer "the trooper never moved" - it is that
       a skip puts them exactly where a completed run would, and that
       no gameplay system ticked either way. */
    addCheck(scope, "skip-freezes-gameplay-until-handoff",
      before.combat.hp === immediate.combat.hp
        && before.mission.elapsed === immediate.mission.elapsed
        && (immediate.first.trooper?.toSpawn ?? 99) <= 0.05,
      { before: { player: before.player, combat: before.combat, mission: before.mission }, immediate },
      "combat/mission untouched; trooper left on the spawn mark");
    addCheck(scope, "skip-restores-presentation",
      restored.hudDisplay !== "none" && !restored.stageIntroActive
        && restored.introAriaHidden === "true"
        && restored.touch?.enabled === profile.hasTouch,
      restored, "HUD and expected touch state restored; intro hidden");
    addCheck(scope, "skip-restores-audio",
      restored.audio.state === "running" && restored.audio.ambience
        && !restored.audio.cinematic.active && restored.audio.cinematic.sources === 0,
      restored.audio, "gameplay ambience running; cinematic stopped");
  } catch (error) {
    scope.fatal = { message: error.message, stack: error.stack || "" };
    addCheck(scope, "skip-flow-completed", false, scope.fatal, "no fatal exception");
  } finally {
    addDiagnosticChecks(scope, scope.diagnostics);
    await context.close();
  }
  return scope;
}

/* THE MENU SIGNAL, NOT THE MENU.

   Saintfall opts out of the shared shell menu (`data-rb-native-escape-menu`)
   and runs its own, and that one deliberately refuses to open while the
   cinematic is blocking - so on this page there is no Escape-driven menu to
   press during the drop, and a harness that presses Escape here is waiting
   for a dialog that has decided not to exist.

   What the CINEMATIC contracts on is the body class. It watches
   `rb-escape-menu-open` through a MutationObserver and pauses its clock and
   its AudioContext whenever the class is present, whichever menu put it
   there. Driving the class directly tests exactly that contract, and keeps
   working whoever owns the dialog next. */
async function setMenuClass(page, open) {
  await page.evaluate((value) => {
    document.body.classList.toggle("rb-escape-menu-open", value);
  }, open);
}

async function runAwaitingMenuGuard(browser) {
  const scope = { id: "awaiting-menu-guard", checks: [], diagnostics: pageDiagnostics() };
  const profile = allProfiles[0];
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    reducedMotion: profile.reducedMotion,
    colorScheme: "dark",
  });
  try {
    const { page } = await bootIntroPage(context, profile, scope.diagnostics);
    await setMenuClass(page, true);
    await page.waitForFunction(() => document.body.classList.contains("rb-escape-menu-open"));
    // Enter is the Deploy shortcut. Behind an open menu it must do nothing.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(120);
    const guarded = await page.evaluate(() => window.__SF.introState());
    addCheck(scope, "enter-behind-open-menu-does-not-deploy",
      !guarded.started && guarded.mode === "awaiting-gesture" && guarded.elapsed === 0,
      guarded, "Enter is swallowed while the menu class is set");
    await setMenuClass(page, false);
    await page.waitForFunction(() => !document.body.classList.contains("rb-escape-menu-open"));
    const blocked = await page.evaluate(() => ({
      menuOpen: document.body.classList.contains("rb-escape-menu-open"),
      status: window.__SF.introState(),
      audio: window.__SF.audioState(),
    }));
    addCheck(scope, "menu-close-leaves-intro-awaiting-deploy",
      !blocked.menuOpen && !blocked.status.started
        && blocked.status.mode === "awaiting-gesture" && blocked.status.elapsed === 0
        && !blocked.audio.cinematic.active,
      blocked, "closing the menu neither deploys nor starts audio");

    const reentrant = await page.evaluate(async () => {
      const results = await Promise.all([
        window.__SF.startIntroForQA(),
        window.__SF.startIntroForQA(),
      ]);
      return { results, status: window.__SF.introState(), audio: window.__SF.audioState() };
    });
    addCheck(scope, "deploy-start-is-single-flight",
      reentrant.results.filter(Boolean).length === 1
        && reentrant.status.started && reentrant.status.mode === "running",
      reentrant, "exactly one concurrent start succeeds");
    await page.evaluate(() => window.__SF.skipIntroForQA());
  } catch (error) {
    scope.fatal = { message: error.message, stack: error.stack || "" };
    addCheck(scope, "menu-guard-completed", false, scope.fatal, "no fatal exception");
  } finally {
    addDiagnosticChecks(scope, scope.diagnostics);
    await context.close();
  }
  return scope;
}

async function runRealClockLifecycle(browser) {
  const scope = { id: "real-clock-lifecycle", checks: [], diagnostics: pageDiagnostics() };
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  try {
    const page = await context.newPage();
    watchPage(page, scope.diagnostics);
    scope.url = makeUrl({ intro: true, manual: false });
    await page.goto(scope.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => window.__SF.maximize());
    const before = await page.evaluate(() => window.__SF.introState());
    addCheck(scope, "real-clock-contract",
      before.manualClock === false && before.playbackDuration === before.duration
        && before.reducedMotion && before.revealed,
      before, "real clock, non-accelerated reduced-motion edit, revealed");

    await realStart(page, { hasTouch: false });
    await page.waitForFunction(() => window.__SF.introState().elapsed >= 1, null, { timeout: 15000 });
    await setMenuClass(page, true);
    await page.waitForFunction(() => window.__SF.ctx.runtime.paused
      && document.body.classList.contains("rb-escape-menu-open"), null, { timeout: 5000 });
    const pauseA = await page.evaluate(() => ({
      elapsed: window.__SF.introState().elapsed,
      status: window.__SF.introState(),
      audio: window.__SF.audioState(),
    }));
    await page.waitForTimeout(420);
    const pauseB = await page.evaluate(() => ({
      elapsed: window.__SF.introState().elapsed,
      status: window.__SF.introState(),
      audio: window.__SF.audioState(),
    }));
    addCheck(scope, "escape-menu-pauses-clock-and-audio",
      Math.abs(pauseB.elapsed - pauseA.elapsed) <= 0.02
        && pauseB.status.paused && pauseB.audio.cinematic.paused
        && pauseB.audio.state !== "running",
      { before: pauseA, after: pauseB }, "clock frozen and AudioContext suspended");

    await page.evaluate(() => {
      window.__sfIntroHidden = true;
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => window.__sfIntroHidden,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await setMenuClass(page, false);
    await page.waitForFunction(() => !document.body.classList.contains("rb-escape-menu-open"));
    await page.waitForTimeout(180);
    const composed = await page.evaluate(() => ({
      status: window.__SF.introState(),
      runtime: { ...window.__SF.ctx.runtime },
      audio: window.__SF.audioState(),
    }));
    addCheck(scope, "visibility-and-menu-pause-reasons-compose",
      composed.status.paused && composed.runtime.paused
        && composed.audio.cinematic.paused && composed.audio.state !== "running",
      composed, "closing menu does not resume while document is hidden");

    await page.evaluate(() => {
      window.__sfIntroHidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(() => !window.__SF.ctx.runtime.paused
      && window.__SF.audioState().state === "running", null, { timeout: 5000 });
    // Exercise the async suspend/resume queue with a deliberately tight pair.
    await setMenuClass(page, true);
    await setMenuClass(page, false);
    await page.waitForFunction(() => !window.__SF.ctx.runtime.paused
      && window.__SF.audioState().state === "running"
      && !window.__SF.audioState().cinematic.paused, null, { timeout: 5000 });
    const resumed = await page.evaluate(() => ({
      status: window.__SF.introState(), audio: window.__SF.audioState(),
      runtime: { ...window.__SF.ctx.runtime },
    }));
    addCheck(scope, "rapid-pause-resume-finishes-running",
      !resumed.status.paused && !resumed.runtime.paused
        && resumed.audio.state === "running" && !resumed.audio.cinematic.paused,
      resumed, "latest resume wins asynchronous context transitions");

    await page.waitForFunction(() => window.__SF.introState().completed, null, { timeout: 35000 });
    await page.waitForFunction(() => window.__SF.audioState().ambience
      && window.__SF.audioState().cinematic.sources === 0, null, { timeout: 5000 });
    const completed = await page.evaluate(() => ({
      status: window.__SF.introState(), audio: window.__SF.audioState(),
      runtime: { ...window.__SF.ctx.runtime },
    }));
    scope.completed = completed;
    addCheck(scope, "real-clock-emits-impact-cue-once",
      completed.status.impactCount === 1,
      completed.status, "impactCount === 1 on natural real-clock playback");
    addCheck(scope, "real-clock-natural-handoff",
      completed.status.completed && !completed.status.skipped
        && completed.status.handoffCount === 1 && completed.runtime.phase === "playing"
        && completed.audio.ambience && completed.audio.cinematic.sources === 0
        && completed.audio.cinematic.loadErrors.length === 0,
      completed, "one natural handoff; cinematic clean; ambience running");
  } catch (error) {
    scope.fatal = { message: error.message, stack: error.stack || "" };
    addCheck(scope, "real-clock-lifecycle-completed", false, scope.fatal, "no fatal exception");
  } finally {
    addDiagnosticChecks(scope, scope.diagnostics);
    await context.close();
  }
  return scope;
}

async function runProductionTeardown(browser) {
  const scope = { id: "production-teardown", checks: [], diagnostics: pageDiagnostics() };
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  try {
    const page = await context.newPage();
    watchPage(page, scope.diagnostics);
    // Deliberately request manual clock without qa: production must ignore it.
    scope.url = makeUrl({ intro: true, manual: true, qa: false });
    await page.goto(scope.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => window.__SF.maximize());
    const before = await page.evaluate(() => ({
      status: window.__SF.introState(),
      bootPresent: Boolean(document.getElementById("sf-boot")),
    }));
    addCheck(scope, "production-ignores-manual-clock-query",
      before.status.manualClock === false && !before.bootPresent,
      before, "manual clock is QA-only and loader is gone before reveal");
    const productionHookGuard = await page.evaluate(async () => ({
      start: await window.__SF.startIntroForQA(),
      seek: window.__SF.seekIntroForQA("entry"),
      advance: window.__SF.advanceIntroForQA(1),
      pause: window.__SF.setIntroPausedForQA(true),
      skip: window.__SF.skipIntroForQA(),
      render: window.__SF.renderIntroStill(),
      directMethods: ["start", "seek", "advance", "setPaused", "skip", "dispose"]
        .filter((name) => typeof window.__SF.intro?.[name] === "function"),
      indirectIntroType: typeof window.__SF.ctx.intro,
      status: window.__SF.introState(),
    }));
    scope.productionHookGuard = productionHookGuard;
    addCheck(scope, "production-rejects-intro-mutation-hooks",
      productionHookGuard.start === false && productionHookGuard.seek === null
        && productionHookGuard.advance === null && productionHookGuard.pause === false
        && productionHookGuard.skip === false && productionHookGuard.render === null
        && productionHookGuard.directMethods.length === 0
        && productionHookGuard.indirectIntroType === "undefined"
        && !productionHookGuard.status.started,
      productionHookGuard, "new intro mutation hooks are QA-only");
    await realStart(page, { hasTouch: false });
    await page.locator("[data-intro-skip]").click({ timeout: 10000 });
    await page.waitForFunction(() => window.__SF.introState().disposed, null, { timeout: 5000 });
    await page.waitForFunction(() => window.__SF.audioState().ambience, null, { timeout: 5000 });
    const after = await page.evaluate(() => {
      const host = document.getElementById("sf-intro");
      return {
        status: window.__SF.introState(),
        sceneNull: window.__SF.intro.scene === null,
        cameraNull: window.__SF.intro.camera === null,
        childCount: host.childElementCount,
        inert: host.hasAttribute("inert"),
        ariaHidden: host.getAttribute("aria-hidden"),
        stageIntroActive: document.querySelector(".sf-stage")?.classList.contains("sf-intro-active"),
        runtime: { ...window.__SF.ctx.runtime },
        audio: window.__SF.audioState(),
      };
    });
    scope.after = after;
    addCheck(scope, "production-disposes-intro-graph",
      after.status.disposed && after.sceneNull && after.cameraNull
        && after.childCount === 0 && after.inert && after.ariaHidden === "true",
      after, "disposed status, null graph/camera, empty inert DOM");
    addCheck(scope, "production-teardown-restores-gameplay",
      !after.stageIntroActive && after.runtime.phase === "playing"
        && after.audio.ambience && after.audio.cinematic.sources === 0,
      after, "gameplay active with clean cinematic audio");
  } catch (error) {
    scope.fatal = { message: error.message, stack: error.stack || "" };
    addCheck(scope, "production-teardown-completed", false, scope.fatal, "no fatal exception");
  } finally {
    addDiagnosticChecks(scope, scope.diagnostics);
    await context.close();
  }
  return scope;
}

async function runDefaultBypass(browser) {
  const scope = { id: "default-qa-bypass", checks: [], diagnostics: pageDiagnostics() };
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  try {
    const page = await context.newPage();
    watchPage(page, scope.diagnostics);
    scope.url = makeUrl({ intro: false, touch: false });
    await page.goto(scope.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => window.__SF.maximize());
    const before = await page.evaluate((hooks) => {
      const T = window.__SF;
      const intro = document.getElementById("sf-intro");
      return {
        hooks: Object.fromEntries(hooks.map((name) => [name, typeof T[name]])),
        status: T.introState(),
        report: T.report(),
        runtime: { ...T.ctx.runtime },
        player: { ...T.report().player },
        touch: T.touchState(),
        hudDisplay: getComputedStyle(document.getElementById("sf-hud")).display,
        introAriaHidden: intro?.getAttribute("aria-hidden"),
        stageIntroActive: document.querySelector(".sf-stage")?.classList.contains("sf-intro-active"),
        startCount: document.querySelectorAll("[data-intro-start]").length,
        params: Object.fromEntries(new URL(location.href).searchParams.entries()),
      };
    }, requiredHooks);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(420);
    await page.keyboard.up("KeyW");
    await page.waitForTimeout(80);
    const after = await page.evaluate(() => {
      const T = window.__SF;
      const gl = T.render.renderer.getContext();
      T.renderStill();
      if (typeof gl.finish === "function") gl.finish();
      return { player: { ...T.report().player }, image: T.captureDataURL() };
    });
    const buffer = dataUrlBuffer(after.image);
    const screenshot = path.join(outDir, "default-qa-bypass-webgl.png");
    await writeFile(screenshot, buffer);
    await page.locator(".sf-stage").screenshot({ path: path.join(outDir, "default-qa-bypass-stage.png") });
    scope.before = before;
    scope.after = { player: after.player, movedM: round(distance(before.player, after.player), 3) };
    scope.image = await analyseImage(buffer);
    addCheck(scope, "default-query-omits-intro-opt-in",
      before.params.qa === "1" && before.params.intro === undefined
        && before.params.introClock === undefined,
      before.params, "qa=1 without intro flags");
    addCheck(scope, "default-qa-bypasses-intro",
      before.status.enabled === false && before.status.completed
        && before.status.phase === "disabled" && before.runtime.phase === "playing"
        && before.hudDisplay !== "none" && !before.stageIntroActive
        && before.startCount === 0,
      before, "disabled intro and immediately playable HUD/runtime");
    addCheck(scope, "default-qa-gameplay-input",
      scope.after.movedM >= 0.05, scope.after, "KeyW moves player >=0.05m");
    addCheck(scope, "default-qa-frame-nonblank",
      scope.image.nonBlackPct >= 2 && scope.image.stdDevLuma >= 5,
      scope.image, "nonblank gameplay frame");
  } catch (error) {
    scope.fatal = { message: error.message, stack: error.stack || "" };
    addCheck(scope, "default-bypass-completed", false, scope.fatal, "no fatal exception");
  } finally {
    addDiagnosticChecks(scope, scope.diagnostics);
    await context.close();
  }
  return scope;
}

async function main() {
  // The timestamped default is fresh by construction. `recursive` only
  // creates its missing parents; it never clears an older proof folder.
  await mkdir(outDir, { recursive: true });
  const serverErrors = [];
  const server = spawn("python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  server.stderr.on("data", (chunk) => serverErrors.push(String(chunk)));
  let browser;
  const report = {
    generatedAt: new Date().toISOString(),
    root,
    output: path.relative(root, outDir),
    contract: {
      forcedQuery: "?qa=1&intro=force&introClock=manual&seed=drop-intro-qa&quality=high",
      defaultBypassQuery: "?qa=1&seed=drop-intro-qa&quality=high",
      requiredHooks,
      markers: expectedMarkers,
      budgets,
      notes: [
        "Marker seeks are canonical seconds; reduced motion preserves the 23.6-second pace while removing shake, animated UI flashes, and most entry particles.",
        "Manual marker seeks suppress one-shots; a separate real-clock run verifies cue timing, impact count, pause composition, and natural audio handoff.",
        "Headless Chromium can initialize AudioContext as running and report sticky activation before a Playwright action; the pre-gesture gate therefore requires zero ambience, sources, and decoded cinematic buffers, followed by a hit-tested Deploy click/tap that populates the graph.",
        "Forced QA preserves the intro scene for repeatable captures; a non-QA reduced-motion run separately verifies production disposal and graph release.",
      ],
    },
    profiles: [],
    skipFlows: [],
    serverErrors,
  };

  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: !headed,
      args: [
        "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--hide-scrollbars", "--mute-audio",
        "--autoplay-policy=user-gesture-required",
      ],
    });

    report.defaultBypass = await runDefaultBypass(browser);
    report.awaitingMenuGuard = await runAwaitingMenuGuard(browser);
    for (const profile of profiles) {
      process.stdout.write(`intro ${profile.id} ... `);
      const result = await runProfile(browser, profile);
      report.profiles.push(result);
      const failed = result.checks.filter((check) => !check.pass).length;
      console.log(`${failed ? "FAIL" : "PASS"} (${failed} failed checks)`);
    }
    for (const profile of profiles) {
      process.stdout.write(`skip ${profile.id} ... `);
      const result = await runSkipFlow(browser, profile);
      report.skipFlows.push(result);
      const failed = result.checks.filter((check) => !check.pass).length;
      console.log(`${failed ? "FAIL" : "PASS"} (${failed} failed checks)`);
    }
    process.stdout.write("real clock lifecycle ... ");
    report.realClockLifecycle = await runRealClockLifecycle(browser);
    console.log(report.realClockLifecycle.checks.some((check) => !check.pass) ? "FAIL" : "PASS");
    process.stdout.write("production teardown ... ");
    report.productionTeardown = await runProductionTeardown(browser);
    console.log(report.productionTeardown.checks.some((check) => !check.pass) ? "FAIL" : "PASS");

    const normalDesktop = report.profiles.find((profile) => profile.id === "desktop");
    const reducedDesktop = report.profiles.find((profile) => profile.id === "desktop-reduced-motion");
    report.crossProfileChecks = [];
    if (normalDesktop && reducedDesktop
      && normalDesktop.markers.length && reducedDesktop.markers.length) {
      const normal = normalDesktop.markers[0].status;
      const reduced = reducedDesktop.markers[0].status;
      addCheck({ checks: report.crossProfileChecks }, "reduced-motion-paced-and-lighter",
        reduced.playbackDuration === normal.playbackDuration
          && reduced.scene.points < normal.scene.points,
        { normal: { playbackDuration: normal.playbackDuration, scene: normal.scene },
          reduced: { playbackDuration: reduced.playbackDuration, scene: reduced.scene } },
        "same authored pace and fewer intro points");
    }
  } catch (error) {
    report.fatal = { message: error.message, stack: error.stack || "" };
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }

  const allScopes = [
    report.defaultBypass,
    report.awaitingMenuGuard,
    ...report.profiles,
    ...report.skipFlows,
    report.realClockLifecycle,
    report.productionTeardown,
  ]
    .filter(Boolean);
  const failedChecks = allScopes.flatMap((scope) => scope.checks
    .filter((check) => !check.pass)
    .map((check) => `${scope.id}:${check.id}`));
  for (const check of report.crossProfileChecks || []) {
    if (!check.pass) failedChecks.push(`cross-profile:${check.id}`);
  }
  if (report.fatal) failedChecks.push(`fatal:${report.fatal.message}`);
  report.summary = {
    checks: allScopes.reduce((sum, scope) => sum + scope.checks.length, 0)
      + (report.crossProfileChecks?.length || 0),
    failed: failedChecks.length,
    failedChecks,
    passed: failedChecks.length === 0,
  };
  const reportPath = path.join(outDir, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`report: ${path.relative(root, reportPath)}`);
  console.log(`${report.summary.passed ? "PASS" : "FAIL"}: ${report.summary.failed}/${report.summary.checks} checks failed`);
  if (!report.summary.passed) process.exitCode = 1;
}

await main();
