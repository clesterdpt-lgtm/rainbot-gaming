#!/usr/bin/env node
/* ============================================================
   SAINTFALL - what the creature surface kit costs

   The boss audit's numbers move by 8-10% between sessions on the same
   code, because the frame is GPU fill-bound and the machine is not
   idle. Comparing a run today against a table written last week
   therefore cannot resolve a change this size - it once reported
   every boss getting FASTER after work that could only add cost.

   So this measures both halves IN ONE SESSION, interleaved, on the
   same posed fight: the kit's active path against the kit's own
   distance branch closed (fade collapsed to zero, so `sfDet` is 0 and
   the whole block is skipped). That difference is the honest answer
   to "what does the surface cost while a boss is on screen".

   AND IT IS ONLY AN ANSWER IF THE TOGGLE MOVED SOMETHING ON THAT
   BOSS. The first version collected every `sfSurface` material in the
   scene and toggled the lot, then printed a per-boss row. Garner,
   Abbess and Stylite are `procedural: true` - the loader hands them no
   material, their modules build their own, and none of those has been
   through `applySurface` yet - so for three of the six the "off" and
   the "on" state were the SAME STATE on the subject, and the harness
   reported a reassuring +0.02 ms for a feature that was not there. A
   cost table that green-lights an absent feature is worse than no
   table: it is the number someone quotes when they ask why the kit
   was cheap.

   So the toggle is now scoped to the boss's own materials and READ
   BACK. A boss whose uniforms did not move is SKIPPED, loudly, and
   named in the footer.

   Usage:  node scripts/saintfall-surface-cost.mjs [--port 49978]
   ============================================================ */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true])
);
/* Derived from the pid, like every other harness in this repo, with an
   override. A fixed port means the second agent to start this on a
   shared tree binds nothing, serves nobody, and times out at the boot
   wait with no hint that another run owns 49978. */
const PORT = Number(args.port || 49900 + (process.pid % 90));
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.invulnerable(true);
    window.__kit = {
      /* WHERE THE ANIMAL IS, per boss, and it is not one place.
         The rigged bosses hang their geometry off `inst.root`; the
         procedural ones (Garner, Stylite, Abbess) leave that root an
         empty anchor and add a scene-level group named for the
         species. Scoping to the union means a module that adopts the
         kit tomorrow is picked up without touching this file, and a
         module that has not is honestly reported as empty rather than
         borrowing another boss's materials from the same scene. */
      roots(key) {
        const out = [];
        for (const inst of T.ctx.enemies.live) {
          if (inst.key === key && inst.root) out.push(inst.root);
        }
        const group = T.ctx.scene.getObjectByName(key);
        if (group && !out.includes(group)) out.push(group);
        return out;
      },
      mats(key) {
        const out = [];
        for (const root of window.__kit.roots(key)) {
          root.traverse((o) => {
            const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
            for (const m of ms) {
              if (m && m.userData && m.userData.sfSurface && !out.includes(m)) out.push(m);
            }
          });
        }
        return out;
      },
      set(on, key) {
        for (const m of window.__kit.mats(key)) {
          const u = m.userData.sfSurface.uniforms.uSfWear.value;
          if (!m.userData.sfFade) m.userData.sfFade = [u.x, u.y];
          if (on) { u.x = m.userData.sfFade[0]; u.y = m.userData.sfFade[1]; }
          else { u.x = 0; u.y = 0.001; }
        }
      },
      /* Read the uniform back on both sides of the toggle. A material
         whose stored fade is already (0, 0.001) - a boss faded out at
         this distance, say - toggles to an identical value, and a
         "material count > 0" test would pass while measuring nothing.
         The gate is that a NUMBER CHANGED. */
      probe(key) {
        const mats = window.__kit.mats(key);
        const read = () => mats.map((m) => {
          const u = m.userData.sfSurface.uniforms.uSfWear.value;
          return `${u.x},${u.y}`;
        });
        window.__kit.set(true, key);
        const on = read();
        window.__kit.set(false, key);
        const off = read();
        window.__kit.set(true, key);
        let moved = 0;
        for (let i = 0; i < mats.length; i += 1) if (on[i] !== off[i]) moved += 1;
        return { materials: mats.length, moved,
          names: mats.slice(0, 6).map((m) => m.name || "(unnamed)") };
      },
    };
  });

  /* The same posed fights the boss audit uses, so the two harnesses
     are talking about the same frame. */
  const POSES = {
    /* Keyed by the species key the scene knows it as, because the
       scoping above looks the animal up by that name. */
    distaff: `T.teleportToDistaff(26); T.advanceToDistaffPhase("standing", 20);
      T.spillWeb(T.player.state.x + 6, T.player.state.z, 6, 12);`,
    winnower: `T.teleportToWinnower(40); T.advanceToWinnowerPhase("soar", 30);`,
    garner: `T.teleportToGarner(30); T.advanceToGarnerPhase("feeding", 20);
      for (let i = 0; i < 6; i += 1) T.forceGarnerLash(i);
      T.forceGarnerVolley(); T.advanceTime(0.8, 1 / 60);`,
    abbess: `T.teleportToAbbess(34); T.advanceToAbbessPhase("seated", 20);
      T.forceAbbessClutch(); T.advanceTime(5.4, 1 / 60);
      T.forceAbbessClutch(); T.forceAbbessSlam(); T.advanceTime(0.9, 1 / 60);`,
    stylite: `T.teleportToStylite(46); T.advanceToStylitePhase("perched", 18);
      T.forceStyliteStoop(); T.advanceTime(0.7, 1 / 60);`,
    coulter: `const s = T.ctx.mission.bosses.find((b) => b.key === "saint");
      T._teleportRaw(s.x + 60, s.z, 0); T.advanceTime(3, 1 / 60);`,
  };

  const sample = async (on, key) => page.evaluate(`(() => {
    const T = window.__SF;
    window.__kit.set(${on}, ${JSON.stringify(key)});
    /* dt ZERO. The first pass measured with the simulation running,
       so the scene drifted between the two halves - the Distaff spun
       up seven extra draw calls mid-sample and the Abbess came out a
       millisecond FASTER with more work in the shader. Frozen scene,
       frozen pose, redraw only: the only thing left varying is the
       fragment shader, which is the thing being measured. */
    for (let i = 0; i < 30; i += 1) T.renderOnce(0);   // warm
    const N = 200;
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) T.renderOnce(0);
    const r = T.report().render;
    return { ms: (performance.now() - t0) / N, calls: r.calls, tris: r.triangles };
  })()`);

  console.log("\nboss         off ms   on ms    delta   draws(off/on)  materials");
  const skipped = [];
  for (const [key, setup] of Object.entries(POSES)) {
    await page.evaluate(`(() => { const T = window.__SF; ${setup} })()`);

    /* THE GATE, and it runs before the stopwatch does. Posed first,
       because the subject has to be the thing that is on screen: a
       Winnower still in its dormant perch has different children than
       one mid-soar, and asking before the pose would scope the toggle
       to the wrong set. */
    const kit = await page.evaluate((k) => window.__kit.probe(k), key);
    if (!kit.moved) {
      skipped.push({ key, ...kit });
      console.log(`${key.padEnd(11)} ${"SKIPPED".padStart(7)} - ${kit.materials
        ? `${kit.materials} surface material(s) but none moved when toggled`
        : "no material on this boss has been through applySurface"}`);
      continue;
    }

    /* THREE INTERLEAVED PAIRS, not one each. A single off-then-on
       ordering charges every bit of drift during the run to the "on"
       half; alternating and taking the median cancels it. */
    const off = [];
    const on = [];
    for (let r = 0; r < 5; r += 1) {
      off.push(await sample(false, key));
      on.push(await sample(true, key));
    }
    const med = (a) => a.map((x) => x.ms).sort((p, q) => p - q)[Math.floor(a.length / 2)];
    const mOff = med(off);
    const mOn = med(on);
    /* The noise floor, printed next to the delta rather than left for
       the reader to assume. Scoping the toggle to the boss shrank the
       thing being measured from "every creature material in the
       frame" to "this animal's own", and for a boss that is a tenth of
       the pixels the honest answer is often smaller than the spread
       between two identical samples. A delta inside the floor is not a
       small cost, it is no measurement, and it must not be quoted as
       one. */
    const spread = (a) => {
      const v = a.map((x) => x.ms);
      return Math.max(...v) - Math.min(...v);
    };
    const floor = Math.max(spread(off), spread(on));
    const delta = mOn - mOff;
    console.log(`${key.padEnd(11)} ${mOff.toFixed(2).padStart(7)} ${mOn.toFixed(2).padStart(8)}`
      + ` ${(delta >= 0 ? "+" : "") + delta.toFixed(2)}`.padStart(9)
      + `   ${String(off[0].calls).padStart(4)}/${String(on[0].calls).padEnd(4)}`
      + `   ${kit.moved}/${kit.materials} moved`
      + (Math.abs(delta) < floor ? `   (under the ${floor.toFixed(2)}ms noise floor)` : ""));
  }

  /* Loud, at the end, where a number-hunting reader cannot miss it.
     The whole defect this replaces was a row of small positive deltas
     that read as "measured and cheap" for three bosses that had
     nothing to measure. */
  if (skipped.length) {
    console.log(`\n${skipped.length} of ${Object.keys(POSES).length} bosses HAVE NO SURFACE`
      + ` and were not measured: ${skipped.map((s) => s.key).join(", ")}.`);
    console.log("  They build their own materials and have not adopted"
      + " assets/js/saintfall/boss-surface.js.");
    console.log("  Any cost quoted for them is a cost for a feature that is not on them.");
    process.exitCode = 1;
  }
  await browser.close();
} finally {
  server.kill();
}
