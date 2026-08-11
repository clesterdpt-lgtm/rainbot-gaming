#!/usr/bin/env node
/* Fast iteration probe for the Saintfall drop cinematic.
   Boots once, seeks every marker, dumps a PNG + status per marker. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = "/Volumes/External SSD/Projects/RainbotGaming";
const outDir = process.argv.includes("--out")
  ? path.resolve(process.argv[process.argv.indexOf("--out") + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "shots");
const port = 46700 + (process.pid % 900);
const base = `http://127.0.0.1:${port}`;

const MARKERS = [
  ["standby", 0.4], ["release", 2.1], ["orbit", 3.9], ["entry", 5.6],
  ["turbulence", 9.4], ["cloudBreak", 12.3], ["terminal", 15.6], ["plunge", 17.4],
  ["impact", 18.05], ["settle", 18.7], ["hatch", 20.4], ["open", 21.05], ["egress", 21.5], ["walk", 22.6],
  ["blend", 23.2],
];

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

async function waitServer() {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server did not start");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  const errors = [];
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`page: ${e.message}\n${e.stack || ""}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

    await page.goto(`${base}/games/saintfall.html?qa=1&intro=force&introClock=manual`,
      { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });
    if (errors.length) {
      console.log("ERRORS DURING BOOT:\n" + errors.join("\n"));
      return;
    }
    await page.evaluate(() => window.__SF.maximize?.());
    await page.waitForTimeout(120);

    const rows = [];
    for (const [id, at] of MARKERS) {
      const shot = await page.evaluate((seconds) => {
        const T = window.__SF;
        T.seekIntroForQA(seconds);
        T.renderIntroStill();
        const gl = T.render.renderer.getContext();
        gl.finish?.();
        T.renderIntroStill();
        gl.finish?.();
        return {
          status: T.introState(),
          info: T.render.info(),
          image: T.captureDataURL(),
        };
      }, at);
      await writeFile(path.join(outDir, `${id}.png`),
        Buffer.from(shot.image.slice(shot.image.indexOf(",") + 1), "base64"));
      rows.push({ id, at, s: shot.status, info: shot.info });
    }

    for (const r of rows) {
      const s = r.s;
      console.log(
        `${r.id.padEnd(11)} t=${String(r.at).padStart(5)} `
        + `shot=${String(s.shot).padEnd(8)} phase=${String(s.phase).padEnd(12)} `
        + `alt=${String(s.pod.altitude).padStart(6)} pod=[${s.pod.position.join(", ")}] `
        + `err=${s.pod.siteError} petals=${s.pod.petals} `
        + `calls=${r.info.calls} tris=${r.info.triangles} `
        + `troop=${s.trooper ? `${s.trooper.visible ? "vis" : "hid"}@${s.trooper.toSpawn}m` : "-"}`
      );
    }

    // Real-time run through the egress so the walk actually happens.
    const walk = await page.evaluate(() => {
      const T = window.__SF;
      T.seekIntroForQA(20.6);
      const frames = [];
      for (let i = 0; i < 170; i += 1) {
        T.advanceIntroForQA(1 / 60, 1 / 60);
        const s = T.introState();
        if (i % 24 === 0) {
          frames.push({
            t: s.elapsed, shot: s.shot, blend: s.cameraBlend,
            trooper: s.trooper, done: s.completed,
          });
        }
      }
      T.renderIntroStill();
      return { frames, final: T.introState(), image: T.captureDataURL() };
    });
    await writeFile(path.join(outDir, "zz-final.png"),
      Buffer.from(walk.image.slice(walk.image.indexOf(",") + 1), "base64"));
    console.log("\nEGRESS RUN:");
    for (const f of walk.frames) {
      console.log(`  t=${String(f.t).padStart(6)} shot=${String(f.shot).padEnd(8)} `
        + `blend=${f.blend} trooper=${f.trooper ? `${f.trooper.visible ? "vis" : "hid"} `
          + `walk=${f.trooper.walking} toSpawn=${f.trooper.toSpawn}` : "-"} done=${f.done}`);
    }
    console.log("final:", JSON.stringify({
      completed: walk.final.completed, skipped: walk.final.skipped,
      handoffCount: walk.final.handoffCount, shot: walk.final.shot,
    }));

    if (errors.length) console.log("\nERRORS:\n" + errors.join("\n"));
    else console.log("\nno console/page errors");
    console.log(`\nshots -> ${outDir}`);
  } finally {
    await browser?.close();
    child.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
