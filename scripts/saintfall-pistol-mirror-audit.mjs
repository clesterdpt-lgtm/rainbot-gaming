#!/usr/bin/env node
/* ============================================================
   SAINTFALL - left/right pistol mirror audit

   The first mirror check compared muzzle and plate normal, both of
   which CAN mirror - and declared the pair symmetric while the right
   pistol hung upside down. The prop is CHIRAL: once the muzzle and
   the shown face both mirror, the third axis - the D-guard bow, the
   part a player reads as "the handle" - is forced ANTI-mirrored.

   So this audits all three model axes per hand, in figure space,
   with the explicit mirror test each one must pass:
     muzzle  (-Y)  x anti-symmetric, y/z equal
     face    (+Z)  reported both ways - a chiral prop must give up
                   either the face or the bow; the bow is the visible
                   one, so the FACE is allowed to anti-mirror
     bow     (+X)  x anti-symmetric, y/z equal  <- the upside-down axis

   And photographs both fists from the SAME body-relative bearing,
   side by side, which is the comparison a player actually makes.

   Usage: node scripts/saintfall-pistol-mirror-audit.mjs --tag now
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
const tag = arg("--tag", "mirror");
const outDir = path.resolve(root, arg("--out", "output/saintfall/pistol-mirror"));
const PORT = 43900 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

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

function measure() {
  const T = window.__SF;
  const THREE = T.THREE;
  const player = T.player;
  const figure = player.figure;
  const loadout = T.ctx.playerLoadout;
  T.maximize();
  T.hideHud(true);
  const site = T.findFlatSite(6);
  player.spawn(site[0], site[1], Math.PI);
  T.setFiring(false);
  T.advanceTime(1.2, 1 / 60);
  figure.root.updateMatrixWorld(true);
  const inverseRoot = figure.root.matrixWorld.clone().invert();

  const axes = { muzzle: [0, -1, 0], face: [0, 0, 1], bow: [1, 0, 0], pommel: [0, 1, 0] };
  const arms = [0, 1].map((hand) => {
    const part = loadout.parts.find((candidate) => candidate.spec.hand === hand);
    part.asset.updateWorldMatrix(true, true);
    const out = { hand: hand === 0 ? "left" : "right" };
    for (const [name, axis] of Object.entries(axes)) {
      out[name] = new THREE.Vector3().fromArray(axis)
        .transformDirection(part.asset.matrixWorld)
        .transformDirection(inverseRoot)
        .toArray().map((v) => +v.toFixed(3));
    }
    /* Palm-to-nearest-bar distance: where the fist actually is on
       the model. The palm sits at the authored grip point by
       construction, so report that point and the world gap between
       the palm locator and the asset's grip contact. */
    out.grip = part.spec.grip.slice();
    out.gripErrorM = loadout.status().parts
      .find((p) => p.hand === out.hand).gripErrorM;
    return out;
  });

  /* Mirror verdicts. anti(x) + equal(y,z), tolerance 0.08. */
  const verdict = {};
  const [l, r] = arms;
  const check = (name) => {
    const a = l[name]; const b = r[name];
    const antiX = Math.abs(a[0] + b[0]) <= 0.08;
    const eqYZ = Math.abs(a[1] - b[1]) <= 0.08 && Math.abs(a[2] - b[2]) <= 0.08;
    return { mirrored: antiX && eqYZ, left: a, right: b };
  };
  verdict.muzzle = check("muzzle");
  verdict.bow = check("bow");
  verdict.pommel = check("pommel");
  verdict.face = check("face");

  /* ---- plates: both fists from the same body-relative bearings ---- */
  const plates = [];
  const scratch = new THREE.Vector3();
  const st = player.state;
  const BEARINGS = [
    { id: "outboard", yaw: 90, pitch: 0.05, dist: 1.0 },
    { id: "front34", yaw: 142, pitch: 0.08, dist: 1.0 },
    { id: "rear34", yaw: 40, pitch: 0.10, dist: 1.0 },
  ];
  for (const hand of [0, 1]) {
    const palm = figure.palmLocators?.[hand] || figure.handPivots[hand];
    palm.updateWorldMatrix(true, false);
    palm.getWorldPosition(scratch);
    const sideSign = hand === 0 ? 1 : -1;
    for (const b of BEARINGS) {
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
  return { arms, verdict, plates };
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
    const res = await page.evaluate(measure);

    await mkdir(outDir, { recursive: true });
    const byLabel = new Map();
    for (const plate of res.plates) {
      const file = path.join(outDir, `${tag}-${plate.label}.png`);
      await writeFile(file, Buffer.from(plate.url.slice(plate.url.indexOf(",") + 1), "base64"));
      byLabel.set(plate.label, file);
    }
    /* left|right pairs per bearing, one sheet */
    const TILE = 400; const LABEL_H = 22;
    const bearings = ["outboard", "front34", "rear34"];
    const composites = [];
    for (let r = 0; r < bearings.length; r += 1) {
      for (let c = 0; c < 2; c += 1) {
        const label = `h${c}-${bearings[r]}`;
        const img = await sharp(byLabel.get(label))
          .extract({ left: 110, top: 110, width: 600, height: 600 })
          .resize(TILE, TILE).png().toBuffer();
        const cap = Buffer.from(`<svg width="${TILE}" height="${LABEL_H}"><rect width="${TILE}" height="${LABEL_H}" fill="#12100c"/><text x="6" y="16" font-family="monospace" font-size="13" fill="#f4d9a0">${c === 0 ? "LEFT" : "RIGHT"} - ${bearings[r]}</text></svg>`);
        composites.push({ input: await sharp(cap).png().toBuffer(), left: c * TILE, top: r * (TILE + LABEL_H) });
        composites.push({ input: img, left: c * TILE, top: r * (TILE + LABEL_H) + LABEL_H });
      }
    }
    const sheet = path.join(outDir, `${tag}-pairs.png`);
    await sharp({ create: { width: TILE * 2, height: (TILE + LABEL_H) * bearings.length, channels: 3, background: "#000" } })
      .composite(composites).png().toFile(sheet);

    await writeFile(path.join(outDir, `${tag}-report.json`),
      JSON.stringify({ arms: res.arms, verdict: res.verdict, errors }, null, 2));
    for (const [name, v] of Object.entries(res.verdict)) {
      console.log(`${name.padEnd(7)} ${v.mirrored ? "MIRRORED" : "NOT MIRRORED"}  L ${JSON.stringify(v.left)}  R ${JSON.stringify(v.right)}`);
    }
    console.log(`pairs sheet -> ${path.relative(root, sheet)}`);
    if (errors.length) console.log(`errors: ${errors.join(" | ")}`);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
