#!/usr/bin/env node
/* ============================================================
   BLACKSAND - audio probe

   Audio cannot be judged from a screenshot, so this is the equivalent
   of the beauty-shot harness for the mix: it boots the game, renders
   every voice through the REAL signal chain inside an
   OfflineAudioContext, and reports objective numbers.

   `ctx.audio.renderOffline(spec)` rebuilds the identical graph - same
   buses, same compressors, same limiter, same convolution reverbs -
   on an OfflineAudioContext and hands back the samples. Nothing here
   measures a special "test tone" version of a sound; it measures the
   thing the player hears.

   What the numbers catch:

     attack        A gunshot with a 40ms attack is a firework. Under
                   5ms or it is not a gunshot.
     centroid      Spectral centre of gravity of the first 50ms. A
                   rifle transient sits well above 1kHz; a centroid at
                   300Hz means the crack layer is not working.
     centroid vs   The crack/thump ratio must INVERT with distance -
     distance      that is the actual physics of hearing a supersonic
                   round, and it is what makes distant fire read as
                   distant rather than as quiet.
     crest         Peak-to-RMS. A transient that has been squashed
                   flat by the bus compressor shows up here before it
                   is audible.
     clipping      Any sample at full scale is a failure, and the
                   worst case (8 explosions + 4 directions of
                   sustained automatic fire) is rendered explicitly.

   Usage:
     node scripts/blacksand-audio-probe.mjs
     node scripts/blacksand-audio-probe.mjs --out output/blacksand-audio/run-1
     node scripts/blacksand-audio-probe.mjs --only gunshot --no-images
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
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
const OUT_DIR = path.resolve(root, String(args.out || "output/blacksand-audio/probe"));
const PORT = Number(args.port || 41500 + (process.pid % 9000));
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/games/blacksand.html?qa=1&quality=${args.quality || "high"}`;
const WRITE_IMAGES = !args["no-images"];
const ONLY = args.only ? String(args.only) : null;

/* ----------------------------- server ----------------------------- */

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`static server never came up on ${BASE}`);
}

/* ------------------------------ dsp ------------------------------ */

/** In-place iterative radix-2 FFT. re/im are Float64Array of length 2^k. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const hannCache = new Map();
function hann(n) {
  if (hannCache.has(n)) return hannCache.get(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  hannCache.set(n, w);
  return w;
}

/** Magnitude spectrum of `samples[from..from+n)`. */
function spectrum(samples, from, n) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const w = hann(n);
  for (let i = 0; i < n; i += 1) re[i] = (samples[from + i] || 0) * w[i];
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/** Power-weighted spectral centroid in Hz. */
function centroid(mag, sampleRate) {
  const n = mag.length;
  let num = 0;
  let den = 0;
  for (let i = 1; i < n; i += 1) {
    const p = mag[i] * mag[i];
    num += ((i * sampleRate) / (n * 2)) * p;
    den += p;
  }
  return den > 0 ? num / den : 0;
}

const dB = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -Infinity);
const fix = (x, n = 2) => (Number.isFinite(x) ? Number(x.toFixed(n)) : null);

/**
 * Everything worth knowing about one rendered sound.
 *
 * The envelope is a 1ms-RMS follower rather than the raw sample
 * magnitude - a peak-picking envelope on broadband noise is dominated
 * by whichever sample happened to be largest and gives attack times
 * that jitter by a factor of three between runs.
 */
function analyse(mono, left, right, sampleRate) {
  const n = mono.length;

  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < n; i += 1) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
  }
  let peakL = 0;
  let peakR = 0;
  for (let i = 0; i < n; i += 1) {
    const l = Math.abs(left[i]);
    const r = Math.abs(right[i]);
    if (l > peakL) peakL = l;
    if (r > peakR) peakR = r;
    if (l >= 0.999 || r >= 0.999) clipped += 1;
  }

  const win = Math.max(8, Math.round(sampleRate * 0.001));
  const envLen = Math.floor(n / win);
  const env = new Float64Array(envLen);
  for (let e = 0; e < envLen; e += 1) {
    let sum = 0;
    for (let i = 0; i < win; i += 1) {
      const v = mono[e * win + i];
      sum += v * v;
    }
    env[e] = Math.sqrt(sum / win);
  }

  let envPeak = 0;
  let envPeakAt = 0;
  for (let e = 0; e < envLen; e += 1) {
    if (env[e] > envPeak) { envPeak = env[e]; envPeakAt = e; }
  }

  // Attack: 10% to 90% of the envelope peak.
  let t10 = envPeakAt;
  let t90 = envPeakAt;
  for (let e = 0; e <= envPeakAt; e += 1) { if (env[e] >= envPeak * 0.1) { t10 = e; break; } }
  for (let e = t10; e <= envPeakAt; e += 1) { if (env[e] >= envPeak * 0.9) { t90 = e; break; } }
  const attackMs = ((t90 - t10) * win * 1000) / sampleRate;

  // Onset: where the sound actually starts, relative to t=0. Reads the
  // propagation delay straight out of the render.
  let onset = 0;
  for (let e = 0; e < envLen; e += 1) { if (env[e] >= envPeak * 0.05) { onset = e; break; } }
  const onsetMs = (onset * win * 1000) / sampleRate;

  // Decay to -40dB below the envelope peak. A true T60 is not
  // measurable here because the render ends first for the long ones.
  let t40 = envLen - 1;
  for (let e = envPeakAt; e < envLen; e += 1) {
    if (env[e] <= envPeak * 0.01) { t40 = e; break; }
  }
  const decayMs = ((t40 - envPeakAt) * win * 1000) / sampleRate;

  // RMS over the active portion only. Including two seconds of silence
  // after a footstep makes every crest factor meaningless.
  let active = 0;
  let sumSq = 0;
  for (let e = 0; e < envLen; e += 1) {
    if (env[e] < envPeak * 0.02) continue;
    active += 1;
    for (let i = 0; i < win; i += 1) {
      const v = mono[e * win + i];
      sumSq += v * v;
    }
  }
  const rms = active > 0 ? Math.sqrt(sumSq / (active * win)) : 0;

  // Transient spectrum: first 50ms from the onset. This is the window
  // that decides whether the ear calls it a rifle.
  const fftSize = 2048;
  const transientFrom = Math.min(Math.max(0, onset * win), Math.max(0, n - fftSize));
  const transient = spectrum(mono, transientFrom, fftSize);
  const wholeFrom = Math.min(transientFrom, Math.max(0, n - fftSize));
  const whole = (() => {
    // Average the magnitude across the whole event so the "body"
    // centroid is not just one arbitrary window.
    const acc = new Float64Array(fftSize / 2);
    let frames = 0;
    for (let from = wholeFrom; from + fftSize < n; from += fftSize / 2) {
      const m = spectrum(mono, from, fftSize);
      let energy = 0;
      for (let i = 0; i < m.length; i += 1) energy += m[i] * m[i];
      if (energy < 1e-10) continue;
      for (let i = 0; i < acc.length; i += 1) acc[i] += m[i];
      frames += 1;
    }
    if (frames > 0) for (let i = 0; i < acc.length; i += 1) acc[i] /= frames;
    return acc;
  })();

  // Stereo width: correlation between the channels. 1 is mono, 0 is
  // fully decorrelated. Verifies HRTF and the reverb are doing work.
  let sl = 0; let sr = 0; let slr = 0;
  for (let i = 0; i < n; i += 1) {
    sl += left[i] * left[i];
    sr += right[i] * right[i];
    slr += left[i] * right[i];
  }
  const correlation = sl > 0 && sr > 0 ? slr / Math.sqrt(sl * sr) : 1;

  return {
    peak: fix(peak, 4),
    peakDb: fix(dB(peak), 1),
    peakL: fix(peakL, 4),
    peakR: fix(peakR, 4),
    rms: fix(rms, 5),
    rmsDb: fix(dB(rms), 1),
    crestDb: fix(dB(peak) - dB(rms), 1),
    attackMs: fix(attackMs, 2),
    onsetMs: fix(onsetMs, 1),
    decayMs: fix(decayMs, 1),
    centroidHz: Math.round(centroid(transient, sampleRate)),
    bodyCentroidHz: Math.round(centroid(whole, sampleRate)),
    correlation: fix(correlation, 3),
    clippedSamples: clipped,
  };
}

/* -------------------------- spectrogram -------------------------- */

/** Blue -> cyan -> yellow -> white. Readable at a glance in a PNG. */
function colourmap(t) {
  const x = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00, 8, 10, 26],
    [0.25, 20, 60, 130],
    [0.50, 30, 165, 170],
    [0.72, 220, 200, 70],
    [0.88, 250, 150, 60],
    [1.00, 255, 250, 240],
  ];
  for (let i = 1; i < stops.length; i += 1) {
    if (x <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const k = (x - a[0]) / (b[0] - a[0]);
      return [
        Math.round(a[1] + (b[1] - a[1]) * k),
        Math.round(a[2] + (b[2] - a[2]) * k),
        Math.round(a[3] + (b[3] - a[3]) * k),
      ];
    }
  }
  return [255, 255, 255];
}

/**
 * Log-frequency spectrogram, 60dB of range, written straight from a
 * raw RGB buffer. Log frequency because a linear axis puts everything
 * a gunshot does in the bottom eighth of the image.
 */
async function spectrogram(mono, sampleRate, file, height = 320) {
  const fftSize = 1024;
  const hop = Math.max(64, Math.floor(mono.length / 620));
  const frames = Math.max(1, Math.floor((mono.length - fftSize) / hop));
  const width = Math.min(720, frames);
  const rgb = Buffer.alloc(width * height * 3);

  const fMin = 40;
  const fMax = Math.min(20000, sampleRate / 2);
  const logMin = Math.log(fMin);
  const logMax = Math.log(fMax);

  // Peak-normalise so a quiet distant shot is still readable; the
  // absolute level lives in the numbers, not in the picture.
  let globalMax = 1e-9;
  const columns = [];
  for (let x = 0; x < width; x += 1) {
    const from = Math.floor((x / width) * frames) * hop;
    const mag = spectrum(mono, from, fftSize);
    for (let i = 0; i < mag.length; i += 1) if (mag[i] > globalMax) globalMax = mag[i];
    columns.push(mag);
  }

  for (let x = 0; x < width; x += 1) {
    const mag = columns[x];
    for (let y = 0; y < height; y += 1) {
      const f = Math.exp(logMin + ((height - 1 - y) / (height - 1)) * (logMax - logMin));
      const bin = (f * fftSize) / sampleRate;
      const i0 = Math.floor(bin);
      const frac = bin - i0;
      const v = (mag[i0] || 0) * (1 - frac) + (mag[i0 + 1] || 0) * frac;
      const db = 20 * Math.log10(Math.max(1e-9, v / globalMax));
      const [r, g, b] = colourmap((db + 60) / 60);
      const o = (y * width + x) * 3;
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
    }
  }

  await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toFile(file);
  return { width, height };
}

/* ------------------------------ cases ------------------------------ */

const CASES = [];
const WEAPONS = ["rifle", "carbine", "marksman", "smg", "lmg", "pistol"];

for (const weapon of WEAPONS) {
  for (const [tag, distance, seconds] of [["near", 6, 1.6], ["mid", 60, 1.8], ["far", 250, 2.6]]) {
    CASES.push({
      group: "gunshot",
      id: `gunshot-${weapon}-${tag}`,
      spec: { event: "gunshot", weapon, distance, azimuth: 35, seconds, environment: "open" },
      image: tag !== "mid",
    });
  }
}

for (const [tag, distance, power, seconds] of [
  ["near", 12, 1.4, 3.2], ["mid", 60, 1.4, 3.2], ["far", 300, 1.8, 3.6],
]) {
  CASES.push({
    group: "explosion",
    id: `explosion-${tag}`,
    spec: { event: "explosion", distance, power, azimuth: -40, seconds, environment: "open" },
    image: true,
  });
}

for (const surface of ["sand", "concrete", "metal", "water"]) {
  CASES.push({
    group: "footstep",
    id: `footstep-${surface}`,
    spec: { event: "footstep", surface, distance: 2, azimuth: 0, seconds: 0.9, intensity: 1 },
    image: surface === "concrete",
  });
}

CASES.push(
  { group: "crack", id: "bullet-crack", spec: { event: "bulletCrack", distance: 2.5, azimuth: 80, seconds: 0.7 }, image: true },
  { group: "casing", id: "casing-concrete", spec: { event: "casing", surface: "concrete", distance: 2, seconds: 1.4 }, image: true },
  { group: "casing", id: "casing-sand", spec: { event: "casing", surface: "sand", distance: 2, seconds: 1.4 }, image: false },
  { group: "comms", id: "radio-callout", spec: { event: "radio", syllables: 5, seconds: 1.6 }, image: true },
  { group: "ambience", id: "wind-strong", spec: { event: "wind", windStrength: 2.4, seconds: 2.0 }, image: true },
);

for (const environment of ["open", "street", "interior"]) {
  CASES.push({
    group: "environment",
    id: `env-${environment}`,
    spec: {
      event: "gunshot", weapon: "rifle", distance: 30, azimuth: 20, seconds: 2.4,
      environment, envMix: { [environment]: 1 },
    },
    image: true,
  });
}

for (const occlusion of [0, 0.34, 0.67, 1]) {
  CASES.push({
    group: "occlusion",
    id: `occlusion-${Math.round(occlusion * 100)}`,
    spec: {
      event: "gunshot", weapon: "rifle", distance: 30, azimuth: 20, seconds: 1.8,
      environment: "open", occlusion,
    },
    image: occlusion === 1,
  });
}

for (const weather of [["clear", 1], ["dust", 2.0]]) {
  CASES.push({
    group: "weather",
    id: `absorb-${weather[0]}`,
    spec: {
      event: "gunshot", weapon: "rifle", distance: 180, azimuth: 0, seconds: 2.2,
      environment: "open", absorb: weather[1],
    },
    image: false,
  });
}

CASES.push(
  {
    group: "load",
    id: "burst-lmg",
    spec: { event: "burst", weapon: "lmg", rpm: 720, shots: 24, distance: 5, seconds: 2.8, environment: "open" },
    image: true,
  },
  {
    group: "load",
    id: "stress-worstcase",
    spec: { event: "stress", seconds: 3.0, environment: "open" },
    image: true,
  }
);

/* ------------------------------ main ------------------------------ */

async function main() {
  const server = startServer();
  let browser = null;
  const consoleErrors = [];
  const pageErrors = [];
  const results = [];

  await mkdir(OUT_DIR, { recursive: true });

  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: !args.headed,
      args: [
        "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--force-device-scale-factor=1",
        "--hide-scrollbars", "--mute-audio",
        // OfflineAudioContext does not need a device, but Chromium
        // still refuses to construct one without this in some builds.
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.stack || e.message));

    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 120000 });
    await page.evaluate(() => { for (let i = 0; i < 5; i += 1) window.__BS.renderOnce(1 / 60); });

    const hasProbe = await page.evaluate(() => typeof window.__BS_CTX?.audio?.renderOffline === "function");
    if (!hasProbe) throw new Error("ctx.audio.renderOffline is missing - audio.js is not the probe-capable build");

    for (const testCase of CASES) {
      if (ONLY && !testCase.id.includes(ONLY) && testCase.group !== ONLY) continue;
      process.stdout.write(`  ${testCase.id} ... `);

      const payload = await page.evaluate(async (spec) => {
        const rendered = await window.__BS_CTX.audio.renderOffline(spec);
        const n = rendered.length;
        // Downmix here rather than shipping two channels: the analysis
        // wants mono for everything except the correlation, and the
        // transfer is the slow part.
        const mono = new Float32Array(n);
        for (let i = 0; i < n; i += 1) mono[i] = (rendered.left[i] + rendered.right[i]) * 0.5;
        const pack = (arr) => {
          const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
          let binary = "";
          const CHUNK = 0x8000;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
          }
          return btoa(binary);
        };
        return {
          sampleRate: rendered.sampleRate,
          length: n,
          mono: pack(mono),
          left: pack(Float32Array.from(rendered.left)),
          right: pack(Float32Array.from(rendered.right)),
          stats: rendered.stats,
        };
      }, testCase.spec);

      const unpack = (b64) => {
        const buf = Buffer.from(b64, "base64");
        return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      };
      const mono = unpack(payload.mono);
      const left = unpack(payload.left);
      const right = unpack(payload.right);

      const metrics = analyse(mono, left, right, payload.sampleRate);
      let image = null;
      if (WRITE_IMAGES && testCase.image) {
        const file = path.join(OUT_DIR, `${testCase.id}.png`);
        await spectrogram(mono, payload.sampleRate, file);
        image = path.relative(root, file);
      }

      results.push({
        id: testCase.id,
        group: testCase.group,
        spec: testCase.spec,
        voices: payload.stats,
        image,
        ...metrics,
      });
      console.log(`peak ${metrics.peakDb}dB  attack ${metrics.attackMs}ms  centroid ${metrics.centroidHz}Hz`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }

  /* ---------------------------- verdict ---------------------------- */

  const byId = new Map(results.map((r) => [r.id, r]));
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

  for (const weapon of WEAPONS) {
    const near = byId.get(`gunshot-${weapon}-near`);
    const far = byId.get(`gunshot-${weapon}-far`);
    if (!near || !far) continue;
    check(`${weapon}: attack under 5ms`, near.attackMs !== null && near.attackMs < 5,
      `${near.attackMs}ms`);
    check(`${weapon}: transient centroid above 900Hz`, near.centroidHz > 900,
      `${near.centroidHz}Hz`);
    check(`${weapon}: crack/thump inverts with range`, far.centroidHz < near.centroidHz * 0.75,
      `${near.centroidHz}Hz at 6m -> ${far.centroidHz}Hz at 250m`);
    check(`${weapon}: distance attenuates`, far.peak < near.peak,
      `${near.peakDb}dB -> ${far.peakDb}dB`);
  }

  const distinct = WEAPONS.map((w) => byId.get(`gunshot-${w}-near`)).filter(Boolean);
  const spread = distinct.length > 1
    ? Math.max(...distinct.map((r) => r.centroidHz)) / Math.min(...distinct.map((r) => r.centroidHz))
    : 1;
  check("weapons are acoustically distinct", spread > 1.35,
    `transient centroid spread ${spread.toFixed(2)}x across ${distinct.length} weapons`);

  const occ0 = byId.get("occlusion-0");
  const occ100 = byId.get("occlusion-100");
  if (occ0 && occ100) {
    check("occlusion drops level", occ100.peak < occ0.peak * 0.72,
      `${occ0.peakDb}dB -> ${occ100.peakDb}dB`);
    check("occlusion darkens", occ100.bodyCentroidHz < occ0.bodyCentroidHz * 0.85,
      `${occ0.bodyCentroidHz}Hz -> ${occ100.bodyCentroidHz}Hz`);
  }

  const envOpen = byId.get("env-open");
  const envInterior = byId.get("env-interior");
  const envStreet = byId.get("env-street");
  if (envOpen && envInterior && envStreet) {
    check("interior decays faster than open", envInterior.decayMs < envOpen.decayMs,
      `interior ${envInterior.decayMs}ms vs open ${envOpen.decayMs}ms`);
    check("three environments are measurably different",
      new Set([envOpen.decayMs, envStreet.decayMs, envInterior.decayMs]).size === 3,
      `open ${envOpen.decayMs} / street ${envStreet.decayMs} / interior ${envInterior.decayMs}ms`);
  }

  const clear = byId.get("absorb-clear");
  const dust = byId.get("absorb-dust");
  if (clear && dust) {
    check("dust absorbs high frequency", dust.bodyCentroidHz < clear.bodyCentroidHz,
      `${clear.bodyCentroidHz}Hz -> ${dust.bodyCentroidHz}Hz`);
  }

  const far250 = byId.get("gunshot-rifle-far");
  if (far250) {
    // 250m / 343m/s = 729ms.
    check("propagation delay is honoured", far250.onsetMs > 600 && far250.onsetMs < 900,
      `onset ${far250.onsetMs}ms, expected ~729ms`);
  }

  const stress = byId.get("stress-worstcase");
  if (stress) {
    check("worst case does not clip", stress.clippedSamples === 0,
      `${stress.clippedSamples} samples at full scale, peak ${stress.peakDb}dB (${stress.peak})`);
    check("worst case leaves headroom", stress.peak < 0.99, `peak ${stress.peak}`);
    check("voice cap held", stress.voices.dropped + stress.voices.stolen > 0
      && stress.voices.peakVoices <= 60,
      `peak ${stress.voices.peakVoices} voices, ${stress.voices.stolen} stolen, ${stress.voices.dropped} refused`);
  }

  const anyClip = results.filter((r) => r.clippedSamples > 0);
  check("nothing clips anywhere", anyClip.length === 0,
    anyClip.length ? anyClip.map((r) => r.id).join(", ") : "all cases clean");

  const stereo = results.filter((r) => r.group === "gunshot" && Math.abs(r.correlation) < 0.999);
  check("HRTF produces a stereo image", stereo.length > 0,
    `${stereo.length}/${results.filter((r) => r.group === "gunshot").length} gunshots decorrelated`);

  /* ---------------------------- output ---------------------------- */

  const columns = ["id", "peakDb", "rmsDb", "crestDb", "attackMs", "onsetMs", "decayMs",
    "centroidHz", "bodyCentroidHz", "correlation", "clippedSamples"];
  const header = ["sound", "peak dB", "rms dB", "crest", "atk ms", "onset ms",
    "decay ms", "cent Hz", "body Hz", "corr", "clip"];
  const rows = results.map((r) => columns.map((c) => String(r[c] ?? "-")));
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");

  console.log(`\n${line(header)}`);
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));

  console.log("\nCHECKS");
  let failures = 0;
  for (const c of checks) {
    if (!c.ok) failures += 1;
    console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
  }

  await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    url: URL,
    results,
    checks,
    consoleErrors,
    pageErrors,
  }, null, 2));

  console.log(`\nWrote ${results.length} measurements to ${path.relative(root, OUT_DIR)}`);
  if (pageErrors.length) {
    console.error(`\n${pageErrors.length} PAGE ERROR(S):`);
    pageErrors.slice(0, 8).forEach((e) => console.error(`  ${e}`));
    failures += 1;
  }
  const audioConsoleErrors = consoleErrors.filter((e) => /audio|Audio/.test(e));
  if (audioConsoleErrors.length) {
    console.error(`\n${audioConsoleErrors.length} AUDIO CONSOLE ERROR(S):`);
    audioConsoleErrors.slice(0, 8).forEach((e) => console.error(`  ${e}`));
    failures += 1;
  }

  if (failures) {
    console.error(`\n${failures} CHECK(S) FAILED.`);
    process.exitCode = 1;
  } else {
    console.log("\nAUDIO PROBE OK.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
