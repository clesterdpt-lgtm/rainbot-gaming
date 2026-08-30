#!/usr/bin/env node
/* Kenosis AIRBORNE mobility: how far the Censer leap actually
   carries, and where the White Vigil's stoop goes when it is aimed.
   Both are distance claims, and distance is the one thing a
   screenshot cannot settle - the first leap "worked" in every plate
   while travelling four metres, because a one-frame speed floor is
   invisible in a still.

   The stoop is flown at three pitches, because "aimable" means the
   line follows the reticle: a flat aim must produce a horizontal
   lance, a steep one a dive, and the two must not be the same. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/kenosis-mobility");
const port = 47000 + (process.pid % 1200);
const base = `http://127.0.0.1:${port}`;

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}
async function waitServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall-white-vigil.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};

async function open(browser, character) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  await page.goto(
    `${base}/games/saintfall-white-vigil.html?qa=1&character=${character}&quality=medium&time=noon&fuel=limited`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => document.documentElement.classList.add("sf-maximised"));
  return { page, context, errors };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  const report = {};
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });

    /* ---------------- the Censer leap ---------------- */
    {
      const { page, context, errors } = await open(browser, "bastion-penitent");
      const leap = await page.evaluate(() => {
        const T = window.__SF;
        const P = T.player;
        T.teleport(90, 900, Math.PI);
        T.advanceTime(1.2, 1 / 60);
        const from = { x: P.state.x, y: P.state.y, z: P.state.z };
        T.setJetInput(true);
        T.advanceTime(0.10, 1 / 60);
        T.setJetInput(false);
        let peak = P.state.y;
        let air = 0;
        for (let i = 0; i < 260; i += 1) {
          T.advanceTime(1 / 60, 1 / 60);
          peak = Math.max(peak, P.state.y);
          if (!P.state.grounded) air += 1 / 60;
          if (P.state.grounded && i > 12) break;
        }
        const s = P.state;
        return {
          horizontal: Math.hypot(s.x - from.x, s.z - from.z),
          rise: peak - from.y,
          airSeconds: air,
          jet: T.jetpackState(),
        };
      });
      report.leap = leap;
      console.log(`\ncenser leap: ${leap.horizontal.toFixed(1)}m across, ${leap.rise.toFixed(1)}m up, ${leap.airSeconds.toFixed(2)}s aloft`);
      check("censer leap clears real ground", leap.horizontal >= 12,
        { horizontal: Number(leap.horizontal.toFixed(1)) });
      check("censer leap gets height", leap.rise >= 3.5,
        { rise: Number(leap.rise.toFixed(1)) });
      check("censer leap never enters flight", leap.jet.inFlight === false,
        { mode: leap.jet.mode });
      /* CONTROL FOR THE STOOP'S VFX TEST BELOW. The Penitent's Fall
         owns the overhead column rig ("slam-column": a cylinder
         built along +Y with a halo over the head). Proving it LIGHTS
         here is what makes "it never lights during a stoop"
         meaningful rather than a test of a name that no longer
         exists. Driven through the real melee key while airborne. */
      const fall = await page.evaluate(() => {
        const T = window.__SF;
        const P = T.player;
        T.teleport(90, 900, Math.PI);
        T.advanceTime(0.8, 1 / 60);
        P.state.y += 14;
        P.state.grounded = false;
        P.state.vy = 0;
        T.advanceTime(1 / 60, 1 / 60);
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyF" }));
        const col = T.vfx.group.getObjectByName("slam-column");
        let lit = false;
        for (let i = 0; i < 70; i += 1) {
          T.advanceTime(1 / 60, 1 / 60);
          if (col && col.visible) lit = true;
        }
        return { found: !!col, lit, slamActive: !!T.slam?.state?.active };
      });
      report.fallColumn = fall;
      check("control: the Fall does light the overhead column",
        fall.found && fall.lit, fall);
      if (errors.length) console.log("bastion pageErrors:", errors.slice(0, 3));
      await context.close();
    }

    /* ---------------- the Vigil stoop ---------------- */
    {
      const { page, context, errors } = await open(browser, "white-vigil");
      const stoop = await page.evaluate(() => {
        const T = window.__SF;
        const P = T.player;
        const runs = {};
        /* Flat, shallow-down and steep-down, all from the same
           launch: the aim is the only variable. */
        for (const [label, pitch] of [["flat", 0.0], ["shallow", -0.35], ["steep", -1.1]]) {
          T.teleport(90, 900, Math.PI);
          T.advanceTime(0.8, 1 / 60);
          T.summit.kitReset();
          /* HEIGHT, or the dive is only measuring the floor. Launched
             from a couple of metres up, a steep stoop reaches the
             ground in a third of a second and every aim reads the
             same. 25m is a ledge on this mountain, and it is the
             altitude at which the aim is the only variable. */
          P.state.y += 25;
          P.state.grounded = false;
          P.state.vy = 0;
          T.advanceTime(1 / 60, 1 / 60);
          P.state.aimViewYaw = P.state.yaw;
          P.state.aimViewPitch = pitch;
          const from = { x: P.state.x, y: P.state.y, z: P.state.z };
          const fired = T.summit.aerialThrust();
          let minY = P.state.y;
          let maxY = P.state.y;
          for (let i = 0; i < 60; i += 1) {
            T.advanceTime(1 / 60, 1 / 60);
            minY = Math.min(minY, P.state.y);
            maxY = Math.max(maxY, P.state.y);
            if (!T.summit.kitState().thrust.active) break;
          }
          const s = P.state;
          runs[label] = {
            fired,
            horizontal: Number(Math.hypot(s.x - from.x, s.z - from.z).toFixed(2)),
            drop: Number((from.y - minY).toFixed(2)),
            netY: Number((s.y - from.y).toFixed(2)),
            thrust: T.summit.kitState().thrust,
          };
          T.advanceTime(2.0, 1 / 60);
        }
        return runs;
      });
      report.stoop = stoop;
      console.log("\nvigil stoop, by aim:");
      for (const [k, v] of Object.entries(stoop)) {
        console.log(`   ${k.padEnd(8)} horizontal ${v.horizontal}m  drop ${v.drop}m  netY ${v.netY}m  (${v.thrust.distance}m of line)`);
      }
      check("stoop: a flat aim throws a horizontal lance",
        stoop.flat.fired && stoop.flat.horizontal >= 14 && Math.abs(stoop.flat.netY) <= 3.0,
        { horizontal: stoop.flat.horizontal, netY: stoop.flat.netY });
      check("stoop: a steep aim dives",
        stoop.steep.fired && stoop.steep.drop > stoop.flat.drop + 8,
        { steepDrop: stoop.steep.drop, flatDrop: stoop.flat.drop });
      check("stoop: the aim is the line, not a constant",
        stoop.flat.horizontal > stoop.steep.horizontal + 5,
        { flat: stoop.flat.horizontal, steep: stoop.steep.horizontal });
      check("stoop: a shallow aim still crosses ground",
        stoop.shallow.horizontal >= 14,
        { horizontal: stoop.shallow.horizontal });
      /* The whole line, whatever its angle: the old plunge was a
         vertical 46 m/s drop with no reach at all. */
      for (const [k, v] of Object.entries(stoop)) {
        check(`stoop: ${k} covers real ground`, v.thrust.distance >= 18,
          { line: v.thrust.distance });
      }
      /* THROUGH THE REAL INPUTS, WHILE GENUINELY FLYING. The direct
         verb above cannot see an input-routing fault, and getting
         airborne by writing `vy` never sets `inFlight` - which is
         exactly how a stoop that refused itself in mid-flight passed
         a green probe. Fly on the actual pack, then press the actual
         buttons. */
      const live = await page.evaluate(async () => {
        const T = window.__SF;
        const P = T.player;
        const out = {};
        const flyThenPress = async (label, press) => {
          T.teleport(90, 900, Math.PI);
          T.advanceTime(0.8, 1 / 60);
          T.summit.kitReset();
          T.setJetInput(true);
          T.advanceTime(1.4, 1 / 60);
          const flying = !!T.jetpackState().inFlight;
          const from = { x: P.state.x, z: P.state.z };
          press();
          T.advanceTime(1 / 60, 1 / 60);
          const started = T.summit.kitState().thrust.active;
          for (let i = 0; i < 60; i += 1) {
            T.advanceTime(1 / 60, 1 / 60);
            if (!T.summit.kitState().thrust.active) break;
          }
          T.setJetInput(false);
          const s = P.state;
          out[label] = {
            wasFlying: flying,
            started,
            casts: T.summit.kitState().thrust.casts,
            horizontal: Number(Math.hypot(s.x - from.x, s.z - from.z).toFixed(2)),
            reason: T.summit.kitState().thrust.lastReason,
          };
          T.advanceTime(2.0, 1 / 60);
        };
        // Right button: an edge on `ads`, exactly as the mouse makes it.
        await flyThenPress("rightClick", () => {
          P.input.state.ads = false;
          T.advanceTime(1 / 60, 1 / 60);
          P.input.state.ads = true;
        });
        P.input.state.ads = false;
        // The melee keybind: a real keydown, the way a keyboard makes it.
        await flyThenPress("meleeKey", () => {
          window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
          window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyF" }));
        });
        return out;
      });
      report.liveThrust = live;
      console.log("\nvigil stoop through real input, while flying:");
      for (const [k, v] of Object.entries(live)) {
        console.log(`   ${k.padEnd(11)} flying=${v.wasFlying} started=${v.started} casts=${v.casts} moved ${v.horizontal}m`);
      }
      check("stoop: right click fires it while flying",
        live.rightClick.wasFlying && live.rightClick.started
        && live.rightClick.horizontal >= 12, live.rightClick);
      check("stoop: the melee key fires it while flying",
        live.meleeKey.wasFlying && live.meleeKey.started
        && live.meleeKey.horizontal >= 12, live.meleeKey);

      /* THE STEP FOLLOWS THE RETICLE, NOT THE STICK. Aim 90 degrees
         off the body with a hard sideways stick held: the step must
         still go where the reticle points. */
      const step = await page.evaluate(() => {
        const T = window.__SF;
        const P = T.player;
        T.teleport(90, 900, 0);
        T.advanceTime(0.8, 1 / 60);
        T.summit.kitReset();
        const runs = {};
        for (const [label, aim, stick] of [
          ["aimEast", Math.PI * 0.5, { x: -1, y: 0 }],
          ["aimSouth", Math.PI, { x: 1, y: 0 }],
          ["aimNorthStickBack", 0, { x: 0, y: 1 }],
        ]) {
          P.state.aimViewYaw = aim;
          P.input.state.move.x = stick.x;
          P.input.state.move.y = stick.y;
          const from = { x: P.state.x, z: P.state.z };
          const ok = T.summit.blink();
          const dx = P.state.x - from.x;
          const dz = P.state.z - from.z;
          const bearing = Math.atan2(dx, dz);
          let err = bearing - aim;
          while (err > Math.PI) err -= Math.PI * 2;
          while (err < -Math.PI) err += Math.PI * 2;
          runs[label] = {
            ok,
            aimDeg: Number((aim * 180 / Math.PI).toFixed(1)),
            wentDeg: Number((bearing * 180 / Math.PI).toFixed(1)),
            errorDeg: Number(Math.abs(err * 180 / Math.PI).toFixed(1)),
            distance: Number(Math.hypot(dx, dz).toFixed(2)),
          };
          P.input.state.move.x = 0;
          P.input.state.move.y = 0;
          T.advanceTime(6.0, 1 / 60);
        }
        return runs;
      });
      report.blinkAim = step;
      console.log("\nvigil step, aim vs travel (stick held against it):");
      for (const [k, v] of Object.entries(step)) {
        console.log(`   ${k.padEnd(18)} aim ${v.aimDeg}deg -> went ${v.wentDeg}deg  (err ${v.errorDeg}deg, ${v.distance}m)`);
      }
      for (const [k, v] of Object.entries(step)) {
        check(`step: ${k} follows the reticle`, v.ok && v.errorDeg <= 2 && v.distance >= 8,
          { errorDeg: v.errorDeg, distance: v.distance });
      }

      /* THE STOOP MUST NOT BORROW THE FALL'S OVERHEAD RIG. Reported
         from play as "the VFX comes from overhead even if she is
         thrusting straight forward" - the trail call was the Fall's,
         whose column is authored straight up. Flown flat, through
         the real button, watching the column every frame. */
      const overhead = await page.evaluate(() => {
        const T = window.__SF;
        const P = T.player;
        T.teleport(90, 900, Math.PI);
        T.advanceTime(0.8, 1 / 60);
        T.summit.kitReset();
        T.setJetInput(true);
        T.advanceTime(1.4, 1 / 60);
        P.state.aimViewPitch = 0;
        P.state.aimViewYaw = P.state.yaw;
        P.input.state.ads = false;
        T.advanceTime(1 / 60, 1 / 60);
        P.input.state.ads = true;
        const col = T.vfx.group.getObjectByName("slam-column");
        const halo = T.vfx.group.getObjectByName("slam-halo");
        /* AND THE POSITIVE HALF. "The wrong effect is dark" passes
           just as well when NOTHING draws - which is exactly what
           shipped ("no VFX until ground impact"), because a tracer
           handed a travel speed of zero never crosses its own span.
           The tracer pool stamps a birth time per bolt; counting the
           recently-born ones proves the lance is actually being
           drawn. */
        const heads = T.vfx.group.getObjectByName("tracer-heads");
        const liveTracers = () => {
          if (!heads) return -1;
          const now = heads.material.uniforms.uTime.value;
          const birth = heads.geometry.attributes.aBirth.array;
          let n = 0;
          for (let i = 0; i < birth.length; i += 4) {
            if (birth[i] > now - 0.35) n += 1;
          }
          return n;
        };
        const before = liveTracers();
        let colLit = false;
        let haloLit = false;
        let frames = 0;
        let peakTracers = 0;
        for (let i = 0; i < 70; i += 1) {
          T.advanceTime(1 / 60, 1 / 60);
          if (col && col.visible) colLit = true;
          if (halo && halo.visible) haloLit = true;
          if (T.summit.kitState().thrust.active) {
            frames += 1;
            peakTracers = Math.max(peakTracers, liveTracers());
          }
        }
        P.input.state.ads = false;
        T.setJetInput(false);
        return {
          found: !!col, colLit, haloLit, thrustFrames: frames,
          tracersBefore: before, peakTracers,
        };
      });
      report.stoopOverhead = overhead;
      check("stoop: no overhead column on a flat thrust",
        overhead.found && overhead.thrustFrames > 10
        && !overhead.colLit && !overhead.haloLit, {
        colLit: overhead.colLit, haloLit: overhead.haloLit,
        thrustFrames: overhead.thrustFrames,
      });
      check("stoop: the lance actually draws",
        overhead.peakTracers >= 5 && overhead.tracersBefore <= 1,
        { before: overhead.tracersBefore, peak: overhead.peakTracers });

      if (errors.length) console.log("vigil pageErrors:", errors.slice(0, 3));
      await context.close();
    }
  } finally {
    await browser?.close();
    child.kill();
  }

  await writeFile(path.join(outDir, "mobility.json"),
    JSON.stringify({ ...report, checks }, null, 2));
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  console.log(`report: ${path.join(outDir, "mobility.json")}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
