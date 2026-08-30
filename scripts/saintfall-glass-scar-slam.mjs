#!/usr/bin/env node
/* Focused regression for flight-melee landing beside Glass Scar
   collision. A committed slam must finish on walkable ground rather
   than handing the player controller an overlapping grounded capsule. */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const outDir = path.join(root, "output/saintfall/glass-scar-slam");
const port = 52800 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  for (let i = 0; i < 160; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) {}
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  await mkdir(outDir, { recursive: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const cases = await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.invulnerable(true);
    T.clearEnemies();
    const probes = [
      { id: "scar-shard", x: 884.8114, z: 120 },
      { id: "scar-vein", x: 624.1476, z: 317.8524 },
    ];
    let overlap = null;
    for (let z = -20; z <= 350 && !overlap; z += 3) {
      for (let x = 560; x <= 980; x += 3) {
        const y = T.collide.groundHeight(x, z);
        if (T.collide.blocked(x, z, y, T.collide.radius)) {
          overlap = { id: "scar-forced-overlap", x, z, forced: true };
          break;
        }
      }
    }
    if (overlap) probes.push(overlap);
    return probes.map((probe) => {
      T.resetSlam(true);
      T.ctx.jetpack.reset(true);
      const ps = T.player.state;
      const ground = T.collide.groundHeight(probe.x, probe.z);
      T._teleportRaw(probe.x, probe.z, 0);
      ps.y = ground + 13;
      ps.vy = 0;
      ps.grounded = false;
      T.ctx.jetpack.state.inFlight = true;
      T.ctx.jetpack.state.active = false;
      const correctionsBefore = ps.slamLandingCorrections;
      const triggered = T.triggerSlam().triggered;
      let frames = 0;
      let sawPlunge = false;
      if (probe.forced) {
        for (; frames < 180 && T.slamState().phase !== "plunge"; frames += 1) {
          T.advanceTime(1 / 120, 1 / 120);
        }
        sawPlunge = T.slamState().phase === "plunge";
        /* Reproduce the bad handoff: the descending attack reaches
           terrain on a column occupied by authored Scar geometry. */
        const overlapGround = T.collide.groundHeight(probe.x, probe.z);
        ps.x = probe.x;
        ps.z = probe.z;
        ps.y = overlapGround + 0.06;
        ps.vy = -T.slam.config.plungeSpeed;
        ps.grounded = false;
        T.ctx.jetpack.state.inFlight = true;
      }
      for (; frames < 720; frames += 1) {
        T.advanceTime(1 / 120, 1 / 120);
        sawPlunge ||= T.slamState().phase === "plunge";
        if (!T.slamState().active) break;
      }
      const support = T.collide.groundHeight(ps.x, ps.z);
      const blocked = T.collide.blocked(ps.x, ps.z, support, T.collide.radius);
      const flightBlocked = T.collide.flightBlocked(ps.x, ps.z, support,
        T.collide.radius, 2.35, true);
      const slide = T.collide.slide(ps.x, ps.z, ps.x + 2, ps.z, null);
      return {
        ...probe, triggered, sawPlunge, frames,
        phase: T.slamState().phase,
        reason: T.slamState().lastReason,
        grounded: ps.grounded,
        blocked, flightBlocked,
        correction: Math.hypot(ps.x - probe.x, ps.z - probe.z),
        landingCorrections: ps.slamLandingCorrections - correctionsBefore,
        moved: Math.hypot(slide[0] - ps.x, slide[1] - ps.z),
      };
    });
  });

  for (const result of cases) {
    check(`${result.id}: flight melee reaches a real impact`,
      result.triggered && result.sawPlunge && result.reason === "impact"
        && result.phase === "recover",
      JSON.stringify(result));
    check(`${result.id}: landing is grounded, clear and movable`,
      result.grounded && !result.blocked && !result.flightBlocked && result.moved > 0.35,
      JSON.stringify(result));
    if (result.id === "scar-forced-overlap") {
      check("the overlapping slam exercises the bounded landing correction",
        result.landingCorrections > 0 && result.correction > 0.1,
        JSON.stringify(result));
    }
  }
  check("the Glass Scar contains a real authored overlap probe",
    cases.some((result) => result.id === "scar-forced-overlap"));
  const scarFrame = await page.evaluate(() => {
    const T = window.__SF;
    T.setPose("scar-floor");
    for (let i = 0; i < 4; i += 1) T.renderStill();
    return T.captureDataURL();
  });
  await writeFile(path.join(outDir, "scar-floor.png"),
    Buffer.from(scarFrame.slice(scarFrame.indexOf(",") + 1), "base64"));
  check("no browser runtime errors", errors.length === 0, errors.join(" | "));
  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (failed) process.exitCode = 1;
