#!/usr/bin/env node
/* ============================================================
   SAINTFALL - weapon review harness

   Photographs the carried weapon the way it will actually be seen:
   over the shoulder at gameplay distance, at hip and shouldered,
   at rest and mid-recoil. Plus a detail turnaround, because the
   ornament is the silhouette on a dark iron object and it has to
   survive being looked at.

   Reuses the bestiary's figure-ground measurement. The question
   for a weapon is the same as for a creature and gets the same
   answer format: can you see it against the ground it is carried
   over, and does it have internal form or is it a black bar.

   Usage:
     node scripts/saintfall-weapon-shots.mjs
     node scripts/saintfall-weapon-shots.mjs --pattern autogun
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) args[k] = true;
      else { args[k] = n; i += 1; }
    } else args._.push(t);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(root, args.out || "output/saintfall/weapons");
const PORT = Number(args.port || 49000 + (process.pid % 9000));
const BASE = `http://127.0.0.1:${PORT}`;

/* Stood on the Pilgrim's Road: pale paving under, warm dune behind,
   which is the least forgiving ground a dark iron object gets. */
const STAGE = { x: -8, z: 300 };

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function grab(page, file) {
  const url = await page.evaluate(() => window.__SF.captureDataURL());
  const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  if (file) await writeFile(file, buf);
  return buf;
}

async function figureGround(withBuf, withoutBuf) {
  const [ra, rb] = await Promise.all([
    sharp(withBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(withoutBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const A = ra.data;
  const B = rb.data;
  const luma = (b, i) => b[i] * 0.2126 + b[i + 1] * 0.7152 + b[i + 2] * 0.0722;
  let n = 0;
  let sf = 0;
  let sg = 0;
  let lo = 255;
  let hi = 0;
  const f = [0, 0, 0];
  const g = [0, 0, 0];
  for (let i = 0; i < A.length; i += 3) {
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    if (d < 24) continue;
    const lf = luma(A, i);
    sf += lf; sg += luma(B, i);
    for (let c = 0; c < 3; c += 1) { f[c] += A[i + c]; g[c] += B[i + c]; }
    if (lf < lo) lo = lf;
    if (lf > hi) hi = lf;
    n += 1;
  }
  if (!n) return null;
  const F = f.map((v) => v / n);
  const G = g.map((v) => v / n);
  const rbar = (F[0] + G[0]) / 2;
  const dist = Math.sqrt(
    (2 + rbar / 256) * (F[0] - G[0]) ** 2 + 4 * (F[1] - G[1]) ** 2
    + (2 + (255 - rbar) / 256) * (F[2] - G[2]) ** 2
  );
  return {
    pixels: n,
    coveragePct: Number(((n / (A.length / 3)) * 100).toFixed(2)),
    figureLuma: Number((sf / n).toFixed(1)),
    groundLuma: Number((sg / n).toFixed(1)),
    colourDistance: Number(dist.toFixed(1)),
    figureRange: [Math.round(lo), Math.round(hi)],
  };
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  const pageErrors = [];

  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--hide-scrollbars", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1400, height: 900 },
    })).newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      window.__SF.hideHud(true);
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    const patterns = await page.evaluate(() => window.__SF.listPatterns());
    console.log(`patterns: ${patterns.join(", ")}`);
    const wanted = args.pattern && args.pattern !== true
      ? String(args.pattern).split(",").map((s) => s.trim())
      : patterns;

    const rows = [];
    for (const key of wanted) {
      await page.evaluate((s) => {
        const T = window.__SF;
        T.equipWeapon(s.key);
        T.releaseCamera();
        T.teleport(s.x, s.z, Math.PI * 0.25);
        T.hidePlayer(false);
        T.setAds(0);
        T.advanceTime(1.6, 1 / 60);
      }, { ...STAGE, key });

      const stats = await page.evaluate(() => window.__SF.report().weapons);
      console.log(`\n${key}: ${stats.triangles} triangles`);
      const reach = await page.evaluate(() => window.__SF.armReachCheck());
      for (const r of reach || []) {
        const bad = r.handToGrip > 0.06 || r.slackPct < 5;
        console.log(`  ${bad ? "!!" : "  "} ${r.arm.padEnd(8)} reach ${r.reach}m `
          + `· needs ${r.needed}m · slack ${r.slackPct}% `
          + `· hand is ${r.handToGrip}m from the grip`);
      }

      /* --- gameplay views --- */
      /* Camera placement is COMPUTED from the weapon's own bounds,
         not from offsets relative to the player. The hand-tuned
         version put the detail camera 1.2m from a 1.85m trooper and
         photographed the inside of his coat. */
      const views = [
        { id: "carry", ads: 0, fire: 0, fill: 0.28, az: 0.95, el: 0.30, fov: 46 },
        { id: "shouldered", ads: 1, fire: 0, fill: 0.30, az: 0.60, el: 0.22, fov: 44 },
        { id: "firing", ads: 1, fire: 5, fill: 0.30, az: 0.60, el: 0.22, fov: 44 },
        { id: "detail-right", ads: 0, fire: 0, fill: 0.78, az: 1.35, el: 0.18, fov: 34 },
        { id: "detail-left", ads: 0, fire: 0, fill: 0.78, az: -2.05, el: 0.14, fov: 34 },
        { id: "detail-top", ads: 0, fire: 0, fill: 0.72, az: 1.10, el: 0.95, fov: 34 },
      ];

      for (const v of views) {
        await page.evaluate((spec) => {
          const T = window.__SF;
          T.setAds(spec.ads);
          T.advanceTime(0.7, 1 / 60);
          if (spec.fire) T.fireWeapon(spec.fire);
          const b = T.weaponBounds();
          // Distance that makes the weapon fill `fill` of the frame
          // height at this fov, from its own bounding radius.
          const half = (spec.fov * Math.PI) / 360;
          const dist = (b.radius / Math.max(0.05, spec.fill)) / Math.tan(half);
          const cam = [
            b.centre[0] + Math.cos(spec.az) * Math.cos(spec.el) * dist,
            b.centre[1] + Math.sin(spec.el) * dist,
            b.centre[2] + Math.sin(spec.az) * Math.cos(spec.el) * dist,
          ];
          T.lookAt(cam, b.centre, spec.fov);
          for (let i = 0; i < 5; i += 1) T.renderOnce(1 / 60);
        }, v);
        await grab(page, path.join(OUT, `${key}-${v.id}.png`));
        console.log(`  view ${v.id}`);
      }

      /* --- figure/ground on the detail view --- */
      await page.evaluate(() => {
        const T = window.__SF;
        T.setAds(0);
        T.advanceTime(0.6, 1 / 60);
        const b = T.weaponBounds();
        const half = (34 * Math.PI) / 360;
        const dist = (b.radius / 0.78) / Math.tan(half);
        T.lookAt([
          b.centre[0] + Math.cos(1.35) * Math.cos(0.18) * dist,
          b.centre[1] + Math.sin(0.18) * dist,
          b.centre[2] + Math.sin(1.35) * Math.cos(0.18) * dist,
        ], b.centre, 34);
        for (let i = 0; i < 5; i += 1) T.renderOnce(1 / 60);
      });
      const withBuf = await grab(page, null);
      await page.evaluate(() => {
        window.__SF.weapons.current.root.visible = false;
        for (let i = 0; i < 5; i += 1) window.__SF.renderOnce(1 / 60);
      });
      const withoutBuf = await grab(page, null);
      await page.evaluate(() => {
        window.__SF.weapons.current.root.visible = true;
        for (let i = 0; i < 3; i += 1) window.__SF.renderOnce(1 / 60);
      });

      /* And the same measurement on the WHOLE FIGURE, silhouetted
         against the landscape. That is the readability case that
         actually matters - spotting an armed trooper at distance -
         and the weapon-only number is misleading when the weapon
         happens to sit against the coat rather than against sand. */
      await page.evaluate(() => {
        const T = window.__SF;
        const p = T.player.position;
        T.lookAt([p.x + 3.2, p.y + 1.5, p.z + 2.6], [p.x, p.y + 1.05, p.z], 40);
        for (let i = 0; i < 5; i += 1) T.renderOnce(1 / 60);
      });
      const figWith = await grab(page, path.join(OUT, `${key}-figure.png`));
      await page.evaluate(() => {
        window.__SF.hidePlayer(true);
        for (let i = 0; i < 5; i += 1) window.__SF.renderOnce(1 / 60);
      });
      const figWithout = await grab(page, null);
      await page.evaluate(() => {
        window.__SF.hidePlayer(false);
        for (let i = 0; i < 3; i += 1) window.__SF.renderOnce(1 / 60);
      });
      const cfg = await figureGround(figWith, figWithout);
      if (cfg) {
        console.log(`  TROOPER vs landscape: luma ${cfg.figureLuma} vs ${cfg.groundLuma} `
          + `· colour distance ${cfg.colourDistance} `
          + `· range ${cfg.figureRange[0]}-${cfg.figureRange[1]} `
          + `· ${cfg.coveragePct}% of frame`);
        if (cfg.figureRange[1] - cfg.figureRange[0] < 90) {
          console.error("  !! trooper has a narrow internal value range - it is a "
            + "silhouette, not a modelled figure");
        }
      }

      const fg = await figureGround(withBuf, withoutBuf);
      if (fg) {
        console.log(`  figure/ground: weapon luma ${fg.figureLuma} vs ground ${fg.groundLuma} `
          + `· colour distance ${fg.colourDistance} · range ${fg.figureRange[0]}-${fg.figureRange[1]} `
          + `· ${fg.coveragePct}% of frame`);
        /* NOT gated on separation.
           Carried at the shoulder the weapon sits against the
           trooper's own coat, which is deliberately dark, so
           "distance from what is behind it" measures the carry pose
           rather than the weapon. The gate fired on a weapon that
           was perfectly legible in frame - the same mistake as the
           luma-only creature gate, one level down. What IS worth
           gating is the weapon's own internal range: a machine with
           no value spread is a black bar however well it separates. */
        if (fg.colourDistance < 45) {
          console.log("     (low separation is expected here - the weapon is "
            + "against the coat, not the landscape)");
        }
        if (fg.figureRange[1] - fg.figureRange[0] < 70) {
          console.error("  !! narrow internal value range - it is a black bar, not a machine");
        }
      }
      rows.push({ key, stats, figureGround: fg, trooper: cfg });
    }

    const report = await page.evaluate(() => window.__SF.report());
    await writeFile(path.join(OUT, "report.json"), JSON.stringify({
      capturedAt: new Date().toISOString(), stage: STAGE, weapons: rows,
      engine: report, pageErrors,
    }, null, 2));

    console.log(`\nfps ${report.fps} · frame ${report.frameMs}ms`);
    if (pageErrors.length) {
      console.error(`\n${pageErrors.length} page error(s):`);
      pageErrors.slice(0, 5).forEach((e) => console.error(`  ${e}`));
      process.exitCode = 1;
    }
    console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
