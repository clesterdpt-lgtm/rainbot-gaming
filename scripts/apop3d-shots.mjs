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
/* ON by default: the review pool must contain a character.
   camera.js solves WHERE the camera goes relative to the subject, but
   nothing moves the subject, so without this every default capture is
   an empty room - and "no character in frame" has been the losing
   verdict in every blind review so far.
   This was briefly disabled after it relocated whole captures onto the
   building's roof. That turned out to be the same trap camera.js hit:
   groundAt returns the first UP-FACING surface below the probe, and
   the top of a ceiling slab is up-facing, so probing from above the
   roof grounds you on the roof. The probe below starts just above the
   player instead and rejects any surface well above her.
   --no-subject captures the bare level. */
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

      /* Put the subject in the shot.
         Two rounds of blind comparison against real Super Mario 64
         frames returned the same verdict for the same reason: our
         panels were characterless. That is not a rendering gap, it is
         a framing one - the capture presets aim at level features and
         the player is left wherever she spawned, usually off screen.
         Mario is in essentially every real SM64 screenshot, and a
         frame with no subject has no focal hierarchy to judge.
         So after the camera is posed, the player is moved to the
         ground under the point the camera is actually looking at. */
      if (PLACE_SUBJECT) {
        await page.evaluate(() => {
          const q = window.__APOP3D;
          const ctx = window.__APOP3D_CTX;
          if (!q || !ctx || !ctx.camera) return;
          const THREE = ctx.THREE;
          const dir = new THREE.Vector3();
          ctx.camera.getWorldDirection(dir);
          const from = ctx.camera.position.clone();
          // Aim a little ahead of the camera, then drop onto the floor.
          const target = from.clone().add(dir.multiplyScalar(7.5));

          /* Drop onto the floor the player is ALREADY on, not simply
             the first surface under the camera's aim point.
             These courses have roofs. Aiming a preset upward or across
             a building and dropping from the aim point lands on the
             roof slab, and the whole capture silently relocates to a
             bare rooftop - which is exactly what happened: two food
             court presets came back as an empty white roof.
             So probe from just above her current height first, and
             only fall back to the aim point if there is nothing there. */
          const cur = ctx.player?.position;
          const startY = cur ? cur.y + 3 : target.y + 6;
          let hit = ctx.collision?.groundAt?.(target.x, target.z, startY, 12);
          if (!hit) hit = ctx.collision?.groundAt?.(target.x, target.z, target.y + 6, 40);
          /* Reject a surface OUTSIDE the course, not merely above her.
             This used to be `hit.y > cur.y + 4`, which was aimed at the
             building's roof but also blocked every legitimate raised
             vantage - a mezzanine or terrace more than ~4.4 m up left
             her behind while camera.js composed and *verified* a frame
             around a point she never reached, committing a capture with
             no character in it. Worse than a skip.
             The real distinction is inside-the-course versus on top of
             it, so test the course bounds. camera.js separately
             verifies she is visible and refuses if not, which is the
             backstop that makes this safe to relax. */
          const b = ctx.world?.current?.bounds;
          if (hit && b && Array.isArray(b.max) && hit.y > b.max[1] - 1.5) hit = null;
          if (!hit) return;   // leave her where she is rather than relocate the shot
          /* Face the camera, so the silhouette reads rather than
             showing the back of her head in every frame.
             This must go through player.teleport's yaw argument.
             It previously called `player.setYaw`, which does not exist
             - the optional chain silently no-opped - and then wrote
             rig.root.rotation.y directly, which player.update()
             overwrites on the very next step. The whole face-the-camera
             step was doing nothing. */
          const yaw = Math.atan2(from.x - target.x, from.z - target.z);
          if (typeof ctx.player?.teleport === "function") {
            ctx.player.teleport(target.x, hit.y + 0.05, target.z, yaw);
          } else {
            q.teleport?.(target.x, hit.y + 0.05, target.z);
          }
        });
        await page.evaluate(() => window.__APOP3D?.advance?.(0.45));

        /* Re-pose after moving the subject, and RESPECT THE ANSWER.
           This return used to be discarded. camera.js verifies a solved
           pose before committing - subject scale, both sight lines,
           composition - and can legitimately refuse once the subject
           has moved. Ignoring that wrote a PNG from the stale earlier
           pose, so a frame the camera had explicitly rejected entered
           the blind review as a normal capture. */
        const reposed = await page.evaluate((name) => {
          const q = window.__APOP3D;
          if (!q || typeof q.setCamera !== "function") return true;
          return q.setCamera(name) !== false;
        }, preset);
        if (!reposed) {
          const why = await page.evaluate(() => {
            const rig = window.__APOP3D_CTX?.cameraRig;
            return (rig && rig.getState && rig.getState().presetWhy) || "camera refused after subject placement";
          });
          diagnostics.shots.push({ preset, skipped: why });
          process.stdout.write(`  skipped ${preset} (${why})\n`);
          continue;
        }
      }

      // Let the pose settle, then force the exact frame we want.
      await page.evaluate(() => window.__APOP3D?.advance?.(0.2));
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
        if (!ctx.vfx || typeof ctx.vfx.removeShadow !== "function") return null;
        /* The caster is registered against whichever object CARRIES the
           declaration, and character.js puts `userData.contactShadow`
           on the SkinnedMesh, not on the rig group - vfx scans meshes.
           Passing the group here matched nothing and left her shadow
           in the control frame. Walk the subtree and remove every
           declared caster under her. */
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
      if (hid === null) {
        throw new Error(
          "vfx.setContactShadows is missing, so the subject-hidden control frame "
          + "would still contain the player's contact shadow. Refusing to write a "
          + "control that does not control."
        );
      }
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
      }
      const stats = await page.evaluate(() => window.__APOP3D?.stats?.() || null);
      diagnostics.shots.push({
        preset, file: path.relative(root, file), bytes: buf.length,
        blank: looksBlank(buf), stats,
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
