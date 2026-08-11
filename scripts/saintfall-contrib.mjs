#!/usr/bin/env node
/* ============================================================
   SAINTFALL - contribution mask

   Renders one pose twice, with every mesh whose name starts with
   --prefix shown and then hidden, and reports which pixels those
   meshes actually paint and at what value against their surroundings.

   This exists because looking at a frame cannot tell you whether a
   surface is DARK or ABSENT. The Pilgrim's Road spent three rounds
   of "the flagstones are the wrong colour" before this mask showed
   the near-field stones were contributing nothing at all: they were
   sunk under a terrain mesh that sits up to 0.12m above the analytic
   height they were placed against, and the sand-coloured quads
   between the joints were sand.

   Usage:
     node scripts/saintfall-contrib.mjs --prefix road --pose road
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
const PREFIX = String(args.prefix || "road");
// Which group to mask in. `world` matches meshes by name prefix;
// `enemies` masks the whole enemy group, which is how you ask "are
// there actually any enemies in this shot?" - a question that looking
// at the frame answers badly, because a 2.9m machine at 300m is a
// dozen dark pixels that read as scenery.
const GROUP = String(args.group || "world");
const POSE = String(args.pose || "road");
const OUT = path.resolve(root, args.out || "output/saintfall/contrib");
const PORT = 46000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize(); window.__SF.hideHud(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  const hits = await page.evaluate(({ p, g }) => {
    const out = [];
    if (g === "enemies") {
      const T = window.__SF;
      return T.enemies.live.map((e, i) => `${e.spec === undefined ? "?" : ""}enemy${i}`);
    }
    window.__SF.world.group.traverse((o) => { if (o.isMesh && o.name.startsWith(p)) out.push(o.name); });
    return out;
  }, { p: PREFIX, g: GROUP });
  if (!hits.length) {
    console.error(GROUP === "enemies"
      ? "no live enemies - nothing to measure"
      : `no meshes named "${PREFIX}*" - nothing to measure`);
    process.exitCode = 1;
  }
  console.log(`masking ${hits.length} ${GROUP === "enemies" ? "enemy instance(s)" : "mesh(es)"}`);

  const shoot = async (hide) => {
    await page.evaluate(({ p, h, pose, g }) => {
      if (g === "enemies") window.__SF.enemies.group.visible = !h;
      else {
        window.__SF.world.group.traverse((o) => {
          if (o.isMesh && o.name.startsWith(p)) o.visible = !h;
        });
      }
      window.__SF.setPose(pose);
      // Clock pinned so drifting particles cannot masquerade as a
      // contribution difference.
      window.__SF.atmos.elapsed = 30;
      window.__SF.atmos.sync();
      for (let i = 0; i < 8; i += 1) window.__SF.renderOnce(0);
    }, { p: PREFIX, h: hide, pose: POSE, g: GROUP });
    const url = await page.evaluate(() => window.__SF.captureDataURL());
    return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  };

  const on = await shoot(false);
  const off = await shoot(true);
  await writeFile(path.join(OUT, `${PREFIX}-on.png`), on);
  await writeFile(path.join(OUT, `${PREFIX}-off.png`), off);

  const a = await sharp(on).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(off).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = a.info;
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const mine = [];
  const rest = [];
  const sum = { mr: 0, mg: 0, mb: 0, rr: 0, rg: 0, rb: 0 };
  const mask = Buffer.alloc(width * height * 3);
  for (let p = 0; p < width * height; p += 1) {
    const i = p * 3;
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1])
      + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 12) {
      mine.push(lum(a.data, i));
      sum.mr += a.data[i]; sum.mg += a.data[i + 1]; sum.mb += a.data[i + 2];
      mask[i] = 255; mask[i + 1] = 60; mask[i + 2] = 60;
    } else {
      rest.push(lum(a.data, i));
      sum.rr += a.data[i]; sum.rg += a.data[i + 1]; sum.rb += a.data[i + 2];
      mask[i] = a.data[i] >> 1; mask[i + 1] = a.data[i + 1] >> 1; mask[i + 2] = a.data[i + 2] >> 1;
    }
  }
  await sharp(mask, { raw: { width, height, channels: 3 } }).png()
    .toFile(path.join(OUT, `${PREFIX}-mask.png`));

  const q = (arr, p) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((x, y) => x - y);
    return Math.round(s[Math.floor(s.length * p)]);
  };
  console.log(`\n"${GROUP === "enemies" ? "enemies" : PREFIX}" paints ${mine.length} px (${(mine.length / (width * height) * 100).toFixed(2)}% of frame)`);
  console.log(`  its luma   : p10 ${q(mine, 0.1)}  p50 ${q(mine, 0.5)}  p90 ${q(mine, 0.9)}`);
  console.log(`  everything else : p10 ${q(rest, 0.1)}  p50 ${q(rest, 0.5)}  p90 ${q(rest, 0.9)}`);
  console.log(`  separation : ${q(rest, 0.5) - q(mine, 0.5)} luma below the rest of the frame`);

  /* Redmean colour distance as well as luma, because a subject can be
     perfectly legible and still score zero on luma alone - which is
     exactly the case a signal colour is FOR. The Thresher against its
     own hive is violet on violet: same value, and the only thing that
     tells them apart is hue. */
  const n1 = Math.max(1, mine.length);
  const n2 = Math.max(1, rest.length);
  const c1 = [sum.mr / n1, sum.mg / n1, sum.mb / n1];
  const c2 = [sum.rr / n2, sum.rg / n2, sum.rb / n2];
  const rm = (c1[0] + c2[0]) / 2;
  const dr = c1[0] - c2[0];
  const dg = c1[1] - c2[1];
  const db = c1[2] - c2[2];
  const dist = Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg
    + (2 + (255 - rm) / 256) * db * db);
  console.log(`  mean rgb   : [${c1.map((v) => Math.round(v)).join(",")}] vs `
    + `[${c2.map((v) => Math.round(v)).join(",")}]`);
  console.log(`  colour distance : ${dist.toFixed(1)}`);
  if (errors.length) console.error("page errors:", errors.slice(0, 3));
  console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
