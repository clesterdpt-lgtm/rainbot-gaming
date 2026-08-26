#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Coulter's head, right way up

   The root of the burrower carries the head's full orientation, and
   for most of the animal's life that orientation was built with
   `setFromUnitVectors(+Z, dir)` - the SHORTEST ARC onto the heading.
   The shortest arc onto a heading near -Z is a half turn about an axis
   that is only well defined while the pitch is exactly zero, so a
   pitched Coulter travelling roughly north rolled over onto its back
   and snapped upright again as soon as it turned away.

   This walks the whole heading circle at several pitches, poses the
   body at each one, and asks two questions of the resulting frame:
   does it still AIM where the animal is going, and is the belly still
   down. The first is what a roll fix must not break; the second is the
   bug.

   Usage:  node scripts/saintfall-coulter-head-roll.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49948;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const findings = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) findings.push(label);
};

try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE}/games/saintfall.html`); if (r.ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 520 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

  const out = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    T.advanceTime(0.1, 1 / 60);
    const inst = T.ctx.enemies.live.find((e) => e.eventId === "district-boss:saint");
    if (!inst || !inst.body) return { missing: true };
    const b = inst.body;
    const up = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const rows = [];
    for (const pitch of [0, 0.25, 0.55, -0.35, -0.92]) {
      for (let deg = 0; deg < 360; deg += 5) {
        const heading = deg * Math.PI / 180;
        b.heading = heading;
        b.pitch = pitch;
        const cp = Math.cos(pitch);
        b.dir.set(Math.sin(heading) * cp, Math.sin(pitch), Math.cos(heading) * cp);
        T.ctx.enemies.poseBody(inst);
        up.set(0, 1, 0).applyQuaternion(b.quat);
        fwd.set(0, 0, 1).applyQuaternion(b.quat);
        rows.push({
          pitch, deg,
          up: up.y,
          // How far the drawn forward axis is from the travel direction.
          aim: fwd.distanceTo(b.dir),
          // Any lean at all: the sideways axis should stay level.
          roll: Math.abs(Math.atan2(up.x * Math.cos(heading) - up.z * Math.sin(heading),
            up.y)),
        });
      }
    }
    return { rows };
  });

  if (out.missing) throw new Error("the Coulter was not alive to pose");
  const worstUp = out.rows.reduce((a, r) => (r.up < a.up ? r : a));
  const worstAim = out.rows.reduce((a, r) => (r.aim > a.aim ? r : a));
  const worstRoll = out.rows.reduce((a, r) => (r.roll > a.roll ? r : a));
  console.log(`\n=== ${out.rows.length} poses ===`);
  check(worstAim.aim < 1e-5, "the frame still aims exactly where the animal travels",
    `worst ${worstAim.aim.toExponential(2)} at pitch ${worstAim.pitch}, heading ${worstAim.deg} deg`);
  check(worstUp.up > 0.5, "the belly stays down at every heading",
    `lowest up.y ${worstUp.up.toFixed(3)} at pitch ${worstUp.pitch}, heading ${worstUp.deg} deg`);
  check(worstRoll.roll < 1e-4, "and there is no roll anywhere on the circle",
    `worst ${(worstRoll.roll * 180 / Math.PI).toFixed(3)} deg at pitch ${worstRoll.pitch}, `
    + `heading ${worstRoll.deg} deg`);
  check(errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(findings.length ? `\n${findings.length} FINDING(S)` : "\nclean");
  process.exitCode = findings.length ? 1 : 0;
} finally {
  server.kill();
}
