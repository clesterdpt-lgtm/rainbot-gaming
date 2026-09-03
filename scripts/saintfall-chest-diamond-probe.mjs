#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "output/saintfall/chest-diamond");
const PORT = 46800 + (process.pid % 700);
const BASE = `http://127.0.0.1:${PORT}`;

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

function measureChest({ pinStow }) {
  const T = window.__SF;
  const THREE = T.THREE;
  const player = T.player;
  const figure = player.figure;

  T.maximize();
  T.setJetInput(false);
  T.advanceTime(0.5, 1 / 60);

  if (T.weapons && Number.isFinite(pinStow)) {
    T.forceStow(pinStow);
    T.renderOnce(0);
  }
  figure.root.updateMatrixWorld(true);

  let amberBone = null;
  figure.root.traverse((c) => {
    if (c.isSkinnedMesh && c.name.includes("VesperReliquaryMesh_2")) {
      const skinIndex = c.geometry.attributes.skinIndex;
      const bIdx = skinIndex.getX(0);
      amberBone = c.skeleton.bones[bIdx]?.name || "unknown";
    }
  });

  const spineBone = figure.root.getObjectByName("Spine");
  const spinePos = spineBone ? figure.root.worldToLocal(spineBone.getWorldPosition(new THREE.Vector3())) : null;
  const spineEuler = spineBone ? new THREE.Euler().setFromQuaternion(spineBone.quaternion, "YXZ") : null;
  const spineDeg = spineEuler ? {
    yaw: +(spineEuler.y * 180 / Math.PI).toFixed(2),
    pitch: +(spineEuler.x * 180 / Math.PI).toFixed(2),
    roll: +(spineEuler.z * 180 / Math.PI).toFixed(2),
  } : null;

  const spine01Bone = figure.root.getObjectByName("Spine01");
  const spine01Pos = spine01Bone ? figure.root.worldToLocal(spine01Bone.getWorldPosition(new THREE.Vector3())) : null;
  const spine01Euler = spine01Bone ? new THREE.Euler().setFromQuaternion(spine01Bone.quaternion, "YXZ") : null;
  const spine01Deg = spine01Euler ? {
    yaw: +(spine01Euler.y * 180 / Math.PI).toFixed(2),
    pitch: +(spine01Euler.x * 180 / Math.PI).toFixed(2),
    roll: +(spine01Euler.z * 180 / Math.PI).toFixed(2),
  } : null;

  // Position camera to look directly at the front chest
  const base = figure.root.position;
  const aimY = base.y + 1.34;
  const yaw = player.state.yaw; // front view
  const eye = [
    base.x + Math.sin(yaw) * 1.8,
    aimY + 0.02,
    base.z + Math.cos(yaw) * 1.8,
  ];
  player.setFree(true, eye, [base.x, aimY, base.z], 32);
  T.hidePlayer(false);
  T.renderStill();
  T.renderStill();

  return {
    image: T.captureDataURL(),
    carryChestYawDeg: +(player.state.carryChestYaw * 180 / Math.PI).toFixed(2),
    handRelease: +(T.weapons?.carry?.handRelease || 0).toFixed(3),
    amberBone,
    spineDeg,
    spine01Deg,
    spinePos,
    spine01Pos,
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = startServer();
  await waitForServer("games/saintfall.html");

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${BASE}/games/saintfall.html?qa=1&intro=0&quality=low&character=vesper-reliquary`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(() => !!window.__SF?.player?.figure?.root, null, { timeout: 30000 });

    // Measure Wielded
    const wielded = await page.evaluate(measureChest, { pinStow: 0 });
    const imgWielded = Buffer.from(wielded.image.replace(/^data:image\/png;base64,/, ""), "base64");
    await writeFile(path.join(outDir, "saint-aurel-front-wielded.png"), imgWielded);
    delete wielded.image;

    // Measure Sheathed
    const sheathed = await page.evaluate(measureChest, { pinStow: 1 });
    const imgSheathed = Buffer.from(sheathed.image.replace(/^data:image\/png;base64,/, ""), "base64");
    await writeFile(path.join(outDir, "saint-aurel-front-sheathed.png"), imgSheathed);
    delete sheathed.image;

    const checks = [
      {
        label: "Aurel wielded chest diamond is skinned to Spine01 (breastplate)",
        ok: wielded.amberBone === "Spine01",
        detail: { amberBone: wielded.amberBone },
      },
      {
        label: "Aurel sheathed chest diamond is skinned to Spine01 (breastplate)",
        ok: sheathed.amberBone === "Spine01",
        detail: { amberBone: sheathed.amberBone },
      },
      {
        label: "Aurel retains authored low-ready shoulder yaw when wielded",
        ok: Math.abs(wielded.carryChestYawDeg) >= 10,
        detail: { carryChestYawDeg: wielded.carryChestYawDeg },
      },
      {
        label: "Aurel returns to neutral torso yaw when sheathed",
        ok: Math.abs(sheathed.carryChestYawDeg) <= 0.1,
        detail: { carryChestYawDeg: sheathed.carryChestYawDeg },
      },
    ];

    const passed = checks.filter((c) => c.ok).length;
    const report = { passed, total: checks.length, checks, wielded, sheathed };
    await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (passed !== checks.length) process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
