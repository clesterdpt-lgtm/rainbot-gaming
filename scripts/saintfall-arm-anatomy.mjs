#!/usr/bin/env node
/* ============================================================
   SAINTFALL - is the elbow bending the way an elbow bends?

   Every gate so far has measured whether the arms move SMOOTHLY -
   continuity across aim bearings, conditioning of the pole, no jumps
   through the sheathe. All of it passes, and the elbow was still
   being reported as inverted, because none of it asks the only
   question that matters to someone looking at the trooper: does the
   arm hinge the way an arm hinges?

   A human elbow is a hinge with one direction. With the hand in front
   of the shoulder, the elbow goes BACK and OUT; it can never lead the
   wrist. So the test is the sign of the elbow's offset along the
   body's forward axis: positive - elbow ahead of the shoulder-wrist
   line - is an arm bending the wrong way, however smoothly it does it.

   Prints the joints in the trooper's own frame so the geometry can be
   read directly rather than inferred from a screenshot.

   Usage: node scripts/saintfall-arm-anatomy.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43300 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=low`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

    await page.evaluate((on) => { window.__SF_POLE_SWEEP = on; },
      process.argv.includes("--sweep"));
    const out = await page.evaluate(() => {
      const T = window.__SF;
      const THREE = T.THREE;
      T.clearEnemies();
      T.releaseCamera();
      T.teleport(-520, -562, 0);
      T.autoStow(false);
      T.weapons.setMode("ranged");
      T.setGaitInput(0, 0);

      const fig = T.figureNodes();
      const p = new THREE.Vector3();
      const rows = [];

      function frame(label) {
        const s = T.gaitState();
        // Body basis. `right` is checked against the shoulders below
        // rather than assumed from a handedness argument.
        const fwd = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
        const right = new THREE.Vector3(-Math.cos(s.yaw), 0, Math.sin(s.yaw));
        const origin = new THREE.Vector3();
        fig.root.getWorldPosition(origin);
        const local = (node) => {
          node.getWorldPosition(p);
          p.sub(origin);
          return {
            r: +p.dot(right).toFixed(3),
            f: +p.dot(fwd).toFixed(3),
            u: +p.y.toFixed(3),
          };
        };
        const entry = { label, arms: [] };
        for (let a = 0; a < 2; a += 1) {
          const sh = local(fig.armPivots[a]);
          const el = local(fig.elbowPivots[a]);
          const wr = local(fig.handPivots[a]);
          // Elbow offset from the shoulder-wrist line, same basis.
          const ax = { r: wr.r - sh.r, f: wr.f - sh.f, u: wr.u - sh.u };
          const len = Math.hypot(ax.r, ax.f, ax.u) || 1;
          ax.r /= len; ax.f /= len; ax.u /= len;
          const d = { r: el.r - sh.r, f: el.f - sh.f, u: el.u - sh.u };
          const along = d.r * ax.r + d.f * ax.f + d.u * ax.u;
          const off = {
            r: +(d.r - ax.r * along).toFixed(3),
            f: +(d.f - ax.f * along).toFixed(3),
            u: +(d.u - ax.u * along).toFixed(3),
          };
          entry.arms.push({ sh, el, wr, off });
        }
        rows.push(entry);
      }

      /* POLE SWEEP. The trigger elbow was measured sitting 28cm
         further out than the shoulder and only 16cm below it - flared
         at shoulder height with the hand back at the hip, which is
         the chicken wing that reads as inverted. The pole picks that
         point, so the candidates are swept and the pose each produces
         is measured, rather than nudging numbers at a screenshot. */
      if (window.__SF_POLE_SWEEP) {
        /* The elbow rides a CIRCLE about the shoulder-wrist axis, so
           drop and fore-aft are not independent - the pole picks one
           point and gets whatever the other is there. Swept finely to
           find how much drop is available before the elbow leads the
           shoulder. */
        /* Two arcs, forward-leaning and backward-leaning. The first
           sweep only offered forward poles, which on the old
           behind-the-hip grip was moot - no pole reached a natural
           elbow - but with the grip beside the hip the backward half
           is where the correct answers live. */
        const cands = [];
        for (const zk of [0.24, -0.30]) {
          for (let k = 0; k <= 8; k += 1) {
            const a = (k / 8) * Math.PI * 0.5;
            cands.push([-Math.cos(a) * 0.92, -Math.sin(a) * 0.92, zk]);
          }
        }
        const sweep = [];
        for (const c of cands) {
          T.elbowPole(1, c[0], c[1], c[2]);
          T.setFiring(false);
          for (let i = 0; i < 150; i += 1) T.renderOnce(1 / 60);
          const s = T.gaitState();
          const fwd = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
          const right = new THREE.Vector3(-Math.cos(s.yaw), 0, Math.sin(s.yaw));
          const o = new THREE.Vector3();
          fig.root.getWorldPosition(o);
          const loc = (n) => {
            n.getWorldPosition(p); p.sub(o);
            return { r: p.dot(right), f: p.dot(fwd), u: p.y };
          };
          const sh = loc(fig.armPivots[1]);
          const el = loc(fig.elbowPivots[1]);
          const wr = loc(fig.handPivots[1]);
          const ang = (() => {
            const a = [sh.r - el.r, sh.f - el.f, sh.u - el.u];
            const b = [wr.r - el.r, wr.f - el.f, wr.u - el.u];
            const la = Math.hypot(...a);
            const lb = Math.hypot(...b);
            const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
            return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
          })();
          sweep.push({
            pole: c,
            dropCm: Math.round((sh.u - el.u) * 100),
            outboardCm: Math.round((el.r - sh.r) * 100),
            behindCm: Math.round((sh.f - el.f) * 100),
            /* The verdict column: the forward component of the
               elbow's perpendicular offset from the shoulder-wrist
               line. Positive means the bend kinks forward of the arm
               - the "bending the wrong way" read - whatever the drop
               and flare columns say. */
            kinkFwdCm: (() => {
              const ax = [wr.r - sh.r, wr.f - sh.f, wr.u - sh.u];
              const n = Math.hypot(ax[0], ax[1], ax[2]) || 1;
              const a0 = ax[0] / n;
              const a1 = ax[1] / n;
              const a2 = ax[2] / n;
              const d0 = el.r - sh.r;
              const d1 = el.f - sh.f;
              const d2 = el.u - sh.u;
              const along = d0 * a0 + d1 * a1 + d2 * a2;
              return Math.round((d1 - a1 * along) * 100);
            })(),
            elbowDeg: Math.round(ang),
            gripMissCm: Math.round(T.armReachCheck()[1].slackPct),
          });
        }
        T.elbowPole(1, cands[0][0], cands[0][1], cands[0][2]);
        return { sweep };
      }

      T.setFiring(false);
      for (let i = 0; i < 240; i += 1) T.renderOnce(1 / 60);
      frame("low ready");
      T.setFiring(true);
      for (let i = 0; i < 240; i += 1) T.renderOnce(1 / 60);
      frame("committed");
      T.setFiring(false);
      T.forceStow(1);
      for (let i = 0; i < 200; i += 1) T.renderOnce(1 / 60);
      frame("slung (arms free)");
      T.forceStow(0);
      for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
      return rows;
    });

    if (out.sweep) {
      console.log("\nSAINTFALL trigger elbow pole sweep");
      console.log("=".repeat(74));
      console.log("pole                      drop  outboard  behind  kinkFwd  elbow  reach%");
      for (const r of out.sweep) {
        console.log(`(${r.pole.map((v) => v.toFixed(2).padStart(5)).join(",")})  `
          + `${String(r.dropCm).padStart(5)}cm ${String(r.outboardCm).padStart(6)}cm `
          + `${String(r.behindCm).padStart(6)}cm ${String(r.kinkFwdCm).padStart(6)}cm `
          + `${String(r.elbowDeg).padStart(4)}deg ${String(r.gripMissCm).padStart(5)}`);
      }
      console.log("=".repeat(74));
      return;
    }
    console.log("\nSAINTFALL arm anatomy   (r = trooper's right, f = forward, u = up)");
    console.log("=".repeat(74));
    for (const row of out) {
      console.log(`\n${row.label}`);
      for (let a = 0; a < 2; a += 1) {
        const m = row.arms[a];
        const name = a === 0 ? "support/left " : "trigger/right";
        const v = (o) => `(${o.r.toFixed(2).padStart(6)},${o.f.toFixed(2).padStart(6)},${o.u.toFixed(2).padStart(6)})`;
        console.log(`  ${name}  shoulder ${v(m.sh)}  elbow ${v(m.el)}  wrist ${v(m.wr)}`);
        const lead = m.off.f > 0.02;
        console.log(`                 elbow off the shoulder-wrist line ${v(m.off)}`
          + `   ${lead ? "<-- LEADS the wrist: bends the wrong way" : "trails the wrist: correct"}`);
      }
    }
    console.log(`\n${"=".repeat(74)}`);
    // The shoulders confirm which way `right` points, so the signs
    // above are not resting on a handedness argument.
    const sh = out[0].arms;
    console.log(`sanity: left shoulder r=${sh[0].sh.r}, right shoulder r=${sh[1].sh.r}`
      + ` (right shoulder should be the positive one)`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
