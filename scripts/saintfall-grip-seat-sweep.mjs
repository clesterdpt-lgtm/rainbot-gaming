#!/usr/bin/env node
/* ============================================================
   SAINTFALL - grip-seat sweep along the wrapped bar

   The fist was seated against the FRAME's edge, palming the receiver
   with the whole D-guard hanging empty - reported from play as "the
   hand is not at the pistol grip". The anatomical grip is the
   leather-wrapped bar inside the guard, centreline measured at
   (0.220,-0.102) -> (0.344, 0.219) model units.

   One boot, several seats along that bar via the loadout's live
   setHold, each photographed CLOSE on both fists plus a full-figure
   side view - the seat is chosen from the plates, not the numbers.

   Usage: node scripts/saintfall-grip-seat-sweep.mjs --tag s1
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const tag = arg("--tag", "seat");
const outDir = path.resolve(root, arg("--out", "output/saintfall/grip-seat"));
const PORT = 42800 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

const CANDIDATES = [
  { id: "M-frame", grip: [0.105, 0.150, 0] },
  { id: "J-bar-mid", grip: [0.280, 0.060, 0] },
  { id: "K-bar-high", grip: [0.340, 0.190, 0] },
  { id: "L-bar-low", grip: [0.240, -0.050, 0] },
];

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${BASE}/games/saintfall-white-vigil.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never became ready");
}

function runCandidate(candidate) {
  const T = window.__SF;
  const THREE = T.THREE;
  const player = T.player;
  const figure = player.figure;
  const loadout = T.ctx.playerLoadout;

  loadout.setHold("left-hybrid", { grip: candidate.grip.slice() });
  loadout.setHold("right-hybrid", { grip: candidate.grip.slice() });
  T.setFiring(false);
  T.advanceTime(0.8, 1 / 60);
  figure.root.updateMatrixWorld(true);

  const inverseRoot = figure.root.matrixWorld.clone().invert();
  const arms = [0, 1].map((hand) => {
    const part = loadout.parts.find((c) => c.spec.hand === hand);
    part.asset.updateWorldMatrix(true, true);
    const bow = new THREE.Vector3(1, 0, 0)
      .transformDirection(part.asset.matrixWorld)
      .transformDirection(inverseRoot);
    const wrist = figure.handPivots[hand].getWorldPosition(new THREE.Vector3())
      .applyMatrix4(inverseRoot);
    const point = (p) => new THREE.Vector3().fromArray(p)
      .applyMatrix4(part.asset.matrixWorld).applyMatrix4(inverseRoot);
    return {
      hand: hand === 0 ? "left" : "right",
      bow: bow.toArray().map((v) => +v.toFixed(3)),
      stockTopY: +point([0.0, 0.93, 0]).y.toFixed(3),
      bladeTipY: +point([0.045, -0.96, 0]).y.toFixed(3),
      wristY: +wrist.y.toFixed(3),
    };
  });

  const plates = [];
  const scratch = new THREE.Vector3();
  const st = player.state;
  const CLOSE = [
    { id: "outboard", yaw: 90, pitch: 0.05, dist: 0.95 },
    { id: "front34", yaw: 142, pitch: 0.08, dist: 0.95 },
  ];
  for (const hand of [0, 1]) {
    const palm = figure.palmLocators?.[hand] || figure.handPivots[hand];
    palm.updateWorldMatrix(true, false);
    palm.getWorldPosition(scratch);
    const sideSign = hand === 0 ? 1 : -1;
    for (const b of CLOSE) {
      const yaw = st.yaw + sideSign * (b.yaw * Math.PI / 180);
      const eye = [
        scratch.x + Math.sin(yaw) * b.dist * Math.cos(b.pitch),
        scratch.y + Math.sin(b.pitch) * b.dist,
        scratch.z + Math.cos(yaw) * b.dist * Math.cos(b.pitch),
      ];
      T.hidePlayer(false);
      player.setFree(true, eye, [scratch.x, scratch.y, scratch.z], 30);
      T.renderStill();
      T.renderStill();
      plates.push({ label: `h${hand}-${b.id}`, url: T.captureDataURL() });
      player.setFree(false);
    }
  }
  /* Full figure, left profile - the concept's own view. */
  T.hidePlayer(false);
  const yaw = st.yaw + Math.PI / 2;
  figure.root.getWorldPosition(scratch);
  const eye = [scratch.x + Math.sin(yaw) * 3.0, scratch.y + 1.15, scratch.z + Math.cos(yaw) * 3.0];
  player.setFree(true, eye, [scratch.x, scratch.y + 1.02, scratch.z], 32);
  T.renderStill();
  T.renderStill();
  plates.push({ label: "figure-side", url: T.captureDataURL() });
  player.setFree(false);
  T.autoPlayer();
  return { id: candidate.id, arms, plates };
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
    const context = await browser.newContext({ viewport: { width: 820, height: 820 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/games/saintfall-white-vigil.html?qa=1&quality=high&character=white-vigil&time=goldenhour&cycle=0`, {
      waitUntil: "domcontentloaded", timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
    await page.evaluate(() => {
      const T = window.__SF;
      T.maximize();
      T.hideHud(true);
      const site = T.findFlatSite(6);
      T.player.spawn(site[0], site[1], Math.PI);
      T.advanceTime(1.0, 1 / 60);
    });

    await mkdir(outDir, { recursive: true });
    const reports = [];
    const files = new Map();
    for (const candidate of CANDIDATES) {
      const res = await page.evaluate(runCandidate, candidate);
      reports.push(res);
      for (const plate of res.plates) {
        const file = path.join(outDir, `${tag}-${candidate.id}-${plate.label}.png`);
        await writeFile(file, Buffer.from(plate.url.slice(plate.url.indexOf(",") + 1), "base64"));
        files.set(`${candidate.id}/${plate.label}`, file);
      }
    }

    /* Sheet: rows = candidates, columns = left close, right close,
       right front34, figure side. */
    const TILE = 330; const LABEL_H = 24;
    const COLS = ["h0-outboard", "h1-outboard", "h1-front34", "figure-side"];
    const composites = [];
    for (let r = 0; r < CANDIDATES.length; r += 1) {
      const candidate = CANDIDATES[r];
      const cap = Buffer.from(`<svg width="${TILE * COLS.length}" height="${LABEL_H}"><rect width="${TILE * COLS.length}" height="${LABEL_H}" fill="#12100c"/><text x="6" y="17" font-family="monospace" font-size="14" fill="#f4d9a0">${candidate.id}  grip=[${candidate.grip.join(", ")}]   cols: left-close | right-close | right-front34 | side</text></svg>`);
      composites.push({ input: await sharp(cap).png().toBuffer(), left: 0, top: r * (TILE + LABEL_H) });
      for (let c = 0; c < COLS.length; c += 1) {
        const file = files.get(`${candidate.id}/${COLS[c]}`);
        const crop = COLS[c] === "figure-side"
          ? { left: 210, top: 60, width: 460, height: 700 }
          : { left: 150, top: 150, width: 520, height: 520 };
        const img = await sharp(file).extract(crop).resize(TILE, TILE, { fit: "cover" }).png().toBuffer();
        composites.push({ input: img, left: c * TILE, top: r * (TILE + LABEL_H) + LABEL_H });
      }
    }
    const sheet = path.join(outDir, `${tag}-sheet.png`);
    await sharp({ create: { width: TILE * COLS.length, height: (TILE + LABEL_H) * CANDIDATES.length, channels: 3, background: "#000" } })
      .composite(composites).png().toFile(sheet);

    for (const report of reports) {
      const [l, r] = report.arms;
      const bowMirrored = Math.abs(l.bow[0] + r.bow[0]) <= 0.08
        && Math.abs(l.bow[1] - r.bow[1]) <= 0.08 && Math.abs(l.bow[2] - r.bow[2]) <= 0.08;
      console.log(`${report.id.padEnd(11)} bow L ${JSON.stringify(l.bow)} R ${JSON.stringify(r.bow)} ${bowMirrored ? "MIRRORED" : "NOT MIRRORED"}`);
      console.log(`            stockTop L ${l.stockTopY} R ${r.stockTopY}  bladeTip L ${l.bladeTipY} R ${r.bladeTipY}  wrist ${l.wristY}`);
    }
    console.log(`sheet -> ${path.relative(root, sheet)}`);
    if (errors.length) console.log(`errors: ${errors.join(" | ")}`);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
