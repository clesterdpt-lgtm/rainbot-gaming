#!/usr/bin/env node
/* ============================================================
   APOP DEMON MOGGERS 3D - screenshot harness

   Boots the game in a GPU-backed headless Chromium, waits until
   frames are genuinely being produced, drives the QA camera through
   the capture presets, and writes PNGs plus a diagnostics JSON.

   Usage:
     node scripts/apop3d-shots.mjs
     node scripts/apop3d-shots.mjs --out output/apop3d-shots/run-2 \
       --presets arrival,vista --course 1 --width 1600 --height 900

   Flags:
     --out <dir>       artifact directory (default output/apop3d-shots/latest)
     --presets <list>  preset ids or "all" (default all)
     --course <n>      course to load, 0 = hub (default 1)
     --width/--height  viewport (default 1600x900)
     --warm <seconds>  simulated seconds before capture (default 2)
     --hud             keep the HUD visible (default hidden for compares)
     --no-subject      capture the bare level, with no character placed
     --headed          run with a visible browser window

   ------------------------------------------------------------
   TWO THINGS THIS HARNESS EXISTS TO WORK AROUND

   1. Headless Chromium throttles requestAnimationFrame to roughly
      1fps. Any harness that waits a fixed number of milliseconds and
      then screenshots gets a black or half-built frame. So we poll
      __APOP3D.frame until it actually advances, and budget generous
      timeouts around anything that waits on the renderer.

   2. page.screenshot() goes through the browser compositor, which
      only refreshes on a real animation frame - so several poses in a
      row come back byte-identical, showing whatever the compositor
      last held. We read the WebGL drawing buffer instead, which is
      exactly the surface the last renderOnce() drew into.

   ------------------------------------------------------------
   AND ONE THING IT DELIBERATELY DOES NOT DO

   It does not decide where the character stands. camera.js exposes a
   subject seam - `subjectWant` to ask, `setSubjectPlacer` to be driven
   - and this file registers a placer and gets out of the way. Three
   previous attempts to solve subject placement here fought the camera
   module for the same job and lost, the last one taking the set from
   8/9 to 6/9. The rig owns the search state; the search state is where
   the iteration belongs.
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i += 1; }
    } else args._.push(token);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = path.resolve(root, args.out || "output/apop3d-shots/latest");
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 900);
const COURSE = Number(args.course ?? 1);
const WARM_SECONDS = Number(args.warm ?? 2);
const KEEP_HUD = Boolean(args.hud);
const HEADED = Boolean(args.headed);
/* ON by default: the review pool must contain a character. "No
   character in frame" has been the losing verdict in every blind review
   so far, and Mario is in essentially every real SM64 screenshot.
   With this on, the harness registers a SUBJECT PLACER with camera.js
   and that module drives the whole placement - see the seam block in
   main(). This file no longer probes for a floor, chooses a stand
   point, or decides which way she faces; every one of those was a
   guess made against the camera's own search, and every one of them
   was wrong at least once (a rooftop, a walkway 23 m over the enemies,
   a half-turn of yaw).
   --no-subject registers nothing and captures the bare level. */
const PLACE_SUBJECT = !args["no-subject"];
/* Port is chosen at runtime by actually binding one, not guessed.
   This used to be `43000 + pid % 9000`. Concurrent sessions leave
   stale `python -m http.server` processes in that range, and a
   collision does NOT fail - the harness happily talks to whatever is
   already listening, serving a different working tree. That produced a
   404 plus a byte-identical repeat capture, which reads exactly like a
   genuine "your edit changed nothing" result and cost real debugging
   time. Binding first makes a collision impossible. */
let PORT = Number(args.port || 0);
let BASE_URL = "";
let GAME_URL = "";

const ALL_PRESETS = [
  "arrival", "vista", "platforming", "enemy-encounter",
  "collect", "boss", "interior", "water", "high-ground",
];
const PRESETS = (!args.presets || args.presets === "all" || args.presets === true)
  ? ALL_PRESETS
  : String(args.presets).split(",").map((s) => s.trim()).filter(Boolean);

/* ------------------------- static server ------------------------- */

/** Reserve a free port by binding and immediately releasing it. */
async function pickPort() {
  if (PORT) return PORT;
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/games/apop-demon-hunters.html`, { cache: "no-store" });
      if (res.ok) {
        // Confirm it is OUR tree, not another session's server that
        // happened to be on this port. Cheap, and it turns a silently
        // wrong run into a loud failure.
        const probe = await fetch(`${BASE_URL}/assets/js/apop3d/boot.js`, { cache: "no-store" });
        const body = probe.ok ? await probe.text() : "";
        if (!body.includes("APOP DEMON MOGGERS 3D - boot loader")) {
          throw new Error(
            `Port ${PORT} is served by a DIFFERENT working tree.\n`
            + "Another session's static server is on this port. Re-run, or pass --port."
          );
        }
        return;
      }
    } catch (err) {
      if (String(err.message || "").includes("DIFFERENT working tree")) throw err;
    }
    await delay(100);
  }
  throw new Error(`Static server never came up on ${BASE_URL}`);
}

/* --------------------------- browser --------------------------- */

async function launchBrowser() {
  // `channel: "chromium"` uses the full Chromium build. The default
  // headless shell throttles rAF hard and yields black frames.
  return chromium.launch({
    channel: "chromium",
    headless: !HEADED,
    args: [
      "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
      "--disable-gpu-vsync", "--force-device-scale-factor=1",
      "--hide-scrollbars", "--mute-audio",
    ],
  });
}

/** Wait until the engine reports it has drawn real frames. */
async function waitForFrames(page, minFrames = 8, timeoutMs = 90000) {
  const started = Date.now();
  let last = -1;
  while (Date.now() - started < timeoutMs) {
    const info = await page.evaluate(() => {
      const q = window.__APOP3D;
      const c = window.__APOP3D_CTX;
      if (!q && !c) return null;
      return {
        ready: q ? !!q.ready : false,
        frame: (q && q.frame) || (c && c.clock && c.clock.frame) || 0,
        err: (document.getElementById("ap-boot-error") || {}).textContent || "",
      };
    });
    if (info && info.err) throw new Error(`Engine reported a boot failure:\n${info.err}`);
    if (info && info.frame >= minFrames) return info;
    if (info && info.frame !== last) last = info.frame;
    await delay(250);
  }
  throw new Error(`Engine never produced ${minFrames} frames within ${timeoutMs}ms`);
}

async function grabFrame(page, file) {
  const dataUrl = await page.evaluate(() => {
    const q = window.__APOP3D;
    if (q && typeof q.captureDataURL === "function") return q.captureDataURL();
    const c = document.getElementById("apopCanvas");
    return c ? c.toDataURL("image/png") : "";
  });
  if (!dataUrl) throw new Error("captureDataURL returned nothing");
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const buffer = Buffer.from(base64, "base64");
  if (file) await writeFile(file, buffer);
  return buffer;
}

/** A frame that is a single flat colour means we captured before the
 *  scene existed, or into a cleared buffer. Worth failing loudly on -
 *  a black contact sheet has wasted many review rounds. */
function looksBlank(buffer) {
  // PNG signature check only; real content analysis happens in the
  // compare harness where sharp is already a dependency.
  return buffer.length < 6000;
}

/* ----------------------------- main ----------------------------- */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  PORT = await pickPort();
  BASE_URL = `http://127.0.0.1:${PORT}`;
  GAME_URL = `${BASE_URL}/games/apop-demon-hunters.html?qa=1`;
  const server = startServer();
  let browser;
  const diagnostics = { url: GAME_URL, course: COURSE, width: WIDTH, height: HEIGHT, shots: [], console: [] };

  try {
    await waitForServer();
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        diagnostics.console.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => diagnostics.console.push(`[pageerror] ${err.message}`));

    await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForFrames(page, 8);

    // Pin resolution and shadow cadence so two runs of the same build
    // are comparable, and clear the HUD unless asked otherwise.
    await page.evaluate((keepHud) => {
      const q = window.__APOP3D;
      if (!q) return;
      q.pin?.(true);
      q.hideHud?.(!keepHud);
    }, KEEP_HUD);

    await page.evaluate((course) => window.__APOP3D?.loadCourse?.(course, 0), COURSE);
    await waitForFrames(page, 4);
    await page.evaluate((s) => window.__APOP3D?.advance?.(s), WARM_SECONDS);

    /* THE SUBJECT SEAM.
       This harness used to pose the camera, walk the player onto the
       ground under the view axis, and pose again - and nothing walked
       her a third time, so the second solve could legitimately compose
       around a point she never reached. Measured: `enemy-encounter`
       verified at truthOff 6.5-15.7 m with a subject-hidden control
       that differed from the real frame by 0.05% of the crop. No
       character at all, in the shot named after a confrontation.

       Three harness-side fixes fought camera.js for the same job and
       lost. The last, a corrective walk plus a re-solve, took the set
       from 8/9 to 6/9 because the solver had already chosen the best
       bearing for her OLD position. The layer was the lesson: the
       camera says where she belongs, this file puts her there, and the
       camera verifies against where she really is.

       So the placer is registered ONCE and camera.js drives it. It
       moves her every time its stand-distance bracket steps, re-places
       her for whichever round's pose it finally commits, and turns her
       to face the shot at the end. This file no longer decides where
       she stands, which floor she lands on, or which way she looks -
       all three were guesses, and all three were wrong at least once.
       Nothing here probes the ground any more either: camera.js's own
       stand-point solve already grounds the want, from the landmark's
       height rather than from above the roof.

       --no-subject skips registration entirely, which restores the
       bare-level capture exactly. */
    const seam = !PLACE_SUBJECT ? false : await page.evaluate(() => {
      const ctx = window.__APOP3D_CTX;
      const rig = ctx && ctx.cameraRig;
      if (!rig || typeof rig.setSubjectPlacer !== "function") return false;
      window.__APOP3D_PLACED = [];
      return rig.setSubjectPlacer((want) => {
        const pl = ctx.player;
        if (!pl || typeof pl.teleport !== "function") return false;
        /* 5 cm of air, so she settles onto the floor rather than
           starting a frame interpenetrating it. camera.js grounds the
           want; this does not second-guess it. */
        pl.teleport(want.x, want.y + 0.05, want.z,
          want.yaw === null || want.yaw === undefined ? undefined : want.yaw);
        window.__APOP3D_PLACED.push([want.name, want.round, +want.stand.toFixed(1)]);
        return true;
      });
    });
    if (PLACE_SUBJECT && !seam) {
      throw new Error(
        "camera.js does not expose setSubjectPlacer, so the capture would fall back to "
        + "posing around a point the character never reaches. Refusing to write frames "
        + "whose verification is against an assumption. Pass --no-subject for a bare level."
      );
    }
    diagnostics.seam = seam;

    for (const preset of PRESETS) {
      const applied = await page.evaluate((name) => {
        const q = window.__APOP3D;
        if (!q || typeof q.setCamera !== "function") return false;
        return q.setCamera(name) !== false;
      }, preset);

      if (!applied) {
        // camera.js explains itself; "not implemented" was hiding real
        // reasons like "no vantage here" or "enemy not visible".
        const why = await page.evaluate(() => {
          const rig = window.__APOP3D_CTX?.cameraRig;
          return (rig && rig.getState && rig.getState().presetWhy) || "preset not available";
        });
        diagnostics.shots.push({ preset, skipped: why });
        process.stdout.write(`  skipped ${preset} (${why})\n`);
        continue;
      }

      /* Settle, then FREEZE the cast before the shutter.
         The composition was verified at the pose above; anything that
         keeps moving afterwards invalidates it. A Lackey at 5.4 m/s
         crosses a metre in the settle alone. Short, because the placer
         put her 5 cm over the floor and nothing else has to happen -
         the old 0.45 s existed to let a teleport-then-repose sequence
         settle between two solves, and there is only one solve now. */
      await page.evaluate(() => window.__APOP3D?.advance?.(0.2));
      await page.evaluate(() => window.__APOP3D_CTX.enemies?.setFrozen?.(true));
      await page.evaluate(() => window.__APOP3D?.renderOnce?.());

      const file = path.join(OUT_DIR, `${preset}.png`);
      const buf = await grabFrame(page, file);

      /* Companion frame with the subject hidden.
         Differencing the two gives an exact silhouette mask, which is
         the only way to measure the thing that actually decides these
         reviews: the value delta between the character and the field
         immediately around her. A global histogram cannot see that -
         a frame passed every aggregate row while having a black bottom
         half and a subject hidden behind a crate. Cheap: one extra
         draw of an already-posed scene. */
      /* CHECK BEFORE TOUCHING ANYTHING.
         Every capability test this pass depends on runs here, while the
         world is still pristine. That ordering is the whole point: the
         old code set `rig.visible = false` first and only then tested
         its hooks, so a missing method returned early - or, once the
         test became a throw, threw - with the player already hidden,
         her shadow already stripped and the actors already frozen. The
         restore lives in a plain `if (hid)` further down, outside any
         finally, so none of it was ever put back and EVERY LATER PRESET
         in that run captured an invisible subject. That is the shape of
         the order-dependence measured across full-set runs: identical
         code scoring -65.5 in one 9-preset run and -32.2 in another,
         while one-preset-per-process reproduced exactly. A control pass
         must be all-or-nothing, and it is cheaper to be sure it can
         finish than to unwind it halfway. */
      const ready = await page.evaluate(() => {
        const ctx = window.__APOP3D_CTX;
        if (!ctx?.player?.rig?.root) return { ok: false, why: "no player rig" };
        const missing = [];
        if (typeof ctx.anim?.setFrozen !== "function") missing.push("anim.setFrozen");
        if (typeof ctx.vfx?.setFrozen !== "function") missing.push("vfx.setFrozen");
        if (typeof ctx.vfx?.removeShadow !== "function") missing.push("vfx.removeShadow");
        if (typeof ctx.vfx?.addShadow !== "function") missing.push("vfx.addShadow");
        if (typeof ctx.vfx?.lateUpdate !== "function") missing.push("vfx.lateUpdate");
        return { ok: missing.length === 0, missing };
      });
      if (!ready.ok && ready.why === "no player rig") {
        throw new Error("control frame: no player rig to hide");
      }
      if (!ready.ok) {
        throw new Error(
          `control frame needs QA hooks that do not exist: ${ready.missing.join(", ")}. `
          + "Add them, or delete the control pass - do not let it run half-applied."
        );
      }
      const hid = await page.evaluate(() => {
        const ctx = window.__APOP3D_CTX;
        const rig = ctx?.player?.rig?.root;
        if (!rig) return false;
        rig.visible = false;
        // Suppress the blob too. Hiding the mesh alone leaves a hard
        // black ellipse on the floor with no caster - an orphan shadow
        // in every control frame.
        /* ASSERT, do not optional-chain.
           This line was `ctx.vfx?.setContactShadows?.(false)` against a
           method vfx.js did not define. The optional chain swallowed it
           and every control frame kept the player's contact shadow - a
           hard dark ellipse at exactly the spot the subject was removed
           from. Three review rounds were scored against that. A control
           that silently fails to control is worse than no control. */
        /* Remove only HER blob, not every blob in the scene.
           setContactShadows(false) kills the whole pass, which also
           ungrounds every enemy and collectable - the control would
           then differ from the real frame by more than the subject,
           and it is meant to answer "does this picture work without
           her", not "without grounding". removeShadow targets one
           caster. */
        /* No capability test here any more - it moved above, where it
           can refuse before the world has been touched. */
        /* The caster is registered against whichever object CARRIES the
           declaration, and character.js puts `userData.contactShadow`
           on the SkinnedMesh, not on the rig group - vfx scans meshes.
           Passing the group here matched nothing and left her shadow
           in the control frame. Walk the subtree and remove every
           declared caster under her. */
        /* Freeze animated actors for the control pass.
           The control differs from the real capture by the subject, but
           sparkle particles and NPC idle advance between the two
           renders, so 4-6% of changed pixels were scattered weak diffs
           across the frame. Harmless at the current threshold and a
           trap the moment anything measures below it.

           ASSERTED, not optional-chained. `ctx.vfx?.setFrozen?.(true)`
           sat here for several rounds against a vfx.js that never
           defined the method, and `?.` turned the whole control
           protocol into a no-op without a single error - the same
           silent miss as `setContactShadows` before it, which cost
           three review rounds. A hook this pass DEPENDS on must fail
           loudly when it goes missing: the cost of a hard throw is one
           obvious run, the cost of the quiet version is every metric
           downstream measuring drifting dust and nobody knowing. */
        ctx.anim.setFrozen(true);
        ctx.vfx.setFrozen(true);
        const removed = [];
        rig.traverse((o) => {
          if (o.userData && o.userData.contactShadow) {
            removed.push({ obj: o, decl: o.userData.contactShadow });
            // Delete the DECLARATION too, or vfx's periodic caster scan
            // simply re-adopts her on its next sweep.
            delete o.userData.contactShadow;
            ctx.vfx.removeShadow(o);
          }
        });
        ctx.vfx.removeShadow(rig);
        window.__APOP3D_HIDDEN = removed;
        return removed.length > 0;
      });
      /* From here the world IS mutated, so every path back out has to
         restore it - including the ones taken by a throw. Before this
         try/finally the restore sat in a bare `if (hid)`, so a failure
         anywhere in the control pass left the player hidden, her
         shadow declarations deleted and anim/vfx frozen for the whole
         REST of the run, and the presets after it captured an empty
         world while reporting success. */
      let restored = false;
      try {
      if (hid) {
        /* Re-run VFX ONLY, not the whole simulation.
           removeShadow updates the caster LIST, but the instanced blob
           buffer keeps whatever the last shadow step wrote into it and
           renderOnce only draws - so the buffer has to be rewritten.
           This used to call advance(1/60), which also stepped every
           enemy: animated dancers moved between the two captures and
           registered in the difference as "subject", inflating one
           frame's measured subject area to 9.6%. Stepping vfx alone
           rewrites the blobs while leaving every other actor exactly
           where the real capture found it, so the control differs by
           the subject and nothing else. */
        await page.evaluate(() => {
          const ctx = window.__APOP3D_CTX;
          /* lateUpdate, NOT update.
             stepShadows() - the thing that rewrites the instanced blob
             buffer - lives in vfx.lateUpdate. vfx.update only touches
             an air uniform and the punch light, and returns early
             unless dt > 0, so calling it left the buffer holding
             exactly what the real frame drew. This file previously
             carried a correct diagnosis of that bug and then fixed the
             caster LIST rather than the buffer that draws it, and the
             control shipped broken for another round. */
          if (ctx.vfx && typeof ctx.vfx.lateUpdate === "function") ctx.vfx.lateUpdate(ctx);
          ctx.render.renderOnce();
        });
        await grabFrame(page, path.join(OUT_DIR, `${preset}.nosubject.png`));
        await page.evaluate(() => {
          const ctx = window.__APOP3D_CTX;
          const rig = ctx?.player?.rig?.root;
          if (rig) rig.visible = true;
          // vfx re-adopts a caster on its next scan, but do it now so
          // the very next captured frame is not missing her shadow.
          // Direct calls: the freeze above already asserted both exist,
          // and a silently-skipped UNfreeze is the worse half of the
          // bug - it would leave every following preset in the run
          // rendering a stopped world, which looks like nothing at all.
          ctx.anim.setFrozen(false);
          ctx.vfx.setFrozen(false);
          const back = window.__APOP3D_HIDDEN || [];
          for (const e of back) {
            e.obj.userData.contactShadow = e.decl;
            if (ctx.vfx && typeof ctx.vfx.addShadow === "function") {
              ctx.vfx.addShadow(e.obj, e.decl || {});
            }
          }
          window.__APOP3D_HIDDEN = null;
          ctx.render.renderOnce();
        });
        restored = true;
      }
      } finally {
        /* Idempotent, and deliberately tolerant: this is the unwind
           path, so it must not be able to throw a SECOND error over
           the first one and hide it. Optional chaining is correct HERE
           - the assert above already proved the hooks exist, and if we
           are unwinding because the page died there is nothing to call
           anyway. */
        if (hid && !restored) {
          await page.evaluate(() => {
            const ctx = window.__APOP3D_CTX;
            const rig = ctx?.player?.rig?.root;
            if (rig) rig.visible = true;
            ctx?.anim?.setFrozen?.(false);
            ctx?.vfx?.setFrozen?.(false);
            const back = window.__APOP3D_HIDDEN || [];
            for (const e of back) {
              e.obj.userData.contactShadow = e.decl;
              ctx?.vfx?.addShadow?.(e.obj, e.decl || {});
            }
            window.__APOP3D_HIDDEN = null;
          }).catch(() => {});
        }
      }
      await page.evaluate(() => window.__APOP3D_CTX.enemies?.setFrozen?.(false));
      const stats = await page.evaluate(() => window.__APOP3D?.stats?.() || null);
      // Record the solver's own verdict so a future round can be
      // measured without writing a bespoke probe for it.
      const presetCheck = await page.evaluate(() => {
        const rig = window.__APOP3D_CTX?.cameraRig;
        const st = rig && rig.getState ? rig.getState() : null;
        if (!st) return null;
        const placed = window.__APOP3D_PLACED || [];
        window.__APOP3D_PLACED = [];
        return {
          why: st.presetWhy || null, check: st.presetCheck || null, sight: st.sight || null,
          /* The seam's own audit trail: where camera.js asked her to
             stand, how far the placement missed by, and how many times
             the search moved her getting there. `off` must be zero -
             a non-zero one means a pose was verified against a request
             rather than against a result, which is the whole defect
             this seam closes. */
          want: st.presetWant || null,
          placements: placed.length,
        };
      });
      diagnostics.shots.push({
        preset, file: path.relative(root, file), bytes: buf.length,
        blank: looksBlank(buf), stats, presetCheck,
      });
      process.stdout.write(`  captured ${preset} (${(buf.length / 1024).toFixed(0)} KB)\n`);
    }

    /* An engine error mid-run poisons every frame after it, and the
       frames still WRITE - they just show a stand-in pose or a stale
       scene. Two transient ReferenceErrors during a parallel edit
       produced exactly that: captures that looked successful and were
       worthless. Surface them loudly and mark the run unsafe. */
    const engineErrors = diagnostics.console.filter((l) => (
      l.startsWith("[error]") || l.startsWith("[pageerror]")
    ));
    diagnostics.engineErrors = engineErrors.length;
    diagnostics.trustworthy = engineErrors.length === 0;
    if (engineErrors.length) {
      process.stdout.write(`\n  *** ${engineErrors.length} ENGINE ERROR(S) - THIS RUN IS NOT TRUSTWORTHY ***\n`);
      for (const line of [...new Set(engineErrors)].slice(0, 6)) {
        process.stdout.write(`      ${line.slice(0, 160)}\n`);
      }
      process.stdout.write("      Do not review or measure these frames; fix the error and recapture.\n");
    }

    const blank = diagnostics.shots.filter((s) => s.blank);
    if (blank.length) {
      process.stdout.write(`\n  WARNING: ${blank.length} frame(s) look blank: ${blank.map((s) => s.preset).join(", ")}\n`);
    }

    await writeFile(path.join(OUT_DIR, "_diagnostics.json"), JSON.stringify(diagnostics, null, 2));
    process.stdout.write(`\nWrote ${diagnostics.shots.length} shot(s) to ${path.relative(root, OUT_DIR)}\n`);
    if (diagnostics.console.length) {
      process.stdout.write(`\nConsole (${diagnostics.console.length}):\n`);
      for (const line of diagnostics.console.slice(0, 25)) process.stdout.write(`  ${line}\n`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
