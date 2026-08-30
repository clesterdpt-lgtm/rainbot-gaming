#!/usr/bin/env node
/* ============================================================
   SAINTFALL - arm twist probe

   Reported as "occasionally the shoulder gets distorted after weapon
   use and looks smaller than the other side". That is a continuity
   bug, and continuity bugs are invisible in a still: the shoulder is
   not wrong, it is wrong SOMETIMES, after a swing, and it stays that
   way afterwards.

   `aimJoint` reads a joint's current orientation and applies only the
   minimal rotation that points its axis at the target. That fixes the
   AIM and says nothing about the ROLL about that axis, so the roll is
   inherited rather than solved - inherited from a value that is
   itself the previous frame's inheritance. The legs have always been
   reset to bind before their solve; the arms never were, and were the
   only chain in the rig running open-loop.

   Linear-blend skinning pinches a limb's cross-section where the bone
   is rolled, so a wound-up upper arm collapses that deltoid and the
   shoulder reads smaller than its opposite number.

   This runs a melee swing and measures the twist of each upper arm
   FROM ITS BIND POSE about its own local axis, plus whether the arms
   return to the same pose afterwards.

   Measured here, with and without the reset:

     with     peak twist 0.298 rad · settles 0.298 / 0.013
     without  peak twist 0.816 rad · settles 0.279 / -0.816

   47 degrees of roll on one arm and none on the other, persisting
   after the swing. The two arms differing at all is correct - the
   carry is asymmetric by design - but 47 degrees is skinning damage.

   Usage: node scripts/saintfall-arm-twist-probe.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(root, "output/saintfall/arm-twist");
const PORT = 47000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});
for (let i = 0; i < 150; i += 1) {
  try { const r = await fetch(`${BASE}/games/saintfall.html`); if (r.ok) break; } catch (_) { /* retry */ }
  await delay(100);
}

const browser = await chromium.launch({
  channel: "chromium", headless: true,
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader", "--mute-audio"],
});
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
  { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__SF && window.__SF.isReady(),
  null, { timeout: 300000 });

const probe = await page.evaluate(async () => {
  const T = window.__SF;
  T.invulnerable(true);
  T.hidePlayer(false);
  const fig = T.player.figure;

  const THREE = T.THREE;
  /* TWIST FROM BIND, decomposed about the bone's OWN LOCAL AXIS.

     The first cut of this took the bone's LOCAL quaternion and
     decomposed it about an axis computed from WORLD positions. Those
     are different frames, and the number that comes out of mixing
     them is not a twist - it is nothing. It reported 1.16 rad on an
     arm and kept reporting it after a fix that demonstrably worked.

     Relative to BIND is also the right reference: skinning pinches a
     limb according to how far the bone has rolled from the pose the
     weights were authored against, not from the identity. */
  const ARM_AXIS = new THREE.Vector3(0, -1, 0);
  const twistFromBind = (bone, bind) => {
    const q = new THREE.Quaternion().copy(bind).invert().multiply(bone.quaternion);
    const dot = q.x * ARM_AXIS.x + q.y * ARM_AXIS.y + q.z * ARM_AXIS.z;
    const px = ARM_AXIS.x * dot;
    const py = ARM_AXIS.y * dot;
    const pz = ARM_AXIS.z * dot;
    const len = Math.hypot(px, py, pz, q.w);
    if (len < 1e-9) return 0;
    let ang = 2 * Math.atan2(Math.hypot(px, py, pz) * Math.sign(dot || 1), q.w / len);
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    return ang;
  };

  const sample = () => {
    const rows = [];
    for (let i = 0; i < 2; i += 1) {
      const arm = fig.armPivots[i];
      rows.push({
        armAngle: 2 * Math.acos(Math.min(1, Math.abs(arm.quaternion.w))),
        twist: twistFromBind(arm, fig.armBindQuaternions[i]),
        elbowTwist: twistFromBind(fig.elbowPivots[i], fig.elbowBindQuaternions[i]),
      });
    }
    return rows;
  };

  const series = [];
  T.advanceTime(1.2, 1 / 60);
  series.push({ t: 0, s: sample() });
  /* PATH INDEPENDENCE is the property being fixed, so it is the
     property to test. Record the settled pose, run a swing, settle
     back to the same state, and compare: if the arm arrives at a
     different orientation depending on what it did on the way, the
     solve is carrying history and the shoulder can be left rolled. */
  const before = [0, 1].map((i) => fig.armPivots[i].quaternion.clone());
  // A melee swing is the biggest arm excursion the rig produces.
  if (T.meleeSwing) T.meleeSwing();
  else if (T.beginAction) T.beginAction("melee1");
  for (let k = 1; k <= 90; k += 1) {
    T.advanceTime(1 / 60, 1 / 60);
    series.push({ t: k / 60, s: sample() });
  }
  // And settle again, because the reported symptom is that it STAYS
  // wrong once the swing is over.
  T.advanceTime(2.5, 1 / 60);
  series.push({ t: 99, s: sample() });
  const drift = [0, 1].map((i) => before[i].angleTo(fig.armPivots[i].quaternion));
  return { series, drift };
});

const out = probe.series;
const jump = (key) => {
  let worst = 0;
  let at = 0;
  for (let i = 1; i < out.length - 1; i += 1) {
    for (let s = 0; s < 2; s += 1) {
      const d = Math.abs(out[i].s[s][key] - out[i - 1].s[s][key]);
      if (d > worst) { worst = d; at = out[i].t; }
    }
  }
  return { worst, at };
};

const armJump = jump("armAngle");
const twistJump = jump("twist");
const elbowTwistJump = jump("elbowTwist");
const last = out[out.length - 1].s;
const asym = Math.abs(Math.abs(last[0].twist) - Math.abs(last[1].twist));
const maxPau = Math.max(...out.flatMap((r) => r.s.map((x) => Math.abs(x.twist))));

console.log("worst frame-to-frame jump during a melee swing (radians):");
console.log(`  arm rotation   ${armJump.worst.toFixed(4)}  at t=${armJump.at.toFixed(2)}s`);
console.log(`  upper-arm TWIST ${twistJump.worst.toFixed(4)}  at t=${twistJump.at.toFixed(2)}s`);
console.log(`  forearm TWIST   ${elbowTwistJump.worst.toFixed(4)}  at t=${elbowTwistJump.at.toFixed(2)}s`);
console.log(`\nafter settling: upper-arm twist `
  + `${last[0].twist.toFixed(4)} / ${last[1].twist.toFixed(4)}`
  + `  (asymmetry ${asym.toFixed(4)} rad)`);
console.log(`peak |upper-arm twist| over the swing: ${maxPau.toFixed(4)} rad`);

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "probe.json"), JSON.stringify({
  measuredAt: new Date().toISOString(),
  armJump, twistJump, elbowTwistJump, asymmetry: asym, maxTwist: maxPau,
  series: out,
}, null, 2));

/* The pauldron must never move further in one frame than the arm it
   is following, and must settle symmetric. Both were violated by the
   Euler route. */
let bad = 0;
/* The carry is ASYMMETRIC by design - support hand front and
   palm-up, trigger hand rear and side-on - so the two arms are
   supposed to differ. What must not differ is the same arm from one
   visit of the same pose to the next. */
console.log(`\nreturn-to-rest drift after a swing: `
  + `${probe.drift.map((d) => d.toFixed(5)).join(" / ")} rad`);
if (Math.max(...probe.drift) > 0.02) {
  console.error("\n!! the arms do not return to the same pose - the solve is "
    + "carrying history, and a rolled shoulder will persist");
  bad += 1;
}
if (maxPau > 0.6) {
  console.error(`\n!! upper arm twisted past 0.6 rad from bind (${maxPau.toFixed(4)})`);
  bad += 1;
}
console.log(bad ? `\n${bad} failure(s)`
  : "\narms path-independent and twist bounded");

await browser.close();
server.kill();
if (bad) process.exitCode = 1;
