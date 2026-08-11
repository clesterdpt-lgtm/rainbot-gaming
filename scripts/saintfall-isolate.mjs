#!/usr/bin/env node
/* ============================================================
   SAINTFALL - differential isolation probe

   Captures one pose repeatedly with a single subsystem toggled off
   each time, and reports how many pixels changed and by how much.

   This exists because guessing at the cause of a visual artefact
   has a poor record on this codebase: a reviewer's SYMPTOM is
   evidence, but the MECHANISM is a hypothesis, and mine are wrong
   as often as anyone's. A differential A/B names the subsystem in
   one run instead of three rounds of plausible edits.

   Usage:
     node scripts/saintfall-isolate.mjs --pose saint-face
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true])
);
const POSE = String(args.pose || "saint-face");
const OUT = path.resolve(root, args.out || "output/saintfall/isolate");
const PORT = 45000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;

/* Each variant names one thing and turns exactly that off. */
const VARIANTS = [
  { id: "base", apply: () => {} },
  { id: "no-vfx", apply: (T) => { T.vfx.setVisible(false); } },
  {
    id: "no-shafts",
    apply: (T) => { if (T.vfx.shafts) T.vfx.shafts.visible = false; },
  },
  {
    id: "no-points",
    apply: (T) => {
      T.vfx.group.children.forEach((c) => {
        if (c.type === "Points") c.visible = false;
      });
    },
  },
  {
    id: "no-streamers",
    apply: (T) => {
      const s = T.vfx.group.children.find((c) => c.name === "streamers");
      if (s) s.visible = false;
    },
  },
  {
    id: "no-rim-mesh",
    apply: (T) => {
      const m = T.world.group.children.find((c) => c.name === "rim");
      if (m) m.visible = false;
    },
  },
  {
    // Set on the ATMOSPHERE, not on the light. sky.update() copies
    // atmos.sunIntensity onto the light every frame, so writing the
    // light directly is undone before the next render and the probe
    // reports "the sun does nothing" - which is a statement about
    // the probe, not about the renderer.
    id: "no-sun",
    apply: (T) => { T.atmos.sunIntensity = 0; },
  },
  {
    id: "no-env",
    apply: (T) => { T.render.scene.environmentIntensity = 0; },
  },
  {
    id: "no-bloom",
    apply: (T) => { T.render.setBloom(0); },
  },
  {
    // The AO pass is new and depends on a depth texture surviving
    // the multisample resolve. If that ever stops working the term
    // goes uniformly white and the frame looks merely "a bit flat"
    // - which is exactly the kind of silent failure that ships.
    id: "no-ao",
    apply: (T) => { T.render.setAo(0); },
  },
  {
    id: "no-rim-light",
    apply: (T) => {
      T.ctx.atmos.uniforms.uRim.value.set(0, 2.55, 0);
      T.render.scene.traverse((o) => {
        const s = o.material && o.material.userData && o.material.userData.sfShader;
        if (s && s.uniforms.uRim) s.uniforms.uRim.value.x = 0;
      });
    },
  },
];

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

async function diff(a, b) {
  const ra = await sharp(a).removeAlpha().raw().toBuffer();
  const rb = await sharp(b).removeAlpha().raw().toBuffer();
  let changed = 0;
  let total = 0;
  let peak = 0;
  for (let i = 0; i < ra.length; i += 3) {
    const d = Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1])
      + Math.abs(ra[i + 2] - rb[i + 2]);
    if (d > 9) changed += 1;
    total += d;
    if (d > peak) peak = d;
  }
  const px = ra.length / 3;
  return {
    changedPct: Number(((changed / px) * 100).toFixed(2)),
    meanDelta: Number((total / px).toFixed(2)),
    peakDelta: peak,
  };
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--hide-scrollbars", "--mute-audio"],
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      window.__SF.hideHud(true);
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await page.evaluate(() => window.__SF.advanceTime(3, 1 / 60));

    const files = {};
    const baseSun = await page.evaluate(() => window.__SF.atmos.sunIntensity);
    for (const variant of VARIANTS) {
      await page.evaluate((sun) => {
        const T = window.__SF;
        T.vfx.setVisible(true);
        T.vfx.group.children.forEach((c) => { c.visible = true; });
        const rim = T.world.group.children.find((c) => c.name === "rim");
        if (rim) rim.visible = true;
        T.atmos.sunIntensity = sun;
        T.render.scene.environmentIntensity = T.atmos.envIntensity;
        T.render.setBloom(0.5);
        T.render.setAo(0.85);
        T.ctx.atmos.uniforms.uRim.value.x = 0.155;
        T.render.scene.traverse((o) => {
          const s = o.material && o.material.userData && o.material.userData.sfShader;
          if (s && s.uniforms.uRim) {
            s.uniforms.uRim.value.x = 0.155 * (o.material.userData.sfRim ?? 1);
          }
        });
      }, baseSun);
      await page.evaluate((body) => {
        // eslint-disable-next-line no-new-func
        new Function("T", body)(window.__SF);
      }, variant.apply.toString().replace(/^[^{]*\{/, "").replace(/\}\s*$/, ""));
      await page.evaluate((id) => window.__SF.setPose(id), POSE);
      // Pin the clock to the same absolute value for every variant.
      // Advancing 1.5s per variant moved every particle between
      // captures and put a 2% noise floor under the whole
      // comparison - which was larger than four of the effects
      // being measured.
      await page.evaluate(() => {
        window.__SF.atmos.elapsed = 30;
        window.__SF.atmos.sync();
        for (let i = 0; i < 8; i += 1) window.__SF.renderOnce(0);
      });
      const url = await page.evaluate(() => window.__SF.captureDataURL());
      const file = path.join(OUT, `${variant.id}.png`);
      await writeFile(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
      files[variant.id] = file;
      console.log(`captured ${variant.id}`);
    }

    console.log(`\npose "${POSE}" - difference from base:\n`);
    for (const variant of VARIANTS) {
      if (variant.id === "base") continue;
      const d = await diff(files.base, files[variant.id]);
      console.log(
        `  ${variant.id.padEnd(16)} changed ${String(d.changedPct).padStart(6)}%   `
        + `mean ${String(d.meanDelta).padStart(7)}   peak ${d.peakDelta}`
      );
    }
    if (errors.length) console.error("\npage errors:", errors.slice(0, 4));
    console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
