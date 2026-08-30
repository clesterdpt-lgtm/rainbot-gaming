#!/usr/bin/env node
/* ============================================================
   SAINTFALL - character review

   A turntable of the player figure plus a strip of frames from each
   animation, and numbers for whether those animations actually move.

   Character work needs a turntable and not the level's composed
   poses. A figure that reads from the one angle a beauty shot uses
   can be broken from the other seven - the halo is an arc from the
   side and a stack of blocks from the front - and an animation looks
   fine in a still by definition, because a still is where nothing is
   moving.

   Usage:
     node scripts/saintfall-character.mjs
     node scripts/saintfall-character.mjs --bearings 12
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
const OUT = path.resolve(root, args.out || "output/saintfall/character");
const BEARINGS = Number(args.bearings || 8);
const PORT = 41000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;

const findings = [];
const note = (sev, msg, detail) => findings.push({ sev, msg, detail });

/** Silhouette coverage and how much of the frame the figure fills. */
async function silhouette(buf, ref) {
  const a = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(ref).removeAlpha().raw().toBuffer();
  let px = 0;
  let lumaSum = 0;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < a.data.length; i += 3) {
    const d = Math.abs(a.data[i] - b[i]) + Math.abs(a.data[i + 1] - b[i + 1])
      + Math.abs(a.data[i + 2] - b[i + 2]);
    if (d <= 14) continue;
    px += 1;
    const l = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
    lumaSum += l;
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  const total = a.info.width * a.info.height;
  return {
    coverPct: Number(((px / total) * 100).toFixed(2)),
    meanLuma: px ? Number((lumaSum / px).toFixed(1)) : 0,
    range: px ? [Math.round(lo), Math.round(hi)] : [0, 0],
    px,
  };
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await rm(OUT, { recursive: true, force: true });
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
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=ultra`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    window.__SF.hideHud(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  await page.evaluate(() => window.__SF.studio(true));
  const site = await page.evaluate(() => window.__SF.findFlatSite(6));
  console.log(`site: ${Math.round(site[0])}, ${Math.round(site[1])} `
    + `(ground varies ${site[2]}m over the orbit)`);
  const info = await page.evaluate(() => window.__SF.figureInfo());
  console.log("=== FIGURE ===");
  console.log(`  ${info.triangles} triangles · ${info.heightM}m tall `
    + `· ${info.widthM}m wide · ${info.depthM}m deep`);
  console.log(`  source ${info.assetSource} · ${info.drawCalls} calls · ${info.materials} materials`
    + ` · ${info.joints} joints`);
  console.log(`  pivots: ${JSON.stringify(info.pivots)}`);
  if (info.heightM > 2.6) {
    note("WARN", `figure measures ${info.heightM}m against a 1.85m design height`);
  }

  const grab = async (file) => {
    const url = await page.evaluate(() => {
      /* Settle the frame without moving the clock. These three calls
         used to be renderOnce(1/60), which stepped the world 0.05s
         behind the caller's back on EVERY screenshot. */
      for (let i = 0; i < 3; i += 1) window.__SF.renderStill();
      return window.__SF.captureDataURL();
    });
    const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    if (file) await writeFile(file, buf);
    return buf;
  };

  /* The clean plate is captured PER BEARING. One plate reused for
     every angle diffs two different backgrounds as well as the
     figure, and reports 100% coverage from seven of eight bearings -
     which reads as a figure that fills the frame rather than as a
     broken measurement. */
  const plateFor = async (bearing) => {
    await page.evaluate((b) => {
      window.__SF.poseFigure(b, { radius: 5.0, fov: 30, aim: 0.52, eye: 0.60 });
      window.__SF.hidePlayer(true);
    }, bearing);
    return grab(null);
  };

  /* ---------------- standing asserts ---------------- */
  console.log("\n=== ASSERTS ===");
  const asserts = await page.evaluate(() => window.__SF.figureAsserts());
  const failedAsserts = asserts.filter((a) => !a.pass);
  for (const a of asserts) {
    if (!a.pass) console.log(`  FAIL  ${a.name} — ${a.detail}`);
  }
  console.log(`  ${asserts.length - failedAsserts.length}/${asserts.length} passed`);
  for (const a of failedAsserts) note("ERROR", `${a.name}: ${a.detail}`);

  /* ---------------- turntable ---------------- */
  console.log(`\n=== TURNTABLE (${BEARINGS}) ===`);
  // The production target is the Vesper Censer-Lance.  Leaving the
  // default autogun equipped made the turntable's side read a long
  // horizontal industrial beam and judged the wrong silhouette.
  await page.evaluate(() => window.__SF.equipWeapon("glaive"));
  const cover = [];
  for (let i = 0; i < BEARINGS; i += 1) {
    const bearing = (i / BEARINGS) * Math.PI * 2;
    const plate = await plateFor(bearing);
    await page.evaluate((b) => {
      window.__SF.poseFigure(b, { radius: 5.0, fov: 30, aim: 0.52, eye: 0.60 });
      window.__SF.player.state.figureOverride = true;
    }, bearing);
    const buf = await grab(path.join(OUT, `turn-${i}.png`));
    const sil = await silhouette(buf, plate);
    cover.push(sil.coverPct);
    console.log(`  b${i}  cover ${String(sil.coverPct).padStart(6)}%  `
      + `luma ${String(sil.meanLuma).padStart(6)}  range ${sil.range[0]}-${sil.range[1]}`);
  }
  const cmin = Math.min(...cover);
  const cmax = Math.max(...cover);
  console.log(`  silhouette varies ${cmin}% - ${cmax}% (ratio ${(cmax / cmin).toFixed(2)})`);
  /* A figure whose outline is the same area from every side is a
     cylinder. Pauldrons, halo and tabard exist to make the read
     change as it turns. */
  if (cmax / cmin < 1.15) {
    note("WARN", `silhouette barely changes with bearing (${(cmax / cmin).toFixed(2)}x)`);
  }

  /* ---------------- animations ---------------- */
  const actions = await page.evaluate(() => window.__SF.listActions());
  console.log(`\n=== ANIMATIONS (${actions.length}) ===`);
  for (const act of actions) {
    const probe = await page.evaluate((a) => window.__SF.animProbe(a, 1.3), act);
    console.log(`  ${act.padEnd(12)} peak ${String(probe.peakTipSpeed).padStart(7)} m/s  `
      + `travel ${String(probe.travelM).padStart(6)}m  arc ${String(probe.arcDiagonalM).padStart(5)}m  `
      + `accel x${probe.speedRatio}  body ${String(probe.bodyTravelM).padStart(6)}m`
      + `  legs ${String(probe.legTravelM).padStart(6)}m`
      + `  reach ${String(probe.reachM).padStart(6)}m`);
    /* A swing has to move the BODY. Without this every clip in the
       file passed while the figure was a statue holding a moving
       stick, because tip travel is blind to whether anything but the
       weapon turned. */
    const bodyFloor = act.startsWith("melee") ? 0.12 : 0.04;
    if (probe.bodyTravelM < bodyFloor) {
      note("WARN", `"${act}" does not move the body (${probe.bodyTravelM}m, need ${bodyFloor}m)`);
    }
    /* A two-handed stroke is delivered from the feet. Without this the
       swings passed every gate while the legs moved at the level of
       shadow noise and every attack came from a parade rest. */
    if (act.startsWith("melee") && probe.legTravelM < 0.10) {
      note("WARN", `"${act}" does not use the legs (${probe.legTravelM}m, need 0.10m)`);
    }
    /* The arc gate is for ATTACKS only. A reload is a hand action -
       the weapon is meant to stay roughly where it is while the
       magazine changes - so judging it on how far the muzzle travels
       flags correct animation as broken. */
    /* An attack has to threaten SPACE, and there are two ways to do
       it. A swing sweeps: the tip fills a box, and `arcDiagonalM`
       measures that box. A thrust does the opposite - it goes out
       and comes back down one line, so its box is nearly flat no
       matter how hard it is driven, and judging melee1 on the box
       alone reported "barely moves the weapon" for a stroke whose
       tip covers 1.36m at 14m/s. Depth past the carry pose is the
       axis a swing does NOT use, so the two gates cannot both be
       cleared by the same cheat: an attack that neither sweeps nor
       extends still fails.

       0.30m is a regression floor, not an aspiration. The thrust
       measures 0.365m and cannot go much past it: at full extension
       the lead arm is pinned at the 92% ceiling the reach constraint
       enforces, so the depth comes from running the shaft through
       the grip rather than from reaching further, and that runs out
       too. The swings sit at 0.008-0.052m, so the gate has a wide
       margin in the direction that matters. */
    const isAttack = act.startsWith("melee");
    if (isAttack && probe.arcDiagonalM < 1.2 && probe.reachM < 0.30) {
      note("WARN", `"${act}" barely moves the weapon `
        + `(arc ${probe.arcDiagonalM}m, reach ${probe.reachM}m)`);
    }
    if (!isAttack && probe.travelM < 0.15) {
      note("WARN", `"${act}" does not move at all (travel ${probe.travelM}m)`);
    }
    if (act.startsWith("melee") && probe.peakTipSpeed < 8) {
      note("WARN", `"${act}" peaks at ${probe.peakTipSpeed} m/s - reads as a poke, not a blow`);
    }
    if (act.startsWith("melee") && probe.speedRatio < 2.2) {
      note("WARN", `"${act}" has no acceleration (x${probe.speedRatio}) - it slides`);
    }

    // A strip of frames through the action, so the shape of the
    // motion can be read rather than inferred from one still.
    const frames = [];
    await page.evaluate((a) => {
      window.__SF.poseFigure(Math.PI * 0.35, { radius: 5.6, fov: 32, aim: 0.5, eye: 0.58 });
      window.__SF.player.state.figureOverride = true;
      window.__SF.beginAction(a);
    }, act);
    /* Sampled at FRACTIONS of the clip, weighted toward the action.
       Stepping evenly across the duration spends the last third in
       the rest pose - the final two to three frames of every strip
       came back bit-identical, so half of each strip showed nothing.
       `freezeAction` seeks the timeline directly instead of racing
       the clock forward. */
    const dur = await page.evaluate((a) => window.__SF.actionDuration(a), act);
    const FR = [0.0, 0.18, 0.34, 0.46, 0.62, 0.90];
    for (let k = 0; k < 6; k += 1) {
      await page.evaluate(([a, t]) => window.__SF.freezeAction(a, t),
        [act, Math.min(dur || 0.8, 1.6) * FR[k]]);
      frames.push(await sharp(await grab(null)).resize(320, 391).toBuffer());
    }
    await sharp({ create: { width: 320 * 6, height: 391, channels: 3, background: { r: 12, g: 10, b: 14 } } })
      .composite(frames.map((input, k) => ({ input, left: 320 * k, top: 0 })))
      .png().toFile(path.join(OUT, `anim-${act}.png`));
  }

  /* ---------------- report ---------------- */
  console.log("\n=== FINDINGS ===");
  if (!findings.length) console.log("  none");
  for (const f of findings) console.log(`  ${f.sev}  ${f.msg}`);
  if (pageErrors.length) console.error("page errors:", pageErrors.slice(0, 3));
  await writeFile(path.join(OUT, "report.json"),
    JSON.stringify({ info, cover, findings, pageErrors }, null, 2));
  console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
