#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Windgate, photographed

   The natural rock archway landmark, shot from enough angles to
   answer the questions a single hero shot cannot:

     1. does it read as ONE eroded mass rather than a stack of
        cylindrical segments - the same "repeats too much" failure
        the dune boulders had, one order of magnitude larger;
     2. is it actually walkable underneath, with real clearance and
        no floating leg or buried footing;
     3. does looking THROUGH it work as a composition, the way a
        real arch's whole reputation rests on what it frames;
     4. does it survive a full orbit at footing height without a
        gap, a hole, or a facet that reads as backwards.

   Usage:  node scripts/saintfall-windgate-shots.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/windgate-shots");
const PORT = 49330 + (process.pid % 600);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e)));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&time=goldenhour&cycle=0&intro=0`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
    window.__SF.hideHud(true);
    window.__SF.releaseCamera();
  });

  const site = await page.evaluate(() => {
    const T = window.__SF;
    const mesh = T.ctx.scene.getObjectByName("windgate-rock");
    if (!mesh) return null;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    return {
      cx, cz,
      cy: (bb.min.y + bb.max.y) / 2,
      peakY: bb.max.y,
      groundY: T.ctx.terrain.heightAt(cx, cz),
      spanX: bb.max.x - bb.min.x,
      spanZ: bb.max.z - bb.min.z,
      halfDiag: Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2,
    };
  });
  if (!site) throw new Error("windgate-rock mesh not found - did the site search fail to place it?");
  console.log("Windgate site:", site);

  const settle = async () => { for (let i = 0; i < 3; i += 1) await page.evaluate(() => window.__SF.renderOnce(1 / 60)); };
  const shot = async (name) => { await settle(); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };

  // 01: hero, three-quarter, from a healthy distance.
  await page.evaluate(({ cx, cz, cy, r }) => {
    window.__SF.safeOrbit(cx, cz, cy, 0.9, r * 1.7, 0.22, 46);
  }, { cx: site.cx, cz: site.cz, cy: site.cy, r: site.halfDiag });
  await shot("01-hero");

  // 02: far establishing shot, as a dune-field landmark.
  await page.evaluate(({ cx, cz, cy, r }) => {
    window.__SF.safeOrbit(cx, cz, cy, 3.6, r * 4.2 + 30, 0.16, 52);
  }, { cx: site.cx, cz: site.cz, cy: site.cy, r: site.halfDiag });
  await shot("02-establishing");

  // 03: standing under it, looking straight up at the underside of
  // the span - the walkability and "is it hollow, does it read as
  // an arch and not a bridge" test in one frame.
  await page.evaluate(({ cx, cz, groundY }) => {
    window.__SF.lookAt([cx, groundY + 1.7, cz], [cx, groundY + 40, cz], 78);
  }, site);
  await shot("03-standing-under-looking-up");

  // 04-05: looking THROUGH the opening from outside, both directions -
  // the actual reputation of a real arch, and untestable from any
  // other angle.
  const yaw = 0.58;
  const along = { x: Math.cos(yaw), z: Math.sin(yaw) };
  await page.evaluate(({ cx, cz, groundY, ax, az, r }) => {
    const T = window.__SF;
    const camX = cx - ax * (r + 24);
    const camZ = cz - az * (r + 24);
    const cy = T.ctx.terrain.heightAt(camX, camZ) + 1.7;
    T.lookAt([camX, cy, camZ], [cx + ax * r * 0.3, groundY + 8, cz + az * r * 0.3], 50);
  }, { cx: site.cx, cz: site.cz, groundY: site.groundY, ax: along.x, az: along.z, r: site.spanX / 2 });
  await shot("04-through-from-a");

  await page.evaluate(({ cx, cz, groundY, ax, az, r }) => {
    const T = window.__SF;
    const camX = cx + ax * (r + 24);
    const camZ = cz + az * (r + 24);
    const cy = T.ctx.terrain.heightAt(camX, camZ) + 1.7;
    T.lookAt([camX, cy, camZ], [cx - ax * r * 0.3, groundY + 8, cz - az * r * 0.3], 50);
  }, { cx: site.cx, cz: site.cz, groundY: site.groundY, ax: along.x, az: along.z, r: site.spanX / 2 });
  await shot("05-through-from-b");

  // 06: profile, perpendicular to the span, at walking-eye height.
  await page.evaluate(({ cx, cz, cy, r }) => {
    window.__SF.safeOrbit(cx, cz, cy, 0.58 + Math.PI / 2, r * 2.0, 0.05, 48);
  }, { cx: site.cx, cz: site.cz, cy: site.cy, r: site.halfDiag });
  await shot("06-profile");

  // 07: close detail on one leg's surface, for facet/texture quality.
  await page.evaluate(({ cx, cz, groundY }) => {
    const T = window.__SF;
    T.lookAt([cx - 9, groundY + 4, cz - 4], [cx - 4, groundY + 8, cz - 2], 32);
  }, site);
  await shot("07-leg-detail");

  // 08-15: a full ring at footing height, the same discipline used on
  // the dune boulders - the systematic way to catch a floating base
  // or a hole rather than hoping one framing stumbles onto it.
  for (let i = 0; i < 8; i += 1) {
    const bearing = (i / 8) * Math.PI * 2;
    await page.evaluate(({ cx, cz, cy, r, bearing }) => {
      window.__SF.safeOrbit(cx, cz, cy, bearing, r * 1.4, 0.02, 50);
    }, { cx: site.cx, cz: site.cz, cy: site.cy * 0.55, r: site.halfDiag, bearing });
    await shot(`ring-${String(i).padStart(2, "0")}`);
  }

  console.log(`\nWrote frames to ${path.relative(root, OUT)}`);
  await browser.close();
} finally {
  server.kill();
}
