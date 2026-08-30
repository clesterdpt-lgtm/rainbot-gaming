#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Vesper review sheet

   One contact sheet that photographs the figure the way the defects
   actually present themselves:

     - a 12-bearing turntable, because a hole, a floating part or a
       seam is visible from exactly one side and a four-view sheet
       will miss it;
     - the two carry poses side by side, because the aim rework gave
       the trooper a resting pose it never had, and the arms are
       IK'd onto the weapon in both;
     - a close pass on the head, chest and back at gameplay distance.

   Usage: node scripts/saintfall-vesper-review.mjs [outdir]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.argv[2] || "output/saintfall/vesper-review");
const PORT = 44800 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

function tag(width, text) {
  const safe = String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return Buffer.from(`<svg width="${width}" height="24" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="24" fill="#0d0b10" fill-opacity="0.9"/>
    <text x="7" y="17" fill="#f4d487" font-family="monospace" font-size="12">${safe}</text>
  </svg>`);
}

async function sheet(tiles, cols, tw, th, file) {
  const rows = Math.ceil(tiles.length / cols);
  const buffer = await sharp({
    create: { width: cols * tw, height: rows * th, channels: 3, background: "#0d0b10" },
  }).composite(tiles.map((input, i) => ({
    input, left: (i % cols) * tw, top: Math.floor(i / cols) * th,
  }))).png().toBuffer();
  await writeFile(file, buffer);
  return file;
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      window.__SF.hideHud(true);
      window.__SF.hidePlayer(false);
      // Photographing the carry pose, so the lance must stay in hand.
      window.__SF.autoStow(false);
    });
    await mkdir(out, { recursive: true });

    const shoot = async (opts) => {
      const url = await page.evaluate((o) => {
        const T = window.__SF;
        T.weapons.setMode(o.mode || "ranged");
        T.setFiring(!!o.firing);
        T.setAds(o.ads || 0);
        T.poseFigure(o.bearing, {
          radius: o.radius, fov: o.fov, aim: o.aim ?? 0.55, eye: o.eye ?? 0.62,
        });
        T.hidePlayer(false);
        for (let i = 0; i < (o.settle || 90); i += 1) T.renderOnce(1 / 60);
        T.renderStill();
        return T.captureDataURL();
      }, opts);
      return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    };

    /* --- 12-bearing turntable --- */
    const turn = [];
    for (let i = 0; i < 12; i += 1) {
      const bearing = (i / 12) * Math.PI * 2;
      const buffer = await shoot({ bearing, radius: 4.1, fov: 38 });
      turn.push(await sharp(buffer).resize(240, 400, { fit: "cover" })
        .composite([{ input: tag(240, `${Math.round(i * 30)}deg`), left: 0, top: 0 }])
        .png().toBuffer());
    }
    const turnFile = await sheet(turn, 6, 240, 400, path.join(out, "turntable-12.png"));

    /* --- carry poses: resting vs committed ---

       Shot through the LIVE CHASE CAMERA, not `poseFigure`. That
       helper puts the player into free-camera mode, and free mode
       bypasses aim commitment on both sides - the body ignores it and
       the weapon takes its own free-camera branch. A comparison built
       on it produced two identical rows labelled as opposites, which
       is worse than no comparison at all. */
    const carry = [];
    const carryMetrics = [];
    for (const camYawDeg of [0, 70, 150]) {
      for (const [label, firing] of [["low ready", false], ["FIRING", true]]) {
        const shot = await page.evaluate(([yawDeg, fire]) => {
          const T = window.__SF;
          T.setTime("golden");
          T.clearEnemies();
          T.releaseCamera();
          T.teleport(-520, -562, 0);
          T.weapons.setMode("ranged");
          T.setFiring(false);
          T.setAds(0);
          T.setGaitInput(0, 0);
          T.setCam(0, -0.06, 2.9);
          /* Settle to ACTUAL rest before starting the case.
             Commitment carries a 0.55s hold and then decays, so the
             previous case was still partly committed while this one
             swung the camera - and the body dutifully followed. That
             produced a "low ready" row showing the body 62 degrees
             from where it was spawned, which looks exactly like the
             feature being broken and was the harness all along. Poll
             the real value instead of guessing a frame count. */
          for (let i = 0; i < 600 && T.aimCommitState().commit > 0.005; i += 1) {
            T.renderOnce(1 / 60);
          }
          T.teleport(-520, -562, 0);
          for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
          T.setCam(yawDeg * Math.PI / 180, -0.06, 2.9);
          T.setFiring(!!fire);
          for (let i = 0; i < 260; i += 1) T.renderOnce(1 / 60);
          T.renderStill();
          return {
            url: T.captureDataURL(),
            aim: T.aimCommitState(),
            reach: T.armReachCheck(),
          };
        }, [camYawDeg, firing]);
        const buffer = Buffer.from(shot.url.slice(shot.url.indexOf(",") + 1), "base64");
        const s = shot.aim;
        carryMetrics.push({ camYawDeg, firing, ...s, reach: shot.reach });
        carry.push(await sharp(buffer).resize(300, 400, { fit: "cover" })
          .composite([{
            input: tag(300, `cam ${camYawDeg}deg ${label}  twist ${s.chestTwistDeg}`),
            left: 0, top: 0,
          }]).png().toBuffer());
      }
    }
    const carryFile = await sheet(carry, 2, 300, 400, path.join(out, "carry-poses.png"));

    console.log("\ncam   state       commit  aimYaw  bodyYaw  chestTwist  bodyToAim  minArmSlack%");
    for (const m of carryMetrics) {
      const slack = Math.min(...m.reach.map((r) => r.slackPct));
      console.log(`${String(m.camYawDeg).padStart(3)}   `
        + `${(m.firing ? "FIRING" : "low ready").padEnd(11)}`
        + `${String(m.commit).padStart(6)}${String(m.aimYawDeg).padStart(8)}`
        + `${String(m.bodyYawDeg).padStart(9)}${String(m.chestTwistDeg).padStart(12)}`
        + `${String(m.bodyToAimDeg).padStart(11)}${slack.toFixed(1).padStart(14)}`);
    }
    const worstSlack = Math.min(...carryMetrics.flatMap((m) => m.reach.map((r) => r.slackPct)));
    if (worstSlack <= 0) {
      console.log(`ARM OVER-EXTENDED: minimum slack ${worstSlack.toFixed(1)}%`);
      process.exitCode = 1;
    }

    /* --- close pass, gameplay distance --- */
    const close = [];
    for (const [name, bearing, aim] of [
      ["helm front", -Math.PI / 2, 0.86], ["helm rear", Math.PI / 2, 0.86],
      ["chest", -Math.PI / 2, 0.66], ["back", Math.PI / 2, 0.66],
      ["hips 3/4", Math.PI * 0.75, 0.44], ["legs", -Math.PI / 3, 0.22],
    ]) {
      const buffer = await shoot({ bearing, radius: 1.9, fov: 30, aim, eye: aim });
      close.push(await sharp(buffer).resize(300, 340, { fit: "cover" })
        .composite([{ input: tag(300, name), left: 0, top: 0 }])
        .png().toBuffer());
    }
    const closeFile = await sheet(close, 3, 300, 340, path.join(out, "close-pass.png"));

    console.log(`page/console errors: ${errors.length}`);
    if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
    for (const f of [turnFile, carryFile, closeFile]) console.log(path.relative(root, f));
    if (errors.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
