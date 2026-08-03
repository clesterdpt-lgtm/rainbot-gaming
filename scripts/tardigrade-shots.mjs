#!/usr/bin/env node
/* ============================================================
   Tardigrade Simulator - screenshot harness

   Boots the game in a real (GPU-backed) headless Chromium, waits
   until frames are genuinely being produced, drives the QA camera
   through a set of poses, and writes PNGs plus a diagnostics JSON.

   Usage:
     node scripts/tardigrade-shots.mjs
     node scripts/tardigrade-shots.mjs --out output/shots/run-3 \
       --poses establishing,hero-closeup --width 1920 --height 1080 \
       --warm 4 --quality ultra

   Flags:
     --out <dir>       artifact directory (default output/tardigrade-shots/latest)
     --poses <a,b,c>   pose ids, or "all" (default all)
     --width/--height  viewport (default 1600x900)
     --quality <tier>  low|medium|high|ultra (default ultra)
     --warm <seconds>  simulated seconds before capture (default 3)
     --hud             keep the HUD visible (default hidden)
     --headed          run with a visible browser window
     --port <n>        static server port
     --action          also capture gameplay-in-motion shots (run, jump,
                       curl, grapple, ragdoll) from a chase camera
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------------------- args ---------------------------- */
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
const OUT_DIR = path.resolve(root, args.out || "output/tardigrade-shots/latest");
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 900);
const QUALITY = String(args.quality || "ultra");
const WARM_SECONDS = Number(args.warm ?? 3);
const KEEP_HUD = Boolean(args.hud);
const HEADED = Boolean(args.headed);
const PORT = Number(args.port || 41000 + (process.pid % 12000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE_URL}/games/tardigrade-simulator.html?qa=1&quality=${QUALITY}`;

/* ------------------------- static server ------------------------- */
function startServer() {
  const child = spawn("/opt/homebrew/bin/python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/games/tardigrade-simulator.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`Static server never came up on ${BASE_URL}`);
}

/* --------------------------- browser --------------------------- */
async function launchBrowser() {
  // `channel: "chromium"` uses the full Chromium build rather than the
  // headless shell, which throttles requestAnimationFrame to ~1fps and
  // yields black screenshots.
  return chromium.launch({
    channel: "chromium",
    headless: !HEADED,
    args: [
      "--use-angle=default",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader",
      "--disable-frame-rate-limit",
      "--disable-gpu-vsync",
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--mute-audio",
    ],
  });
}

/**
 * Frames only advance when the compositor actually runs. Poll the
 * game's own frame counter rather than trusting a fixed wait.
 */
async function waitForFrames(page, minFrames = 12, timeoutMs = 45000) {
  const started = Date.now();
  let last = -1;
  let stagnant = 0;
  while (Date.now() - started < timeoutMs) {
    const frame = await page.evaluate(() => (window.__TSIM ? window.__TSIM.report().frame : -1));
    if (frame >= minFrames) return frame;
    if (frame === last) stagnant += 1;
    else stagnant = 0;
    last = frame;
    if (stagnant > 40) {
      // rAF is throttled; force frames synchronously instead.
      await page.evaluate(() => window.__TSIM && window.__TSIM.advanceTime(0.25));
    }
    await delay(120);
  }
  throw new Error(`Only reached frame ${last} (needed ${minFrames}) - the renderer never produced frames`);
}

/* ------------------------ image analysis ------------------------ */
/**
 * Objective checks so a broken frame cannot be signed off as "looks good".
 * Catches the classic failures: black frame, blown-out frame, flat frame.
 */
async function analyseImage(file) {
  const image = sharp(file).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const pixels = data.length / info.channels;

  let sum = 0;
  let sumSq = 0;
  let clippedHigh = 0;
  let clippedLow = 0;
  let colourfulness = 0;
  const histogram = new Uint32Array(32);

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    sum += luma;
    sumSq += luma * luma;
    if (luma >= 253) clippedHigh += 1;
    if (luma <= 2) clippedLow += 1;
    colourfulness += Math.max(r, g, b) - Math.min(r, g, b);
    histogram[Math.min(31, luma >> 3)] += 1;
  }

  const mean = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - mean * mean);
  const usedBuckets = histogram.reduce((n, v) => n + (v > pixels * 0.0004 ? 1 : 0), 0);

  const metrics = {
    meanLuma: Number(mean.toFixed(2)),
    stdDevLuma: Number(Math.sqrt(variance).toFixed(2)),
    clippedHighPct: Number(((clippedHigh / pixels) * 100).toFixed(3)),
    clippedLowPct: Number(((clippedLow / pixels) * 100).toFixed(3)),
    saturation: Number((colourfulness / pixels).toFixed(2)),
    tonalRange: usedBuckets,
  };

  const warnings = [];
  if (metrics.meanLuma < 12) warnings.push("frame is almost black - did the scene render?");
  if (metrics.meanLuma > 225) warnings.push("frame is almost white - exposure is blown out");
  if (metrics.stdDevLuma < 12) warnings.push("almost no tonal contrast - the frame is flat");
  if (metrics.clippedHighPct > 12) warnings.push(`${metrics.clippedHighPct}% of pixels are clipped white - lower exposure`);
  if (metrics.clippedLowPct > 20) warnings.push(`${metrics.clippedLowPct}% of pixels are crushed black - lift the shadows`);
  if (metrics.tonalRange < 8) warnings.push("very narrow tonal range - the histogram is bunched up");
  if (metrics.saturation < 8) warnings.push("nearly monochrome - the grade has drained the colour");

  // NOTE: there is deliberately no "camera is inside/below geometry" image
  // check here. One was written and tested against a frame known to have
  // that exact fault (a pose search dropped the puddle camera under the
  // water plane) and it did not fire: measured against good frames, the
  // broken one sat inside the normal range on every statistic - dark
  // fraction 9.0% against grass-interior's 17.6%, bottom-half darkness 6.5%
  // against backlit's 10.3%, bimodality 18%/44%. The fault is SEMANTIC, not
  // statistical, and the image carries no signature of it. The guard that
  // works is geometric and lives in the pose search: a candidate camera must
  // sit above world.heightAt(x, z). Do not re-add a histogram heuristic here
  // expecting it to catch this.

  return { metrics, warnings };
}

/* ----------------------------- run ----------------------------- */
async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const server = startServer();
  let browser = null;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    await waitForServer();
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    const page = await context.newPage();

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for the engine to publish its QA hooks.
    await page.waitForFunction(() => window.__TSIM && window.__TSIM.isReady(), null, { timeout: 90000 });
    await waitForFrames(page, 10);

    if (!KEEP_HUD) await page.evaluate(() => window.__TSIM.hideHud(true));

    // Belt and braces: the boot overlay is opaque and fades on a timer, so
    // remove it unconditionally before any capture.
    await page.evaluate(() => {
      const bootEl = document.getElementById("ts-boot");
      if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
    });

    // Let the world settle: physics, foliage, particles, adaptive res.
    await page.evaluate((seconds) => window.__TSIM.advanceTime(seconds), WARM_SECONDS);
    await waitForFrames(page, 30);

    // Hero-relative poses need the hero somewhere a camera can actually see
    // it. The spawn point sits in grass taller than the hero, and it drifts
    // further while the world settles, so stand it on the open patio and
    // pick whichever nearby spot has the most room around it.
    await page.evaluate(() => {
      const world = window.__TSIM_CTX.world;
      if (!world || typeof world.heightAt !== "function") return;

      // Stand the hero where a human-scale landmark falls behind it. Empty
      // patio makes the hero shots read as "a normal-sized animal on a cracked
      // dry lakebed" - a blind reviewer scored sense of scale 4/10 and said
      // the collapse happens "in exactly the two shots that carry the game".
      // The whole micro-world premise depends on something recognisably
      // human-sized being enormous in the same frame as the animal.
      //
      // Bottle cap sits at (-158,-166) r66; the sugar/LEGO debris field is
      // around (-271,250). These stand the hero just outside each, so the
      // landmark is behind it rather than on top of it.
      // Landmark centres and footprint radii, so "how far outside this thing
      // am I standing" is measurable rather than eyeballed.
      const LM = [
        [-158, -166, 66],   // bottle cap
        [-271, 250, 80],    // LEGO brick
        [-166, 148, 30],    // screw
      ];
      // Hug the landmarks. Standing 15+ units off puts 90+ units of ground
      // between the animal and the object, and any rise in the patio then
      // occludes the very thing the shot exists to show. These sit a few
      // units outside each footprint so the landmark cannot be hidden.
      // Sun-side first. Hugging a landmark puts the animal in its shadow if
      // you stand on the wrong side: standing north-west of the bottle cap
      // dropped the hero close-up to luma 50 and saturation 15, i.e. it
      // fixed scale by destroying the lighting. The sun sits at azimuth
      // ~35.7 deg, direction (0.583, 0.812), so these sit on the lit face.
      const candidates = [
        [-115, -107], [-198, 250], [-271, 290], [-144, 178],    // lit faces
        [-86, -166], [-158, -94],                               // bottle cap, r66
        [-271, 205], [-193, 250],                               // LEGO brick, 132x66
        [-130, 148], [-166, 184],                               // screw, r30
        [-212, 176], [-96, -150],                               // open-patio fallbacks
      ];

      // The old rule picked whichever candidate had the MOST camera
      // clearance, which is a direct instruction to stand somewhere nothing
      // is nearby - the opposite of what makes scale read. Reviews then
      // scored scale 3-4/10 and said the hero shots look like "a normal-sized
      // animal on a cracked dry lakebed", which is exactly what the harness
      // was selecting for. Now clearance is only a veto (do not bury the
      // camera), and among the survivors we take the one standing closest to
      // the ideal gap outside a recognisably human-made object.
      // Pin the stand-point. Scoring it by camera clearance made the hero's
      // position a FUNCTION OF THE SCATTER: any change to world population
      // reshuffled the scores and moved the animal, which silently swung the
      // three character shots (once by 33 points of saturation, twice more by
      // 6+). A beauty shot must not move because a plant was added on the far
      // side of the map. This spot is measured: gap 7.0 from the bottle cap,
      // on its sunlit face, clearance 3.3. The search below still runs as a
      // fallback if it ever becomes blocked.
      const PINNED = [-115, -107];
      const WANT_GAP = 7;
      const MIN_CLEAR = 3.0;
      let best = null;
      let fallback = null;
      for (const [x, z] of candidates) {
        const y = world.heightAt(x, z) + 2;
        window.__TSIM.teleportHero(x, y, z);
        window.__TSIM.advanceTime(0.35);
        window.__TSIM.orbitHero(200, 7, 2.6, 42);
        const clear = window.__TSIM.cameraClearance().nearest || 0;
        let gap = Infinity;
        for (const [lx, lz, lr] of LM) {
          const g = Math.hypot(x - lx, z - lz) - lr;
          if (g > 0 && g < gap) gap = g;
        }
        const score = -Math.abs(gap - WANT_GAP);
        if (!fallback || clear > fallback.clear) fallback = { x, y, z, clear };
        if (clear < MIN_CLEAR) continue;
        if (!best || score > best.score) best = { x, y, z, clear, score, gap };
      }
      if (!best) best = fallback;

      // Is this spot actually in the sun? Cast a ray from just above the
      // ground towards the sun: if it hits anything, the hero stands in
      // shadow. Pinning a coordinate is not enough on its own - the pin was
      // measured as sunlit, then raising the paving moved the ground under
      // it into the bottle cap's shadow and the three character shots lost
      // 13 to 26 points of saturation. Measure the light, do not assume it.
      const ctx2 = window.__TSIM_CTX;
      const sun = (ctx2.engine && ctx2.engine.sun && ctx2.engine.sun.direction)
        || { x: 0.42, y: 0.72, z: 0.55 };
      // Use the world's BAKED sun grid, not a physics ray. A ray through the
      // physics world reported this spot as lit while the render showed it
      // deep in shadow, because the things shading it - grass, scatter - cast
      // shadows and carry no colliders at all. world.sunAt is the same grid
      // the terrain shading samples, so it agrees with what is drawn.
      const sunlit = (x, z) => {
        if (typeof world.sunAt === "function") return world.sunAt(x, z) > 0.62;
        const y = world.heightAt(x, z) + 1.2;
        try {
          const r = ctx2.physics.raycast({ x, y, z }, sun, 500, { filter: 1 | (1 << 1) });
          return !r || r.hit === false || !r.point;
        } catch (e) { return true; }
      };

      // Prefer the pinned spot, but only while it is both clear AND lit.
      {
        const [px, pz] = PINNED;
        const py = world.heightAt(px, pz) + 2;
        window.__TSIM.teleportHero(px, py, pz);
        window.__TSIM.advanceTime(0.35);
        window.__TSIM.orbitHero(200, 7, 2.6, 42);
        const clear = window.__TSIM.cameraClearance().nearest || 0;
        if (clear >= MIN_CLEAR && sunlit(px, pz)) {
          best = { x: px, y: py, z: pz, clear, score: 0, gap: 7 };
        }
      }

      // Otherwise take the best-scoring candidate that IS lit.
      if (!best || !sunlit(best.x, best.z)) {
        let lit = null;
        for (const [x, z] of candidates) {
          if (!sunlit(x, z)) continue;
          const y = world.heightAt(x, z) + 2;
          window.__TSIM.teleportHero(x, y, z);
          window.__TSIM.advanceTime(0.35);
          window.__TSIM.orbitHero(200, 7, 2.6, 42);
          const clear = window.__TSIM.cameraClearance().nearest || 0;
          if (clear < MIN_CLEAR) continue;
          let gap = Infinity;
          for (const [lx, lz, lr] of LM) {
            const g = Math.hypot(x - lx, z - lz) - lr;
            if (g > 0 && g < gap) gap = g;
          }
          const score = -Math.abs(gap - WANT_GAP);
          if (!lit || score > lit.score) lit = { x, y, z, clear, score, gap };
        }
        if (lit) best = lit;
      }
      return { candidates, LM, WANT_GAP, MIN_CLEAR, PINNED };
    });

    // ---- Pick the stand-point by MEASURED brightness ----
    // Two cheaper proxies were tried and both were wrong: a physics ray
    // toward the sun called the spot lit (grass and scatter shade the hero
    // but carry no colliders), and the world's baked sun grid disagreed with
    // the render too. Each attempt made the character shots darker. Render
    // each candidate and read the pixels - that is the only signal that
    // cannot disagree with the final image.
    {
      const plan = await page.evaluate(() => {
        const world = window.__TSIM_CTX.world;
        const LM = [[-158, -166, 66], [-271, 250, 80], [-166, 148, 30]];
        const cands = [
          [-115, -107], [-198, 250], [-271, 290], [-144, 178],
          [-86, -166], [-158, -94], [-271, 205], [-193, 250],
          [-130, 148], [-166, 184], [-212, 176], [-96, -150],
        ];
        return cands.map(([x, z]) => {
          let gap = Infinity;
          for (const [lx, lz, lr] of LM) {
            const g = Math.hypot(x - lx, z - lz) - lr;
            if (g > 0 && g < gap) gap = g;
          }
          return { x, y: world.heightAt(x, z) + 2, z, gap };
        });
      });

      let winner = null;
      for (const c of plan) {
        const clear = await page.evaluate((p) => {
          window.__TSIM.teleportHero(p.x, p.y, p.z);
          window.__TSIM.advanceTime(0.35);
          window.__TSIM.orbitHero(200, 7, 2.6, 42);
          for (let i = 0; i < 3; i += 1) window.__TSIM.renderOnce();
          return window.__TSIM.cameraClearance().nearest || 0;
        }, c);
        if (clear < 3.0) continue;
        const shot = await page.screenshot();
        const { data, info } = await sharp(shot).greyscale().resize(160, 90).raw()
          .toBuffer({ resolveWithObject: true });
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        const luma = sum / data.length;
        // Brightness first, then framing: a shot in full sun beside a
        // landmark beats a dim one at the perfect distance.
        const score = luma - Math.abs(c.gap - 7) * 1.4;
        if (!winner || score > winner.score) winner = { ...c, clear, luma, score };
      }

      if (winner) {
        await page.evaluate((p) => {
          window.__TSIM.teleportHero(p.x, p.y, p.z);
          window.__TSIM.advanceTime(0.6);
        }, winner);
        console.log(`hero placed at (${winner.x}, ${winner.z})  clearance ${winner.clear.toFixed(1)}  gap ${winner.gap.toFixed(1)}  frame luma ${winner.luma.toFixed(1)}`);
      }
    }

    const available = await page.evaluate(() => window.__TSIM.listPoses());
    const requested = !args.poses || args.poses === "all" || args.poses === true
      ? available.map((p) => p.id)
      : String(args.poses).split(",").map((s) => s.trim()).filter(Boolean);

    const shots = [];
    for (const poseId of requested) {
      if (!available.some((p) => p.id === poseId)) {
        console.warn(`skipping unknown pose "${poseId}"`);
        continue;
      }
      await page.evaluate((id) => window.__TSIM.setPose(id), poseId);

      // Nudge the camera off near geometry.
      //
      // Hand-tuning coordinates to dodge a blade of grass does not converge:
      // shard-overhang took three passes and each new position put a
      // different object across the lens. The harness already measures camera
      // clearance, so let it search - keep the aim point fixed, try small
      // offsets perpendicular to the view and along it, and take the best.
      // Framing is preserved because the target never moves.
      const poseMeta = available.find((p) => p.id === poseId) || {};
      if (!poseMeta.followHero) {
        // Collect candidate camera positions in-page, then judge them out
        // here by RENDERING each and measuring frame contrast. Clearance
        // alone is the wrong objective: it moved the puddle camera to a
        // clearer spot and cost 7 points of contrast, because a search that
        // only knows about obstruction cannot tell that it has also thrown
        // away the shot. Accept a move only if the frame does not get worse.
        const cands = await page.evaluate((id) => {
          const T = window.__TSIM;
          const THREE = T.THREE;
          const pose = window.__TSIM_CTX.world.getBeautyShots().find((p) => p.id === id);
          if (!pose || !pose.position || !pose.target) return null;
          const eye = new THREE.Vector3().fromArray(pose.position);
          const at = new THREE.Vector3().fromArray(pose.target);
          const fwd = at.clone().sub(eye).normalize();
          const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
          const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
          const want = Math.min(120, Math.max(12, at.distanceTo(eye) * 0.25));
          // A candidate must stay ABOVE the ground. Without this the search
          // dropped the puddle camera below the water plane, which produced a
          // black mass against white sky - and because that frame has a huge
          // luma spread, the contrast gate scored it as the best candidate in
          // the set. A high-contrast frame is not the same as a good one.
          const world = window.__TSIM_CTX.world;
          const aboveGround = (v) => v.y > world.heightAt(v.x, v.z) + 2.5;

          const out = [{ p: eye.toArray(), base: true }];
          for (const d of [6, 14, 26, 42]) {
            for (const [rx, uy, fz] of [
              [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
              [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.5, -1], [0, 0.8, -0.6],
            ]) {
              const cand = eye.clone().addScaledVector(right, rx * d)
                .addScaledVector(up, uy * d).addScaledVector(fwd, fz * d);
              if (!aboveGround(cand)) continue;
              out.push({ p: cand.toArray(), base: false });
            }
          }
          return { cands: out, target: pose.target, fov: pose.fov, want };
        }, poseId);

        if (cands) {
          let base = null;
          let best = null;
          for (const c of cands.cands) {
            const clear = await page.evaluate((a) => {
              window.__TSIM.lookAt(a.p, a.t, a.fov);
              for (let i = 0; i < 2; i += 1) window.__TSIM.renderOnce();
              return window.__TSIM.cameraClearance().nearest || 0;
            }, { p: c.p, t: cands.target, fov: cands.fov });
            const shot = await page.screenshot();
            const { data } = await sharp(shot).greyscale().resize(160, 90).raw()
              .toBuffer({ resolveWithObject: true });
            let sum = 0;
            for (let i = 0; i < data.length; i += 1) sum += data[i];
            const mean = sum / data.length;
            let v = 0;
            for (let i = 0; i < data.length; i += 1) v += (data[i] - mean) ** 2;
            const contrast = Math.sqrt(v / data.length);
            const rec = { ...c, clear, contrast };
            if (c.base) { base = rec; if (clear >= cands.want) break; }
            // Requiring the full distance-scaled target was all-or-nothing:
            // backlit could only reach 74 against a target of 102, so the
            // search discarded a position worth 13 points of contrast and
            // kept the blocked one. Take the best available improvement -
            // strictly clearer than the base, and no worse to look at - and
            // stop early once the target is genuinely met.
            if (!c.base && base && clear > base.clear * 1.15
              && contrast >= base.contrast * 0.97) {
              if (!best || contrast > best.contrast) best = rec;
              if (clear >= cands.want && contrast >= base.contrast) break;
            }
          }
          const pick = best || base;
          if (pick) {
            await page.evaluate((a) => window.__TSIM.lookAt(a.p, a.t, a.fov),
              { p: pick.p, t: cands.target, fov: cands.fov });
          }
        }
      }
      if (false) {
        await page.evaluate((id) => {
          const T = window.__TSIM;
          const ctx = T.ctx;
          const THREE = T.THREE;
          const pose = ctx.world.getBeautyShots().find((p) => p.id === id);
          if (!pose || !pose.position || !pose.target) return;

          const eye = new THREE.Vector3().fromArray(pose.position);
          const at = new THREE.Vector3().fromArray(pose.target);
          const fwd = at.clone().sub(eye).normalize();
          const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
          const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

          const measure = (p) => {
            T.lookAt(p.toArray(), pose.target, pose.fov);
            return T.cameraClearance().nearest || 0;
          };

          // The bar has to scale with how far away the subject is. A fixed 12
          // units passes a clover stem at 30 in a shot whose subject sits at
          // 410 - and at that ratio DOF turns the stem into an opaque wall
          // across a third of the frame. Nothing should sit closer than about
          // a quarter of the way to what the shot is actually looking at.
          const subjectDist = at.distanceTo(eye);
          const want = Math.min(120, Math.max(12, subjectDist * 0.25));

          let best = { p: eye.clone(), clear: measure(eye) };
          if (best.clear >= want) { T.lookAt(best.p.toArray(), pose.target, pose.fov); return; }

          // Offsets scale with how blocked we are, so a badly placed camera
          // can travel further than a nearly-good one.
          for (const d of [6, 14, 26, 42]) {
            for (const [rx, uy, fz] of [
              [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
              [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.5, -1], [0, 0.8, -0.6],
            ]) {
              const cand = eye.clone()
                .addScaledVector(right, rx * d)
                .addScaledVector(up, uy * d)
                .addScaledVector(fwd, fz * d);
              const c = measure(cand);
              if (c > best.clear) best = { p: cand, clear: c };
            }
            if (best.clear >= want) break;
          }
          T.lookAt(best.p.toArray(), pose.target, pose.fov);
        }, poseId);
      }

      // A few real frames so temporal effects (TAA/SMAA, bloom) resolve.
      await page.evaluate(() => {
        for (let i = 0; i < 6; i += 1) window.__TSIM.renderOnce();
      });
      await delay(140);

      const file = path.join(OUT_DIR, `${poseId}.png`);
      await page.screenshot({ path: file, animations: "disabled" });

      const analysis = await analyseImage(file);
      const clearance = await page.evaluate(() => window.__TSIM.cameraClearance());
      // 4 units is about where geometry stops being "context" and starts
      // being an unreadable blur across the lens. Hero close-ups are exempt:
      // they deliberately sit ~3.5 units from a 1.6-unit subject, so being
      // "close to geometry" is the entire point of the shot.
      const isHeroPose = (available.find((p) => p.id === poseId) || {}).followHero;
      if (!isHeroPose && clearance.nearest !== null && clearance.nearest < 4) {
        analysis.warnings.push(
          `camera has only ${clearance.nearest} units of clearance - geometry is pressed against the lens`
        );
      }
      shots.push({ pose: poseId, file: path.relative(root, file), clearance, ...analysis });

      console.log(`captured ${poseId} -> ${path.relative(root, file)}  clearance=${clearance.nearest}`);
      console.log(
        `   luma ${analysis.metrics.meanLuma} sd ${analysis.metrics.stdDevLuma} ` +
        `clipHi ${analysis.metrics.clippedHighPct}% clipLo ${analysis.metrics.clippedLowPct}% ` +
        `sat ${analysis.metrics.saturation} range ${analysis.metrics.tonalRange}/32`
      );
      for (const warning of analysis.warnings) console.log(`   !! ${warning}`);
    }

    /* ---- gameplay-in-motion shots ---- */
    if (args.action) {
      // Each beat: drive input, step the sim, then frame the hero from a
      // chase angle so the pose and the camera are both judged.
      const beats = [
        { id: "action-sprint", setup: (i) => { i.move(0, -1); i.press("sprint"); }, seconds: 1.4, orbit: [200, 7, 2.6, 52] },
        { id: "action-jump", setup: (i) => { i.move(0, -1); i.press("jump"); }, seconds: 0.34, orbit: [235, 6.5, 3.4, 55] },
        { id: "action-curl", setup: (i) => { i.move(0, -1); i.press("tun"); }, seconds: 1.1, orbit: [190, 6, 2.2, 58] },
        { id: "action-grapple", setup: (i) => { i.move(0.4, -1); i.press("grapple"); }, seconds: 0.8, orbit: [215, 8, 3.2, 55] },
        { id: "action-ragdoll", setup: (i) => { i.press("ragdoll"); }, seconds: 1.0, orbit: [160, 6.5, 2.8, 55] },
      ];

      for (const beat of beats) {
        try {
          await page.evaluate(() => {
            const i = window.__TSIM.input;
            ["forward", "back", "left", "right", "jump", "sprint", "grapple", "slam", "ragdoll", "tun"]
              .forEach((a) => i.release(a));
            i.stopMove();
            window.__TSIM.releaseCamera();
          });

          await page.evaluate((spec) => {
            const i = window.__TSIM.input;
            // eslint-disable-next-line no-new-func
            new Function("i", `(${spec.setupSource})(i)`)(i);
            window.__TSIM.advanceTime(spec.seconds);
          }, { setupSource: beat.setup.toString(), seconds: beat.seconds });

          await page.evaluate((orbit) => window.__TSIM.orbitHero(...orbit), beat.orbit);
          await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__TSIM.renderOnce(); });
          await delay(120);

          const file = path.join(OUT_DIR, `${beat.id}.png`);
          await page.screenshot({ path: file, animations: "disabled" });
          const analysis = await analyseImage(file);
          shots.push({ pose: beat.id, file: path.relative(root, file), ...analysis });
          console.log(`captured ${beat.id} -> ${path.relative(root, file)}`);
          for (const warning of analysis.warnings) console.log(`   !! ${warning}`);
        } catch (error) {
          console.warn(`action beat "${beat.id}" failed: ${error.message}`);
        }
      }

      await page.evaluate(() => {
        const i = window.__TSIM.input;
        ["jump", "sprint", "grapple", "slam", "ragdoll", "tun"].forEach((a) => i.release(a));
        i.stopMove();
      });
    }

    const report = await page.evaluate(() => window.__TSIM.report());
    const summary = {
      url: GAME_URL,
      viewport: { width: WIDTH, height: HEIGHT },
      quality: QUALITY,
      capturedAt: new Date().toISOString(),
      shots,
      report,
      consoleErrors,
      pageErrors,
    };
    await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify(summary, null, 2));

    console.log("\n--- diagnostics ---");
    console.log(JSON.stringify(report, null, 2));

    if (pageErrors.length) {
      console.error(`\n${pageErrors.length} page error(s):`);
      pageErrors.forEach((e) => console.error(`  ${e}`));
    }
    if (consoleErrors.length) {
      console.error(`\n${consoleErrors.length} console error(s):`);
      consoleErrors.slice(0, 20).forEach((e) => console.error(`  ${e}`));
    }

    const imageWarnings = shots.reduce((n, shot) => n + shot.warnings.length, 0);
    if (imageWarnings) {
      console.error(`\n${imageWarnings} image-quality warning(s) - see report.json`);
    }

    const failed = pageErrors.length > 0 || shots.length === 0;
    if (failed) process.exitCode = 1;
    console.log(`\nartifacts: ${path.relative(root, OUT_DIR)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
