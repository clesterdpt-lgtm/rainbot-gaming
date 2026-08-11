#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the low-ready arms, from all round

   Every previous attempt to photograph the carry arms hit the same
   wall: committed, the body stands a fixed MAX_CHEST_TWIST off the
   camera bearing, so the chase camera frames the trooper identically
   from every bearing and always from behind. Free camera escapes that
   and gates the carry aim to zero, so it shows a pose the game never
   holds.

   But the lock only exists while COMMITTED. At low ready the aim
   follow is switched off, the body holds its own yaw, and the chase
   camera orbits freely around it. Low ready is also where the trooper
   spends most of the time, and where the inversion was reported from.

   So this is the turntable that was supposedly impossible: the real
   gameplay camera, the real low-ready pose, seen from all round.

   Usage: node scripts/saintfall-lowready-arms.mjs [label]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const label = process.argv[2] || "now";
const out = path.resolve(root, "output/saintfall/lowready-arms");
const PORT = 43100 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

/* `--close` drops to four near bearings and crops in on the chest:
   the turntable says where the arms are, this says what they look
   like. The trigger elbow's side is only unambiguous from in front. */
const CLOSE = process.argv.includes("--close");
const TILE_W = 420;
const TILE_H = CLOSE ? 440 : 560;
const BEARINGS = CLOSE ? [150, 180, 210, 240] : [0, 45, 90, 135, 180, 225, 270, 315];
/* Looking DOWN from above for the close pass. The chase camera aims
   at head height, so a short boom simply crops the arms off the
   bottom of the frame - the first close run photographed four helmets.
   From above, the elbow's side is also the least ambiguous. */
const BOOM = CLOSE ? 2.3 : 2.7;
const CAM_PITCH = CLOSE ? -0.52 : -0.06;

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
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(`<svg width="${width}" height="22">`
    + `<rect width="${width}" height="22" fill="#12100c"/>`
    + `<text x="6" y="16" font-family="monospace" font-size="13" fill="#f4d9a0">${safe}</text>`
    + `</svg>`);
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
      window.__SF.autoStow(false);
      window.__SF.setTime("golden");
      window.__SF.clearEnemies();
      window.__SF.releaseCamera();
      window.__SF.teleport(-520, -562, 0);
      window.__SF.weapons.setMode("ranged");
      window.__SF.setGaitInput(0, 0);
    });
    await mkdir(out, { recursive: true });

    const tiles = [];
    const metrics = [];
    for (const yawDeg of BEARINGS) {
      const shot = await page.evaluate(([y, p, boom]) => {
        const T = window.__SF;
        const THREE = T.THREE;
        T.setFiring(false);
        T.setCam(y * Math.PI / 180, p, boom);
        // Long enough for the aim commitment to decay to zero, so the
        // body is genuinely at rest and not still unwinding.
        for (let i = 0; i < 240; i += 1) T.renderOnce(1 / 60);
        T.renderStill();

        // Which side of the arm each elbow sits on, in the trooper's
        // own frame - the number the picture is being checked against.
        const fig = T.figureNodes();
        const s = T.gaitState();
        const sh = new THREE.Vector3();
        const el = new THREE.Vector3();
        const wr = new THREE.Vector3();
        const arm = new THREE.Vector3();
        const off = new THREE.Vector3();
        const arms = [];
        for (let a = 0; a < 2; a += 1) {
          fig.armPivots[a].getWorldPosition(sh);
          fig.elbowPivots[a].getWorldPosition(el);
          fig.handPivots[a].getWorldPosition(wr);
          arm.copy(wr).sub(sh).normalize();
          off.copy(el).sub(sh);
          off.addScaledVector(arm, -off.dot(arm));
          const sin = Math.sin(s.yaw);
          const cos = Math.cos(s.yaw);
          arms.push({
            lat: +(off.x * cos - off.z * sin).toFixed(3),
            fore: +(off.x * sin + off.z * cos).toFixed(3),
            up: +off.y.toFixed(3),
          });
        }
        /* WHERE THE ARM LANDS ON SCREEN, projected through the same
           camera that took the frame. Two close passes were cropped to
           a hand-guessed box and both photographed the pauldron while
           the elbow sat outside the crop - which is how a pose change
           that moved the elbow 15cm produced two identical-looking
           sheets. Frame on the joints, not on a guess. */
        const cam = T.camera ? T.camera() : null;
        let box = null;
        if (cam) {
          const w = T.canvasSize().width;
          const h = T.canvasSize().height;
          const proj = new THREE.Vector3();
          let x0 = 1e9; let y0 = 1e9; let x1 = -1e9; let y1 = -1e9;
          for (const node of [fig.armPivots[0], fig.elbowPivots[0], fig.handPivots[0],
            fig.armPivots[1], fig.elbowPivots[1], fig.handPivots[1]]) {
            node.getWorldPosition(proj);
            proj.project(cam);
            const px = (proj.x * 0.5 + 0.5) * w;
            const py = (-proj.y * 0.5 + 0.5) * h;
            x0 = Math.min(x0, px); x1 = Math.max(x1, px);
            y0 = Math.min(y0, py); y1 = Math.max(y1, py);
          }
          box = { x0, y0, x1, y1, w, h };
        }
        return {
          url: T.captureDataURL(),
          bodyYawDeg: T.aimCommitState().bodyYawDeg,
          commit: T.aimCommitState().commit,
          arms, box,
        };
      }, [yawDeg, CAM_PITCH, BOOM]);
      let buffer = Buffer.from(shot.url.slice(shot.url.indexOf(",") + 1), "base64");
      metrics.push({ yawDeg, ...shot, url: undefined });
      if (CLOSE && shot.box) {
        /* Cropped around the PROJECTED joints. The chase boom always
           looks at the head, so the arms can only be filled into a
           tile by cutting them out of a wider capture - and the cut
           has to follow the arms rather than a fixed rectangle. */
        const b = shot.box;
        const pad = 70;
        const left = Math.max(0, Math.round(b.x0 - pad));
        const top = Math.max(0, Math.round(b.y0 - pad));
        const width = Math.min(b.w - left, Math.round(b.x1 - b.x0 + pad * 2));
        const height = Math.min(b.h - top, Math.round(b.y1 - b.y0 + pad * 2));
        buffer = await sharp(buffer).extract({ left, top, width, height }).toBuffer();
      }
      tiles.push(await sharp(buffer).resize(TILE_W, TILE_H, { fit: "cover" })
        .composite([{ input: tag(TILE_W, `cam ${yawDeg}deg  body ${shot.bodyYawDeg}deg`), left: 0, top: 0 }])
        .png().toBuffer());
    }

    const cols = CLOSE ? 2 : 4;
    const rows = Math.ceil(tiles.length / cols);
    const sheetBuf = await sharp({
      create: {
        width: cols * TILE_W, height: rows * TILE_H,
        channels: 3, background: { r: 18, g: 16, b: 12 },
      },
    }).composite(tiles.map((input, i) => ({
      input, left: (i % cols) * TILE_W, top: Math.floor(i / cols) * TILE_H,
    }))).png().toBuffer();
    const file = path.join(out, `${label}.png`);
    await writeFile(file, sheetBuf);

    console.log("\nSAINTFALL low-ready arms\n" + "=".repeat(64));
    console.log("cam   body  commit   trigger elbow lat/fore/up    support lat/fore/up");
    for (const m of metrics) {
      const t = m.arms[1];
      const s = m.arms[0];
      console.log(`${String(m.yawDeg).padStart(4)}  ${String(m.bodyYawDeg).padStart(5)}  `
        + `${String(m.commit).padStart(5)}   `
        + `${[t.lat, t.fore, t.up].map((v) => v.toFixed(3).padStart(7)).join("")}      `
        + `${[s.lat, s.fore, s.up].map((v) => v.toFixed(3).padStart(7)).join("")}`);
    }
    console.log("=".repeat(64));
    console.log(`page/console errors: ${errors.length}`);
    console.log(path.relative(root, file));
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
