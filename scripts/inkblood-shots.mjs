#!/usr/bin/env node
/* ============================================================
   INKBLOOD — screenshot harness

   Boots a page in headless Chromium, waits for the game (or the
   sprite-test page) to signal readiness, optionally drives it via
   the __INK debug hook, and writes PNGs I can actually look at.

   Newer chromium-headless-shell throttles rAF to roughly 1fps in
   headless mode, which produces black frames if you just sleep and
   shoot. So every capture polls a frame counter and only shoots
   once the page has genuinely advanced.

   Usage:
     node scripts/inkblood-shots.mjs --url /tmp/inkblood-sprite-test.html
     node scripts/inkblood-shots.mjs --game --script boot,play,levelup
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n && !n.startsWith("--")) { a[k] = n; i++; } else { a[k] = true; }
    } else a._.push(t);
  }
  return a;
}

const args = parseArgs(process.argv);
const PORT = Number(args.port || 8899);
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 1000);
const OUT = path.resolve(root, args.out || "output/inkblood-shots/latest");

async function startServer() {
  // Reuse an already-running server if one answers.
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: "HEAD" });
    if (r.ok || r.status === 404) return { proc: null, port: PORT };
  } catch { /* not running; start our own */ }

  const proc = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: root, stdio: "ignore", detached: false,
  });
  for (let i = 0; i < 60; i++) {
    await delay(120);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: "HEAD" });
      if (r.ok || r.status === 404) return { proc, port: PORT };
    } catch { /* keep waiting */ }
  }
  throw new Error("static server never came up");
}

/** Wait until the page has actually rendered N new animation frames. */
async function waitFrames(page, n = 3, timeoutMs = 20000) {
  await page.evaluate(() => {
    if (window.__frameProbe) return;
    window.__frameProbe = 0;
    const tick = () => { window.__frameProbe++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const start = await page.evaluate(() => window.__frameProbe);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = await page.evaluate(() => window.__frameProbe);
    if (now - start >= n) return true;
    await delay(90);
  }
  return false;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    headless: !args.headed,
    args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"],
  });
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: Number(args.dpr || 2),
  });

  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ""}`));

  const url = args.url
    ? `http://127.0.0.1:${server.port}${args.url}`
    : `http://127.0.0.1:${server.port}/games/inkblood.html`;

  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Sprite-test pages expose __BAKED; the game exposes __INK.
  await page.waitForFunction(
    () => window.__BAKED || (window.__INK && window.__INK.ready),
    null,
    { timeout: 45000 },
  ).catch(() => logs.push("[warn] readiness flag never appeared"));

  const shots = [];

  if (args.url) {
    await waitFrames(page, 2);
    const file = path.join(OUT, "page.png");
    await page.screenshot({ path: file, fullPage: true });
    shots.push(file);
  } else {
    const plan = String(args.script || "title").split(",").map((s) => s.trim()).filter(Boolean);
    for (const stepName of plan) {
      const [name, ...rest] = stepName.split(":");
      const arg = rest.join(":");
      await page.evaluate(async ([n, a]) => {
        const ink = window.__INK;
        if (!ink) return;
        if (typeof ink.shotStep === "function") await ink.shotStep(n, a);
      }, [name, arg]);
      await waitFrames(page, Number(args.warm || 6));
      // The boot overlay fades on a CSS transition; capturing before
      // it finishes washes the whole frame out by ~50%.
      await page.waitForFunction(() => !document.getElementById("ink-boot"), null, { timeout: 8000 })
        .catch(() => {});
      await delay(220);
      // The sim leaves the kite input engaged, so the game keeps
      // playing during the real frames before capture and can pop a
      // level-up card over the shot. Drain it right before shooting.
      await page.evaluate((keepLevelUp) => {
        const g = window.__INK && window.__INK.game;
        if (!g) return;
        let guard = 0;
        while (!keepLevelUp && g.phase === "levelup" && guard++ < 40) g.takeChoice();
        g.input.x = 0; g.input.y = 0;
      }, name === "levelup");
      await waitFrames(page, 2);
      const file = path.join(OUT, `${stepName.replace(/[^a-z0-9-]+/gi, "_")}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
    }
  }

  await writeFile(path.join(OUT, "console.log"), logs.join("\n") || "(no console output)", "utf8");
  await browser.close();
  if (server.proc) server.proc.kill();

  console.log(JSON.stringify({ out: OUT, shots, logs: logs.slice(-40) }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
