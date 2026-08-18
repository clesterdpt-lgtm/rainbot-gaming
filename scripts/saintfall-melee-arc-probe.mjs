#!/usr/bin/env node
/* ============================================================
   SAINTFALL - melee swing geometry probe

   Where does the blade ACTUALLY go?

   Every number the slash ribbon needs - how far the tip reaches, how
   high it rides, which way it sweeps and through how many radians -
   is a property of the authored animation, not of the gameplay reach
   constant the effect was being drawn from. This samples the real
   `weapon-tip` anchor every frame of each combo step, in the body's
   own frame, and prints the envelope.

   It also measures the turn: how much of a 180-degree reticle offset
   the body has covered by the time the hit window opens.

   Usage:
     node scripts/saintfall-melee-arc-probe.mjs
     node scripts/saintfall-melee-arc-probe.mjs --json out.json
   ============================================================ */

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((part) => part.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true])
);
const port = 54100 + (process.pid % 6000);
const base = `http://127.0.0.1:${port}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on("pageerror", (e) => console.log("PAGEERR", e.message.slice(0, 400)));
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&intro=skip`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const report = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.hideHud(true);
    T.invulnerable(true);
    T.clearEnemies();
    T._teleportRaw(84, 826, 0);
    T.setBodyHeading(0);
    T.setCam(0, -0.10, 6.4);
    T.equipWeapon("glaive");
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);

    const tipOf = () => {
      const w = T.weapons.current;
      const node = w?.tip;
      if (!node) return null;
      node.updateWorldMatrix(true, false);
      return node.getWorldPosition(new THREE.Vector3());
    };
    const buttOf = () => {
      const w = T.weapons.current;
      const node = w?.butt;
      if (!node) return null;
      node.updateWorldMatrix(true, false);
      return node.getWorldPosition(new THREE.Vector3());
    };

    /* One combo step, sampled by FREEZING the clip at an exact time
       rather than by stepping and hoping. `freezeAction` is the only
       way to sample an authored pose at a known clip second; stepping
       at 1/60 lands between keyframes and the peak is missed. */
    function sampleStep(name) {
      const spec = T.player.actionSpec(name);
      const dur = spec?.dur || 0.8;
      const samples = [];
      const ps = T.player.state;
      for (let i = 0; i <= 48; i += 1) {
        const t = (i / 48) * dur;
        T.freezeAction(name, t);
        const tip = tipOf();
        const butt = buttOf();
        if (!tip) continue;
        const dx = tip.x - ps.x;
        const dz = tip.z - ps.z;
        let rel = Math.atan2(dx, dz) - ps.yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        samples.push({
          t: +t.toFixed(3),
          r: +Math.hypot(dx, dz).toFixed(3),
          h: +(tip.y - ps.y).toFixed(3),
          bearing: +rel.toFixed(3),
          buttR: butt ? +Math.hypot(butt.x - ps.x, butt.z - ps.z).toFixed(3) : null,
        });
      }
      return { spec: { dur, hit: spec?.hit || null, arc: spec?.arc ?? null }, samples };
    }

    const steps = {};
    for (const name of ["melee1", "melee2", "melee3"]) {
      const { spec, samples } = sampleStep(name);
      const rs = samples.map((x) => x.r);
      const hs = samples.map((x) => x.h);
      const bs = samples.map((x) => x.bearing);
      const peak = samples.reduce((a, b) => (b.r > a.r ? b : a), samples[0]);
      // Inside the hit window only: that is the part the effect covers.
      const hit = spec.hit || [0, spec.dur];
      const inHit = samples.filter((x) => x.t >= hit[0] && x.t <= hit[1]);
      const hb = inHit.map((x) => x.bearing);
      const dir = inHit.length > 1
        ? Math.sign(inHit[inHit.length - 1].bearing - inHit[0].bearing) : 0;
      steps[name] = {
        dur: spec.dur, hit,
        combatArc: spec.arc,
        rMax: +Math.max(...rs).toFixed(3),
        rMin: +Math.min(...rs).toFixed(3),
        rAtPeak: +peak.r.toFixed(3),
        peakAtClipT: peak.t,
        hAtPeakR: peak.h,
        hMax: +Math.max(...hs).toFixed(3),
        hMin: +Math.min(...hs).toFixed(3),
        bearingMin: +Math.min(...bs).toFixed(3),
        bearingMax: +Math.max(...bs).toFixed(3),
        bearingSpan: +(Math.max(...bs) - Math.min(...bs)).toFixed(3),
        hitBearingFrom: inHit.length ? inHit[0].bearing : null,
        hitBearingTo: inHit.length ? inHit[inHit.length - 1].bearing : null,
        hitBearingSpan: hb.length ? +(Math.max(...hb) - Math.min(...hb)).toFixed(3) : null,
        hitRMax: inHit.length ? +Math.max(...inHit.map((x) => x.r)).toFixed(3) : null,
        hitHMid: inHit.length
          ? +(inHit.reduce((a, x) => a + x.h, 0) / inHit.length).toFixed(3) : null,
        sweepDir: dir,
        buttRMax: +Math.max(...samples.map((x) => x.buttR ?? 0)).toFixed(3),
        samples,
      };
    }
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);

    /* THE TURN. Face north, put the reticle due south, swing, and
       measure how much of the 180 degrees the body has covered by the
       time the hit window opens. */
    for (let i = 0; i < 140; i += 1) T.renderOnce(1 / 60);
    const ps = T.player.state;
    T.setBodyHeading(0);
    T.setCam(Math.PI, -0.05, 6.4);
    for (let i = 0; i < 40; i += 1) T.renderOnce(1 / 60);
    const yawBefore = ps.yaw;
    const camYaw = ps.camYaw;
    T.pressMelee();
    const turn = [];
    for (let i = 0; i < 60; i += 1) {
      T.renderOnce(1 / 60);
      let rel = ps.yaw - yawBefore;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      turn.push({
        f: i, at: +(i / 60).toFixed(3), action: T.player.action || null,
        turnedDeg: +(rel * 180 / Math.PI).toFixed(1),
      });
    }
    let towardTarget = 0;
    {
      let rel = ps.yaw - camYaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      towardTarget = +(Math.abs(rel) * 180 / Math.PI).toFixed(1);
    }
    // How far the body had turned when the hit window opened (0.31s
    // into melee1).
    const atHit = turn.find((x) => x.at >= 0.31) || turn[turn.length - 1];

    return {
      steps,
      turn: {
        camYawDeg: +(camYaw * 180 / Math.PI).toFixed(1),
        turnedByHitWindowDeg: atHit?.turnedDeg ?? null,
        hitWindowAt: atHit?.at ?? null,
        residualErrorDeg: towardTarget,
        trace: turn.filter((_, i) => i % 3 === 0),
      },
    };
  });

  const brief = (s) => ({
    rMax: s.rMax, rAtPeak: s.rAtPeak, hAtPeakR: s.hAtPeakR,
    hMin: s.hMin, hMax: s.hMax,
    bearing: `${s.bearingMin} -> ${s.bearingMax} (span ${s.bearingSpan}, dir ${s.sweepDir})`,
    peakAtClipT: s.peakAtClipT,
  });
  console.log("=== TIP ENVELOPE (body frame, metres / radians) ===");
  for (const [k, v] of Object.entries(report.steps)) {
    console.log(`${k}: ${JSON.stringify(brief(v))}`);
  }
  console.log("\n=== THE TURN (reticle 180 deg behind) ===");
  console.log(JSON.stringify(report.turn, (k, v) => (k === "trace" ? undefined : v), 1));
  console.log("turn trace:", report.turn.trace.map((x) => `${x.at}s:${x.turnedDeg}`).join("  "));

  if (typeof args.json === "string") {
    await writeFile(path.resolve(root, args.json), JSON.stringify(report, null, 1));
    console.log(`\nwrote ${args.json}`);
  }
  await browser.close();
} finally {
  server.kill();
}
