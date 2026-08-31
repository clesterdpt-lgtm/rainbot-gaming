#!/usr/bin/env node
/* ============================================================
   SAINTFALL - jetpack back-centering probe

   Verifies the pack's authored centre against the player's root
   centreline in the poses where a drift is easiest to see. Aurel is
   checked both with the lance in hand and fully sheathed; the two
   Kenosis operatives are checked with their normal loadouts.

   Usage:
     node scripts/saintfall-jetpack-centering-probe.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "output/saintfall/jetpack-centering");
const PORT = 45800 + (process.pid % 700);
const BASE = `http://127.0.0.1:${PORT}`;

const CASES = [
  {
    id: "saint-aurel-wielded",
    page: "games/saintfall.html",
    character: null,
    pinStow: 0,
  },
  {
    id: "saint-aurel-sheathed",
    page: "games/saintfall.html",
    character: null,
    pinStow: 1,
  },
  {
    id: "saint-veyra",
    page: "games/saintfall.html",
    character: "white-vigil",
    pinStow: null,
  },
  {
    id: "saint-torren",
    page: "games/saintfall.html",
    character: "bastion-penitent",
    pinStow: null,
  },
];

function startServer() {
  const child = spawn(
    "/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] }
  );
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer(page) {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${BASE}/${page}`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

function measureAndFrame({ pinStow }) {
  const T = window.__SF;
  const THREE = T.THREE;
  const player = T.player;
  const figure = player.figure;
  const pack = T.jetpack.visual;

  T.maximize();
  T.setJetInput(false);
  T.advanceTime(0.5, 1 / 60);
  /* The campaign exposes its compatibility weapon through qa.js;
     Kenosis has character-owned loadouts instead. Only Aurel needs
     the shared stow control for this comparison. */
  if (T.weapons && Number.isFinite(pinStow)) {
    T.forceStow(pinStow);
    /* forceStow's zero-delta step updates the weapon first; a second
       zero-delta step lets the torso read the new hand-release state
       without advancing or unpinning the pose. */
    T.renderOnce(0);
  }
  figure.root.updateMatrixWorld(true);

  const packWorld = pack.root.getWorldPosition(new THREE.Vector3());
  const packLocal = figure.root.worldToLocal(packWorld.clone());
  const packBoundsWorld = new THREE.Box3().setFromObject(pack.root);
  const packBoundsCenterLocal = figure.root.worldToLocal(
    packBoundsWorld.getCenter(new THREE.Vector3())
  );
  const shoulderWorld = figure.armPivots
    .map((joint) => joint.getWorldPosition(new THREE.Vector3()));
  const shoulderMidWorld = shoulderWorld[0].clone().add(shoulderWorld[1]).multiplyScalar(0.5);
  const shoulderMidLocal = figure.root.worldToLocal(shoulderMidWorld.clone());

  const base = figure.root.position;
  const aimY = base.y + 1.38;
  const yaw = player.state.yaw + Math.PI;
  const eye = [
    base.x + Math.sin(yaw) * 2.55,
    aimY + 0.08,
    base.z + Math.cos(yaw) * 2.55,
  ];
  player.setFree(true, eye, [base.x, aimY, base.z], 38);
  T.hidePlayer(false);
  T.renderStill();
  T.renderStill();

  return {
    image: T.captureDataURL(),
    packId: pack.id,
    assetSource: figure.assetSource,
    carryChestYawDeg: +(player.state.carryChestYaw * 180 / Math.PI).toFixed(2),
    handRelease: +(T.weapons?.carry?.handRelease || 0).toFixed(3),
    packLocal: {
      x: +packLocal.x.toFixed(4),
      y: +packLocal.y.toFixed(4),
      z: +packLocal.z.toFixed(4),
    },
    packBoundsCenterLocal: {
      x: +packBoundsCenterLocal.x.toFixed(4),
      y: +packBoundsCenterLocal.y.toFixed(4),
      z: +packBoundsCenterLocal.z.toFixed(4),
    },
    shoulderMidLocal: {
      x: +shoulderMidLocal.x.toFixed(4),
      y: +shoulderMidLocal.y.toFixed(4),
      z: +shoulderMidLocal.z.toFixed(4),
    },
  };
}

async function main() {
  const server = startServer();
  let browser;
  const report = {};
  const errors = [];
  try {
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    await mkdir(outDir, { recursive: true });

    for (const test of CASES) {
      await waitForServer(test.page);
      const context = await browser.newContext({ viewport: { width: 760, height: 940 } });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(`${test.id}: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`${test.id}: ${message.text()}`);
      });
      const url = new URL(`${BASE}/${test.page}`);
      url.searchParams.set("qa", "1");
      url.searchParams.set("quality", "high");
      if (test.character) url.searchParams.set("character", test.character);
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
      await page.evaluate(() => window.__SF.setTime("goldenhour"));
      const result = await page.evaluate(measureAndFrame, { pinStow: test.pinStow });
      await writeFile(
        path.join(outDir, `${test.id}.png`),
        Buffer.from(result.image.slice(result.image.indexOf(",") + 1), "base64")
      );
      delete result.image;
      report[test.id] = result;
      await context.close();
    }

    const checks = [];
    const check = (label, ok, detail) => checks.push({ label, ok: !!ok, detail });
    for (const [id, row] of Object.entries(report)) {
      const alignmentErrorM = Math.abs(
        row.packBoundsCenterLocal.x - row.shoulderMidLocal.x
      );
      check(
        `${id} pack visual is within 2cm of the shoulder centreline`,
        alignmentErrorM <= 0.0201,
        { alignmentErrorM: +alignmentErrorM.toFixed(4) }
      );
    }
    check(
      "Aurel keeps the authored low-ready torso turn",
      Math.abs(report["saint-aurel-wielded"].carryChestYawDeg) >= 10,
      { carryChestYawDeg: report["saint-aurel-wielded"].carryChestYawDeg }
    );
    for (const id of ["saint-veyra", "saint-torren"]) {
      check(
        `${id} ignores the hidden compatibility lance pose`,
        Math.abs(report[id].carryChestYawDeg) <= 0.1,
        { carryChestYawDeg: report[id].carryChestYawDeg }
      );
    }
    check("no page or console errors", errors.length === 0, { errors });

    const passed = checks.filter((entry) => entry.ok).length;
    const result = { passed, total: checks.length, checks, report, errors };
    await writeFile(path.join(outDir, "report.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (passed !== checks.length) process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
