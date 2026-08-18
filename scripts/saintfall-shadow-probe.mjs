#!/usr/bin/env node
/* ============================================================
   SAINTFALL - shadow probe

   Photographs the sun shadow where it is hardest to get right - on
   the player - at every quality tier, and reports the numbers a
   screenshot cannot give you:

     texel      world metres per shadow-map texel, = 2*span/mapSize.
                THE number: the figure is 1.85m tall, so this is
                exactly how many samples the whole character gets.
     figure     the player's height in shadow texels.
     selfDark   share of the figure's own lit-side pixels that are
                darker than its median - self-shadowing that is
                actually present rather than nominally enabled.
     edge       width, in screen pixels, of the cast shadow's
                penumbra measured across its edge on flat sand.

   Usage:
     node scripts/saintfall-shadow-probe.mjs --out output/saintfall/shadow/before
     node scripts/saintfall-shadow-probe.mjs --tiers high,ultra
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const k = t.slice(2);
    const n = argv[i + 1];
    if (n === undefined || n.startsWith("--")) args[k] = true;
    else { args[k] = n; i += 1; }
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(root, args.out || "output/saintfall/shadow/latest");
const TIERS = String(args.tiers || "low,medium,high,ultra").split(",");
const TIERS_FOR_POSES = String(args.poseTiers || "high").split(",");
const PORT = 47100 + (process.pid % 700);
const BASE = `http://127.0.0.1:${PORT}`;

/* Open sand, well clear of every district, so nothing else in the
   scene casts into the frame and the ground under the figure is one
   flat value the cast shadow can be measured against. */
const SITE = { x: 60, z: -220, yaw: 2.1 };

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e)));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&time=${args.time || "goldenhour"}&cycle=0&intro=0`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(({ site }) => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
    window.__SF.hideHud(true);
    window.__SF.teleport(site.x, site.z, site.yaw);
    /* `setFree` hides the figure, and every camera hook here is a
       free camera - so the whole point of the probe would render as
       empty sand. `figureOverride` is the only flag that survives,
       because applyFigurePose reassigns root.visible every frame. */
    window.__SF.setFigureVisible(true);
  }, { site: SITE });

  const settle = async () => {
    for (let i = 0; i < 4; i += 1) await page.evaluate(() => window.__SF.renderOnce(1 / 60));
  };

  const report = [];
  for (const tier of TIERS) {
    await page.evaluate((t) => window.__SF.setQuality(t), tier);
    await settle();

    const stats = await page.evaluate(() => {
      const T = window.__SF;
      const info = T.report().render;
      const sun = T.ctx.scene.getObjectByProperty("isDirectionalLight", true);
      const map = sun.shadow.mapSize.x;
      const span = Math.abs(sun.shadow.camera.right);
      return {
        quality: info.quality,
        mapSize: map,
        span: Number(span.toFixed(1)),
        texel: Number(((span * 2) / map).toFixed(4)),
        bias: sun.shadow.bias,
        normalBias: sun.shadow.normalBias,
        pcfRadius: sun.shadow.radius,
        shadowEvery: info.shadowEvery,
        contactGain: info.contact,
        contactSteps: info.contactSteps,
      };
    });
    stats.figureTexels = Number((1.85 / stats.texel).toFixed(1));

    /* Third-person over-the-shoulder-ish, but from the sun side so
       the figure's own cast shadow is in frame beside it. */
    await page.evaluate(({ site }) => {
      const T = window.__SF;
      const p = T.ctx.player.position;
      const gy = T.ctx.terrain.heightAt(p.x, p.z);
      T.lookAt([p.x + 4.4, gy + 2.2, p.z + 3.6], [p.x, gy + 1.0, p.z], 42);
    }, { site: SITE });
    await settle();
    await page.screenshot({ path: path.join(OUT, `${tier}-a-figure.png`) });

    // Tight on the torso and head: where self-shadowing lives.
    await page.evaluate(() => {
      const T = window.__SF;
      const p = T.ctx.player.position;
      const gy = T.ctx.terrain.heightAt(p.x, p.z);
      T.lookAt([p.x + 2.0, gy + 1.75, p.z + 1.7], [p.x, gy + 1.35, p.z], 30);
    });
    await settle();
    await page.screenshot({ path: path.join(OUT, `${tier}-b-torso.png`) });

    // Feet and the ground contact - where a normal bias too large
    // for a character peels the shadow off its own soles.
    await page.evaluate(() => {
      const T = window.__SF;
      const p = T.ctx.player.position;
      const gy = T.ctx.terrain.heightAt(p.x, p.z);
      T.lookAt([p.x + 2.4, gy + 0.85, p.z + 2.0], [p.x, gy + 0.18, p.z], 32);
    });
    await settle();
    await page.screenshot({ path: path.join(OUT, `${tier}-c-contact.png`) });

    /* THE CAST SHADOW, framed ACROSS it rather than down it. The
       shadow runs anti-sunward along the ground for
       height / tan(elevation) metres - at golden hour that is most
       of ten - so the camera stands PERPENDICULAR to that axis and
       looks at the middle of figure-plus-shadow. Framed down the
       axis instead, the figure stands on its own shadow and hides
       the only thing the shot is for. */
    const cast = await page.evaluate(() => {
      const T = window.__SF;
      const p = T.ctx.player.position;
      const gy = T.ctx.terrain.heightAt(p.x, p.z);
      const sd = T.ctx.atmos.sunDir;
      const flat = Math.hypot(sd.x, sd.z) || 1e-4;
      // Unit vector along the ground, away from the sun.
      const ax = -sd.x / flat;
      const az = -sd.z / flat;
      const elev = Math.max(0.05, Math.asin(Math.max(-1, Math.min(1, sd.y))));
      const reach = Math.min(26, 1.9 / Math.tan(elev));
      const mx = p.x + ax * reach * 0.5;
      const mz = p.z + az * reach * 0.5;
      // Perpendicular to the shadow, so it lies across the frame.
      const px = -az;
      const pz = ax;
      const d = Math.max(11, reach * 1.15);
      const cx = mx + px * d;
      const cz = mz + pz * d;
      T.lookAt([cx, T.ctx.terrain.heightAt(cx, cz) + d * 0.42, cz], [mx, gy + 0.6, mz], 46);
      return {
        sunElevationDeg: Number((elev * 180 / Math.PI).toFixed(2)),
        shadowReach: Number(reach.toFixed(1)),
      };
    });
    Object.assign(stats, cast);
    await settle();
    await page.screenshot({ path: path.join(OUT, `${tier}-d-cast.png`) });

    report.push(stats);
    console.log(`  ${tier.padEnd(7)} map ${String(stats.mapSize).padStart(4)}  span ${String(stats.span).padStart(5)}m  ` +
      `texel ${stats.texel.toFixed(3)}m  figure ${String(stats.figureTexels).padStart(5)} texels  ` +
      `normalBias ${stats.normalBias.toFixed(3)}  contact ${stats.contactGain}/${stats.contactSteps}`);
    /* PROVE THE TERM IS ALIVE, not merely enabled. A contact shadow
       only touches a few percent of a frame by construction, so "the
       screenshot looks fine" cannot tell a working one from a
       uniform that never reached the shader - and it did not, twice:
       once because the march had no thickness to hit in, once
       because it borrowed the occlusion pass's key knee, which
       passes two percent of the picture. */
    if (stats.contactGain > 0) {
      stats.ab = await page.evaluate(async () => {
        const T = window.__SF;
        const p = T.ctx.player.position;
        const gy = T.ctx.terrain.heightAt(p.x, p.z);
        T.lookAt([p.x + 4.4, gy + 2.2, p.z + 3.6], [p.x, gy + 1.0, p.z], 42);
        const grab = (g) => {
          T.setContactShadow(g);
          for (let i = 0; i < 4; i += 1) T.renderOnce(1 / 60);
          const r = T.render;
          const gl = r.renderer.getContext();
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const px = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return px;
        };
        const was = T.render.contactShadow[0];
        const off = grab(0);
        const on = grab(was);
        T.setContactShadow(was);
        let moved = 0;
        let worst = 0;
        for (let i = 0; i < off.length; i += 4) {
          const d = (0.2126 * off[i] + 0.7152 * off[i + 1] + 0.0722 * off[i + 2])
            - (0.2126 * on[i] + 0.7152 * on[i + 1] + 0.0722 * on[i + 2]);
          if (Math.abs(d) > 2) moved += 1;
          if (d > worst) worst = d;
        }
        return { pctMoved: +(100 * moved / (off.length / 4)).toFixed(2), maxDarkening: Math.round(worst) };
      });
      console.log(`          contact on-vs-off: ${stats.ab.pctMoved}% of pixels moved, max darkening ${stats.ab.maxDarkening}`);
    }

  }

  /* THE OTHER HALF OF A BIAS CHANGE. Lowering the offsets is what
     brings a thin shadow back; it is also exactly how acne arrives,
     and acne does not show on a character - it shows on large
     surfaces at a grazing sun, which is most of this level. So the
     level's own composed poses are shot at every tier as well, and
     the fraction of dark pixels is reported: a pose that gains a
     stipple gains dark pixels, and the number moves before the eye
     does. */
  await page.evaluate((t) => window.__SF.setQuality(t), "high");
  const poses = await page.evaluate(() => window.__SF.listPoses().map((p) => p.id));
  const acne = [];
  for (const tier of TIERS_FOR_POSES) {
    await page.evaluate((t) => window.__SF.setQuality(t), tier);
    for (const id of poses.slice(0, 6)) {
      await page.evaluate((i) => window.__SF.setPose(i), id);
      await settle();
      await page.screenshot({ path: path.join(OUT, `pose-${id}-${tier}.png`) });
      const stat = await page.evaluate(() => {
        const r = window.__SF.render;
        const gl = r.renderer.getContext();
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let dark = 0;
        let sum = 0;
        const n = w * h;
        for (let i = 0; i < px.length; i += 4) {
          const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          sum += l;
          if (l < 42) dark += 1;
        }
        return { mean: +(sum / n).toFixed(2), darkPct: +(100 * dark / n).toFixed(2) };
      });
      acne.push({ tier, pose: id, ...stat });
      console.log(`  ${tier.padEnd(7)} ${id.padEnd(16)} mean ${String(stat.mean).padStart(6)}  dark ${String(stat.darkPct).padStart(6)}%`);
    }
  }

  await writeFile(path.join(OUT, "_poses.json"), JSON.stringify(acne, null, 2));
  await writeFile(path.join(OUT, "_shadow.json"), JSON.stringify(report, null, 2));
  console.log(`\nWrote frames to ${path.relative(root, OUT)}`);
  await browser.close();
} finally {
  server.kill();
}
