#!/usr/bin/env node
/* Saintfall player bolt: does it leave from the point of the lance,
   and does it read as a quick gold laser?

   The origin half is a MEASUREMENT, not a look: the emitter's world
   position is compared against the furthest vertex of the weapon's own
   rendered geometry along the shaft axis. "It comes from the tip" is a
   claim about where two things are, and a screenshot of a bright flash
   cannot distinguish a flare on the needle from a flare on the socket
   32cm behind it - which is exactly the bug this was written for.

   The look half captures the first frames of a shot at 1/240 so the
   bolt is photographed in flight rather than after it has landed.

   Usage: node scripts/saintfall-bolt-probe.mjs [--out DIR]
*/

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argOut = process.argv.indexOf("--out");
const outDir = path.resolve(root, argOut >= 0
  ? process.argv[argOut + 1] : "output/saintfall/bolt-probe");
const port = 46100 + (process.pid % 900);
const base = `http://127.0.0.1:${port}`;

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

async function waitServer() {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function savePng(file, dataUrl) {
  await writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  const errors = [];
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

    await page.goto(`${base}/games/saintfall.html?qa=1&intro=0`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });
    await page.evaluate(() => window.__SF.maximize());
    await page.waitForTimeout(120);

    /* ------------------------- the measurement ------------------------- */
    const geometry = await page.evaluate(() => {
      const T = window.__SF;
      const THREE = T.ctx.THREE;
      // Draw the lance and let the carry pose settle before measuring.
      T.setAutoStow?.(false);
      T.advanceTime(1.5);
      const w = T.weapons.current;
      const rootObj = w.root;
      rootObj.updateWorldMatrix(true, true);

      /* Furthest RENDERED vertex along the shaft, in the weapon's own
         local frame. Traversing meshes rather than trusting a bounding
         box: the box would include the censer hanging under the socket
         and the ribbons, neither of which is the point of the lance. */
      const v = new THREE.Vector3();
      let tipLocalX = -Infinity;
      let tipMesh = null;
      rootObj.traverse((node) => {
        if (!node.isMesh || !node.geometry?.attributes?.position) return;
        if (node.name === "muzzle-flare" || node.parent?.name === "muzzle-flare") return;
        const pos = node.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 1) {
          v.fromBufferAttribute(pos, i);
          node.updateWorldMatrix(true, false);
          v.applyMatrix4(node.matrixWorld);
          rootObj.worldToLocal(v);
          if (v.x > tipLocalX) { tipLocalX = v.x; tipMesh = node.name || "(unnamed)"; }
        }
      });

      const world = (obj) => obj.getWorldPosition(new THREE.Vector3());
      const emitter = w.emitter ? world(w.emitter) : null;
      const muzzle = world(w.muzzle);
      const tipWorld = rootObj.localToWorld(new THREE.Vector3(tipLocalX, 0, 0));
      const flare = w.flashRig ? world(w.flashRig) : null;

      const camDir = new THREE.Vector3();
      T.render.camera.getWorldDirection(camDir);

      return {
        haft: w.spec.haft,
        tipLocalX, tipMesh,
        emitterLocalX: w.emitter ? w.emitter.position.x : null,
        muzzleLocalX: w.muzzle.position.x,
        emitterToTip: emitter ? emitter.distanceTo(tipWorld) : null,
        muzzleToTip: muzzle.distanceTo(tipWorld),
        flareToTip: flare ? flare.distanceTo(tipWorld) : null,
        /* Perpendicular offset of the emitter from the aim ray. The
           shot has to leave the tip AND go where the reticle points;
           this is the second half of that claim. */
        emitterOffAxis: emitter
          ? emitter.clone().sub(muzzle).sub(
            camDir.clone().multiplyScalar(emitter.clone().sub(muzzle).dot(camDir))).length()
          : null,
      };
    });

    /* --------------------------- the frames ---------------------------
       Twice, because one view cannot answer both questions.

       LEVEL is the gameplay view: the bolt leaves end-on from a chase
       camera, which is the case the effect actually has to survive,
       and the crop beside it is the only way to see whether the
       discharge is on the needle or behind it.

       SKYWARD points the same real shot up at thirty degrees so the
       bolt climbs clear of the trooper's silhouette against open sky
       - the only way to photograph its shape and colour at all. */
    const report = {};
    const fails = [];
    async function burst(label, aim) {
      const { out: frames, quiet, origin } = await page.evaluate(({ ax, ay, az }) => {
        const T = window.__SF;
        T.aimAt(ax, ay, az, 14);
        const gl = T.render.renderer.getContext();
        const fin = () => { if (typeof gl.finish === "function") gl.finish(); };
        const out = [];
        const tracerMesh = T.vfx.group.getObjectByName("tracers");
        const births = tracerMesh.geometry.attributes.aBirth.array;
        const beforeBirths = [];
        for (let i = 0; i < births.length; i += 4) beforeBirths.push(births[i]);
        const beforeImpact = T.impactPool();
        // A quiet frame first: the trooper's own visor, heart lantern
        // and reliquary lamp are emissive, so the brightest pixel in a
        // discharge frame is not necessarily the discharge. Only the
        // DIFFERENCE against this is the flash.
        T.renderOnce(1 / 240);
        fin();
        const quiet = T.captureDataURL();
        /* Held through the game's own trigger, then stepped at 1/240.
           `fireWeapon` spends a 30th plus a 60th of simulation per
           round, which at 520 m/s puts the bolt twenty-six metres away
           before the first capture - past everything this exists to
           photograph. */
        const held = T.ctx.player.input.state.firing;
        T.ctx.player.input.state.firing = true;
        T.renderOnce(1 / 240);
        T.ctx.player.input.state.firing = held;
        fin();
        out.push({ i: 0, ms: 4, image: T.captureDataURL() });
        const trace = T.lastTracer();
        const emitter = T.weapons.current.emitter.getWorldPosition(new T.ctx.THREE.Vector3());
        const start = new T.ctx.THREE.Vector3(...trace.start);
        const projected = emitter.clone().project(T.render.camera);
        const canvas = T.render.renderer.domElement;
        let changedSlots = 0;
        for (let i = 0; i < births.length; i += 4) {
          if (Math.abs(births[i] - beforeBirths[i / 4]) > 1e-7) changedSlots += 1;
        }
        const afterImpact = T.impactPool();
        const origin = {
          trace,
          emitter: emitter.toArray(),
          startToEmitterM: start.distanceTo(emitter),
          changedSlots,
          scheduledWakeDelta: Math.max(0,
            (afterImpact?.scheduled || 0) - (beforeImpact?.scheduled || 0)),
          emitterPx: [
            Math.round((projected.x * 0.5 + 0.5) * canvas.width),
            Math.round((-projected.y * 0.5 + 0.5) * canvas.height),
          ],
        };
        for (let i = 1; i < 8; i += 1) {
          T.renderOnce(1 / 240);
          fin();
          out.push({ i, ms: Math.round((i + 1) * (1000 / 240)), image: T.captureDataURL() });
        }
        return { out, quiet, origin };
      }, aim);

      /* WHERE THE FLASH LANDED, IN PIXELS.

         The world-space measurement above proves the emitter is on
         the needle. This proves the thing the player actually sees is
         too: the brightest pixel of the discharge frame against the
         emitter's own projected position. A flare parented to the
         right node can still be drawn somewhere else. */
      const first = frames[0];
      const firstBuf = Buffer.from(first.image.slice(first.image.indexOf(",") + 1), "base64");
      const quietBuf = Buffer.from(quiet.slice(quiet.indexOf(",") + 1), "base64");
      const shot = await sharp(firstBuf).raw().toBuffer({ resolveWithObject: true });
      const base2 = await sharp(quietBuf).raw().toBuffer({ resolveWithObject: true });
      const info = shot.info;
      let best = -1;
      let bx = 0;
      let by = 0;
      for (let i = 0; i < info.width * info.height; i += 1) {
        const o = i * info.channels;
        const d = Math.max(0, shot.data[o] - base2.data[o])
          + Math.max(0, shot.data[o + 1] - base2.data[o + 1])
          + Math.max(0, shot.data[o + 2] - base2.data[o + 2]);
        if (d > best) { best = d; bx = i % info.width; by = (i / info.width) | 0; }
      }
      let nearest = Infinity;
      let nx = 0;
      let ny = 0;
      const threshold = Math.max(24, best * 0.08);
      for (let i = 0; i < info.width * info.height; i += 1) {
        const o = i * info.channels;
        const d = Math.max(0, shot.data[o] - base2.data[o])
          + Math.max(0, shot.data[o + 1] - base2.data[o + 1])
          + Math.max(0, shot.data[o + 2] - base2.data[o + 2]);
        if (d < threshold) continue;
        const x = i % info.width;
        const y = (i / info.width) | 0;
        const dist = Math.hypot(origin.emitterPx[0] - x, origin.emitterPx[1] - y);
        if (dist < nearest) { nearest = dist; nx = x; ny = y; }
      }
      report[label] = {
        emitterPx: origin.emitterPx,
        brightestNewPx: [bx, by],
        peakDelta: best,
        brightestOffsetPx: Math.round(Math.hypot(
          origin.emitterPx[0] - bx, origin.emitterPx[1] - by)),
        nearestNewPx: [nx, ny],
        nearestNewOffsetPx: Number.isFinite(nearest) ? Math.round(nearest) : null,
        frame: [info.width, info.height],
        ...origin,
      };

      for (const f of frames) {
        const stem = `${label}-${String(f.i).padStart(2, "0")}-${f.ms}ms`;
        const buf = Buffer.from(f.image.slice(f.image.indexOf(",") + 1), "base64");
        await writeFile(path.join(outDir, `${stem}.png`), buf);
        // A close read of the discharge itself, upscaled so a 30px
        // flare is judgeable rather than guessed at.
        await sharp(buf)
          .extract({ left: 470, top: 250, width: 420, height: 280 })
          .resize(840, 560, { kernel: "nearest" })
          .toFile(path.join(outDir, `${stem}-muzzle.png`));
      }
      return frames.length;
    }

    const here = await page.evaluate(() => {
      const ps = window.__SF.ctx.player.state;
      return { x: ps.x, y: ps.y, z: ps.z };
    });
    await burst("level", { ax: here.x, ay: here.y + 1.6, az: here.z - 90 });

    /* A fast camera change is the adversarial origin case. Before the
       deferred-tip fix, the tracer was stamped from the old carry pose
       and the rendered lance could finish the frame 30cm away. */
    const stressOrigin = await page.evaluate(() => {
      const T = window.__SF;
      const THREE = T.ctx.THREE;
      T.advanceTime(0.25);
      T.weapons.resupply();
      const mesh = T.vfx.group.getObjectByName("tracers");
      const births = mesh.geometry.attributes.aBirth.array;
      const before = [];
      for (let i = 0; i < births.length; i += 4) before.push(births[i]);
      const ps = T.playerState();
      T.setCam(ps.camYaw + 0.85, ps.camPitch - 0.20);
      const held = T.ctx.player.input.state.firing;
      T.ctx.player.input.state.firing = true;
      T.renderOnce(1 / 240);
      T.ctx.player.input.state.firing = held;
      const trace = T.lastTracer();
      const emitter = T.weapons.current.emitter.getWorldPosition(new THREE.Vector3());
      const start = new THREE.Vector3(...trace.start);
      let changedSlots = 0;
      for (let i = 0; i < births.length; i += 4) {
        if (Math.abs(births[i] - before[i / 4]) > 1e-7) changedSlots += 1;
      }
      return {
        startToEmitterM: start.distanceTo(emitter),
        changedSlots,
        trace,
      };
    });

    /* ---------------------- the side view ----------------------------
       Fired along the LANCE'S OWN AXIS rather than along the camera,
       from a free camera set off to one side. That is the only way to
       photograph a bolt this game normally fires directly away from
       the viewer, and it tests something the chase view cannot: that
       the shot travels down the needle's axis from the needle's point,
       instead of merely starting somewhere near it. */
    const sideFrames = await page.evaluate(() => {
      const T = window.__SF;
      const THREE = T.ctx.THREE;
      const ps = T.ctx.player.state;
      const w = T.weapons.current;
      w.root.updateWorldMatrix(true, true);
      const org = w.emitter.getWorldPosition(new THREE.Vector3());
      const q = w.root.getWorldQuaternion(new THREE.Quaternion());
      const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();
      const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize();

      T.hidePlayer(false);
      T.ctx.player.setFree(true,
        org.clone().addScaledVector(side, 7.5).addScaledVector(dir, 4.2)
          .add(new THREE.Vector3(0, 1.1, 0)).toArray(),
        org.clone().addScaledVector(dir, 5.5).toArray(), 42);

      const gl = T.render.renderer.getContext();
      const fin = () => { if (typeof gl.finish === "function") gl.finish(); };
      const out = [];
      // Let the production-path stress shot clear before photographing
      // this isolated profile. Otherwise two valid, separate triggers
      // overlap and make the singular-beam proof itself look doubled.
      T.advanceTime(0.10);
      T.ctx.combat.fire(org, dir, { damage: 22 });
      T.ctx.vfx.muzzle(org.x, org.y, org.z, dir.x, dir.y, dir.z, 1, true);
      T.weapons.flashMuzzle();
      for (let i = 0; i < 8; i += 1) {
        T.renderOnce(1 / 240);
        fin();
        out.push({ i, ms: Math.round((i + 1) * (1000 / 240)), image: T.captureDataURL() });
      }
      T.ctx.player.setFree(false);
      T.autoPlayer();
      return out;
    });
    for (const f of sideFrames) {
      const stem = `side-${String(f.i).padStart(2, "0")}-${f.ms}ms`;
      await savePng(path.join(outDir, `${stem}.png`), f.image);
    }

    const g = geometry;
    console.log("--- where the shot leaves from ---");
    console.log(`haft                 ${g.haft.toFixed(3)} m`);
    console.log(`rendered tip (local) ${g.tipLocalX.toFixed(4)} m   on "${g.tipMesh}"`);
    console.log(`emitter      (local) ${g.emitterLocalX === null ? "n/a" : g.emitterLocalX.toFixed(4)} m`);
    console.log(`aim muzzle   (local) ${g.muzzleLocalX.toFixed(4)} m`);
    console.log("");
    console.log(`emitter -> tip       ${g.emitterToTip === null ? "n/a" : g.emitterToTip.toFixed(4)} m`);
    console.log(`aim node -> tip      ${g.muzzleToTip.toFixed(4)} m`);
    console.log(`flare -> tip         ${g.flareToTip === null ? "n/a" : g.flareToTip.toFixed(4)} m`);
    console.log(`emitter off aim ray  ${g.emitterOffAxis === null ? "n/a" : g.emitterOffAxis.toFixed(4)} m`);
    console.log("");
    console.log("--- where the flash landed on screen ---");
    for (const [k, r] of Object.entries(report)) {
      console.log(`${k.padEnd(6)} emitter ${JSON.stringify(r.emitterPx)}  `
        + `nearest-new ${JSON.stringify(r.nearestNewPx)}  offset ${r.nearestNewOffsetPx}px `
        + `of ${r.frame[0]}x${r.frame[1]}`);
    }
    console.log(`snap-turn origin      ${stressOrigin.startToEmitterM.toFixed(5)}m from final tip`);
    console.log("");
    if (!(g.emitterToTip <= 0.01)) fails.push(`emitter is ${g.emitterToTip.toFixed(4)}m from rendered tip`);
    if (!(g.flareToTip <= 0.01)) fails.push(`flare is ${g.flareToTip.toFixed(4)}m from rendered tip`);
    if (!(g.emitterOffAxis <= 0.02)) fails.push(`emitter is ${g.emitterOffAxis.toFixed(4)}m off aim ray`);
    for (const [label, r] of Object.entries(report)) {
      if (!(r.startToEmitterM <= 0.01)) {
        fails.push(`${label} streak starts ${r.startToEmitterM.toFixed(4)}m from final posed tip`);
      }
      if (r.changedSlots !== 1) fails.push(`${label} trigger changed ${r.changedSlots} tracer slots, not one`);
      if (r.scheduledWakeDelta !== 0) fails.push(`${label} scheduled ${r.scheduledWakeDelta} wake particles`);
      if (!r.trace?.beam || r.trace?.head) fails.push(`${label} is not one headless beam`);
      if (!(r.trace?.width >= 0.04 && r.trace?.width <= 0.12)) {
        fails.push(`${label} beam width ${r.trace?.width}m is outside the thin-laser range`);
      }
      if (!(r.nearestNewOffsetPx !== null && r.nearestNewOffsetPx <= 6)) {
        fails.push(`${label} rendered discharge begins ${r.nearestNewOffsetPx}px from projected tip`);
      }
    }
    if (!(stressOrigin.startToEmitterM <= 0.01)) {
      fails.push(`snap-turn streak starts ${stressOrigin.startToEmitterM.toFixed(4)}m from final posed tip`);
    }
    if (stressOrigin.changedSlots !== 1) {
      fails.push(`snap-turn trigger changed ${stressOrigin.changedSlots} tracer slots, not one`);
    }
    if (errors.length) fails.push(...errors);
    const result = { geometry, report, stressOrigin, errors, failures: fails };
    await writeFile(path.join(outDir, "report.json"), JSON.stringify(result, null, 2));
    if (fails.length) {
      console.log("FAIL:");
      for (const failure of fails) console.log(`  - ${failure}`);
      process.exitCode = 1;
    } else {
      console.log("PASS: one thin gold beam begins on the final posed lance tip");
    }
    console.log(`frames -> ${outDir}`);
  } finally {
    await browser?.close();
    child.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
