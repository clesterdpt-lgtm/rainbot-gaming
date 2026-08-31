#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Saint Aurel procedural Censer-Lance proof

   Verifies the restored weapon contract:
     - the original procedural body and swinging censer are active;
     - no authored Meshy visual is mounted or fetched;
     - ranged and melee still share one physical weapon root;
     - both held palms use the approved upward roll toward the haft.
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 46900 + (process.pid % 500);
const base = `http://127.0.0.1:${port}`;
const output = path.resolve(root, process.argv[2]
  || "output/saintfall/aurel-procedural-lance-probe");

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never became ready");
}

const server = startServer();
let browser;
try {
  await waitForServer();
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--hide-scrollbars", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const modelRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("request", (request) => {
    if (request.url().includes("saint-aurel-censer-lance.glb")) {
      modelRequests.push(request.url());
    }
  });

  await page.goto(
    `${base}/games/saintfall.html?qa=1&intro=0&quality=low&character=vesper-reliquary&proof=aurel-procedural-lance`,
    { waitUntil: "domcontentloaded", timeout: 60000 },
  );
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 180000 });

  const contract = await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    T.hideHud(true);
    T.autoStow(false);
    T.equipWeapon("autogun");
    const weapon = T.weapons.current;
    let meshes = 0;
    let authoredMeshes = 0;
    weapon.root.traverse((node) => {
      if (!node.isMesh) return;
      meshes += 1;
      if (node.userData.authoredPlayerWeapon) authoredMeshes += 1;
    });
    T.weapons.setMode("ranged");
    const rangedRoot = T.weapons.current.root.uuid;
    T.weapons.setMode("melee");
    const meleeRoot = T.weapons.current.root.uuid;
    T.weapons.setMode("ranged");

    const site = T.findFlatSite(9);
    T.poseFigure(Math.PI / 4, {
      x: site[0], z: site[1], yaw: 0, radius: 4.4, fov: 31, aim: 0.60, eye: 0.62,
    });
    T.player.state.figureOverride = true;
    for (let i = 0; i < 8; i += 1) T.renderStill();

    return {
      stats: T.weapons.stats(),
      meshes,
      authoredMeshes,
      authoredVisual: !!weapon.authoredVisual,
      proceduralCenser: !!weapon.censer,
      rangedRoot,
      meleeRoot,
      palmRoll: [T.player.palmRoll(0), T.player.palmRoll(1)],
    };
  });

  const screenshot = path.join(output, "aurel-procedural-lance.png");
  await page.screenshot({ path: screenshot });

  const failures = [];
  if (errors.length) failures.push(`console/page errors: ${errors.join(" | ")}`);
  if (modelRequests.length) failures.push("authored Meshy GLB was requested");
  if (contract.authoredVisual || contract.authoredMeshes) failures.push("authored visual remains mounted");
  if (!contract.proceduralCenser) failures.push("procedural censer is missing");
  if (contract.meshes !== 13) failures.push(`procedural mesh count is ${contract.meshes}`);
  if (contract.stats.triangles !== 850) failures.push(`procedural triangle count is ${contract.stats.triangles}`);
  if (contract.rangedRoot !== contract.meleeRoot) failures.push("ranged/melee changed physical roots");
  if (contract.palmRoll.some((value) => Math.abs(value - 0.30) > 1e-6)) {
    failures.push(`palm roll is ${JSON.stringify(contract.palmRoll)}`);
  }

  console.log(JSON.stringify({
    passed: failures.length === 0,
    contract,
    modelRequests,
    screenshot: path.relative(root, screenshot),
    errors,
    failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
