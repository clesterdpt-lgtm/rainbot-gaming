#!/usr/bin/env node
/* ============================================================
   SAINTFALL - reliquary barge contact sheet

   The carrier in the drop cinematic is only ever seen for a few
   seconds and only ever from below, which makes it very easy to
   "improve" into something that looks better in a turntable and
   worse in the one shot that ships. So this frames it the way the
   cinematic does - under the keel, looking up, against the planet -
   and also gives a broadside and a three-quarter so the silhouette
   can be judged as a whole.

   Uses the intro's own orbit scene and camera rather than a rebuilt
   one, so what is photographed is what plays.

   Usage:
     node scripts/saintfall-barge-shots.mjs --tag before
     node scripts/saintfall-barge-shots.mjs --tag after
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(root, "output/saintfall/barge");
const argv = process.argv.slice(2);
const TAG = argv.includes("--tag") ? argv[argv.indexOf("--tag") + 1] : "shot";
const PORT = 51200 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; }
    catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* Camera set-ups, in the barge's own space. The cinematic camera sits
   under the keel near the cradle, so `hero` is the shot that actually
   ships and the others exist to stop a fix that only works there. */
const SHOTS = [
  { id: "hero", pos: [10, -46, 40], look: [0, 6, -10], fov: 52 },
  { id: "broadside", pos: [300, -30, 30], look: [0, 8, 0], fov: 34 },
  { id: "three-quarter", pos: [190, -95, 250], look: [0, 0, -10], fov: 40 },
  { id: "prow", pos: [70, -40, 360], look: [0, 4, 120], fov: 44 },
  { id: "stern", pos: [95, -55, -360], look: [0, 0, -140], fov: 44 },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1400, height: 788 }, deviceScaleFactor: 1,
    })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`${BASE}/games/saintfall.html?qa=1&intro=force&introClock=manual&time=goldenhour`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });

    const info = await page.evaluate(async () => {
      const T = window.__SF;
      T.maximize();
      const boot = document.getElementById("sf-boot");
      if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
      await T.startIntroForQA();
      // Sit in the orbital act, where the barge is on screen.
      T.seekIntroForQA("orbit");
      T.renderIntroStill();
      return T.introState();
    });
    void info;

    const shots = await page.evaluate(async (setups) => {
      const T = window.__SF;
      const intro = T.intro;
      const scene = intro?.orbitScene || intro?.scene || null;
      const cam = intro?.orbitCamera || intro?.camera || null;
      if (!scene || !cam) {
        return { error: "orbit scene/camera not exposed on the intro handle" };
      }
      const barge = scene.getObjectByName("drop-carrier");
      if (!barge) return { error: "drop-carrier not found in the orbit scene" };

      // Hide the HUD/overlay so the sheet is only the ship.
      const host = document.getElementById("sf-intro");
      if (host) host.style.visibility = "hidden";

      const out = [];
      const THREE = T.THREE;
      const wp = new THREE.Vector3();
      barge.getWorldPosition(wp);
      for (const s of setups) {
        cam.fov = s.fov;
        cam.position.set(wp.x + s.pos[0], wp.y + s.pos[1], wp.z + s.pos[2]);
        cam.lookAt(wp.x + s.look[0], wp.y + s.look[1], wp.z + s.look[2]);
        cam.updateProjectionMatrix();
        T.render.renderer.setRenderTarget(null);
        intro.render?.();
        out.push({ id: s.id, data: T.render.captureDataURL() });
      }
      if (host) host.style.visibility = "";
      return { out };
    }, SHOTS);

    if (shots.error) {
      console.log(`could not frame the barge directly: ${shots.error}`);
      console.log("falling back to the cinematic's own framing");
      const seq = ["release", "orbit"];
      for (const marker of seq) {
        await page.evaluate((m) => {
          const T = window.__SF;
          T.seekIntroForQA(m);
          T.renderIntroStill();
        }, marker);
        const buf = await page.screenshot({ type: "png" });
        await writeFile(path.join(OUT, `${TAG}-${marker}.png`), buf);
        console.log(`   wrote ${TAG}-${marker}.png`);
      }
    } else {
      for (const s of shots.out) {
        await writeFile(path.join(OUT, `${TAG}-${s.id}.png`),
          Buffer.from(s.data.split(",")[1], "base64"));
        console.log(`   wrote ${TAG}-${s.id}.png`);
      }
    }

    const stats = await page.evaluate(() => {
      const T = window.__SF;
      const r = T.report();
      return { calls: r.render.calls, tris: r.render.triangles };
    });
    console.log(`\norbital act: ${stats.calls} draw calls, ${stats.tris.toLocaleString()} triangles`);
    if (errors.length) {
      console.log(`console/page errors: ${errors.length}`);
      for (const e of [...new Set(errors)].slice(0, 4)) console.log(`   ${e.slice(0, 160)}`);
    }
    await page.close();
    console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
