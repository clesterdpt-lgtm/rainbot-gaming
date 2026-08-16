#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the creature surface kit, A/B'd

   Two frames that differ by the kit and by NOTHING else: same
   session, same camera, same pose, same sun, same frame counter.
   "Before" is the kit's own uniforms zeroed rather than a git stash,
   which buys two things a stash cannot - a pixel-registered pair, and
   proof that the shader is actually live. If zeroing the uniforms
   changes no pixels, nothing compiled.

   FRAMING IS LIFTED FROM THE BESTIARY HARNESS, deliberately. Framing
   a boss where it actually stands in its own district was tried first
   and photographed a dune: a lens placed relative to a fight-state
   position lands wherever the fight happens to have moved the animal,
   and the whole point of a surface review is to see the surface.
   `spawnEnemy` on open sand, distance computed from the subject's
   MEASURED height, is the framing this project already trusts.

   Also shoots the same animal at 200m, because procedural detail has
   no mips and the way it fails is shimmer at range.

   Usage:  node scripts/saintfall-surface-ab.mjs [--species a,b]
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const argv = process.argv.slice(2);
const speciesArg = (() => {
  const i = argv.indexOf("--species");
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(",") : ["distaff", "winnower", "cantor"];
})();
const OUT = path.join(root, "output/saintfall/surface-ab");
const PORT = 49973;
const BASE = `http://127.0.0.1:${PORT}`;
/* Open sand at the Bloom's edge - the bestiary's own review stage.
   A creature backed by its own district is a dark thing in front of
   dark things. */
const STAGE = { x: -388, z: -448 };

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.hideHud(true);
    T.setTime("goldenhour");
    window.__surf = {
      mats() {
        const out = [];
        T.ctx.scene.traverse((o) => {
          const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          for (const m of ms) {
            if (m && m.userData && m.userData.sfSurface && !out.includes(m)) out.push(m);
          }
        });
        return out;
      },
      snapshot() {
        window.__saved = window.__surf.mats().map((m) => ({
          m,
          g: m.userData.sfSurface.uniforms.uSfGrain.value.clone(),
          l: m.userData.sfSurface.uniforms.uSfGloss.value.clone(),
        }));
        return window.__saved.length;
      },
      set(on) {
        for (const e of window.__saved) {
          const u = e.m.userData.sfSurface.uniforms;
          if (on) { u.uSfGrain.value.copy(e.g); u.uSfGloss.value.copy(e.l); }
          else { u.uSfGrain.value.set(e.g.x, 0, 0, 0); u.uSfGloss.value.set(0, 0, 0, 0); }
        }
      },
      damage(v) {
        for (const e of window.__saved) e.m.userData.sfSurface.uniforms.uSfWear.value.z = v;
      },
      aim(distScale, fov) {
        const e = T.enemies.live[window.__view.idx];
        const h = window.__view.h;
        const d = window.__view.dist * distScale;
        const k = d / Math.hypot(2.5, 2.3);
        T.lookAt([e.x + 2.5 * k, e.y + h * 0.72, e.z + 2.3 * k],
          [e.x, e.y + h * 0.52, e.z], fov || 40);
        for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
      },
    };
  });

  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

  const redrawOnly = () => page.evaluate(() => new Promise((res) => {
    requestAnimationFrame(() => {
      window.__SF.renderOnce(0);
      requestAnimationFrame(() => res(true));
    });
  }));

  /* The two frames must be the SAME frame. `aim` steps the sim six
     times to settle the pose, so calling it once per shot put six
     frames of blowing dust between "before" and "after" and made a
     registered comparison impossible. Aim once, then only ever
     redraw at dt 0. */
  const pair = async (label, distScale = 1, fov = 40) => {
    await page.evaluate(([d, f]) => {
      window.__surf.snapshot();
      window.__surf.aim(d, f);
    }, [distScale, fov]);
    /* THE DRAW HAS TO HAPPEN INSIDE A FRAME. `page.screenshot` reads
       the COMPOSITED page, and a WebGL canvas drawn from a plain
       evaluate is one composite behind - so the first pair came back
       showing the previous shot's framing and the whole comparison was
       silently off by one. Drawing inside a rAF and waiting for the
       next one puts the buffer on screen before the capture. */
    const redraw = (on) => page.evaluate((v) => new Promise((res) => {
      window.__surf.set(v);
      requestAnimationFrame(() => {
        window.__SF.renderOnce(0);
        requestAnimationFrame(() => res(true));
      });
    }), on);
    await redraw(true);
    await shot(`${label}-after`);
    await redraw(false);
    await shot(`${label}-before`);
    await redraw(true);
  };

  const rows = [];
  for (const key of speciesArg) {
    const setup = await page.evaluate((s) => {
      const T = window.__SF;
      T.clearEnemies();
      T.releaseCamera();
      T.teleport(s.x, s.z, 0);
      T.hidePlayer(true);
      const inst = T.spawnEnemy(s.key, s.x + 4.2, s.z - 1.4, { yaw: Math.PI * 0.82 });
      if (!inst) return null;
      /* Long enough for the EMERGENCE to finish. At two seconds the
         Winnower was still half inside its own fissure and the review
         photographed a dune with a head in it. */
      T.advanceTime(7.0, 1 / 60);
      /* Index EXPLICITLY. `live[0]` was wrong and wrong quietly: the
         clear leaves the district's own standing bosses in the list,
         so every species measured and framed the same leftover animal
         and three "different" reviews came back identical. */
      const idx = T.enemies.live.findIndex((e) => e.key === s.key);
      const sc = T.enemyScaleCheck(idx);
      const FOV = 40;
      window.__view = {
        idx,
        h: sc.heightM,
        dist: sc.heightM / (2 * Math.tan((FOV / 2) * Math.PI / 180) * 0.55),
      };
      return { h: sc.heightM, dist: window.__view.dist, idx, live: T.enemies.live.length };
    }, { ...STAGE, key });
    if (!setup) { console.error(`${key}: SPAWN FAILED`); continue; }
    console.log(`${key}: ${setup.h.toFixed(2)}m tall, lens at ${setup.dist.toFixed(1)}m `
      + `(index ${setup.idx} of ${setup.live} live)`);
    rows.push({ key, ...setup });

    await page.evaluate(() => {
      window.__SF.playEnemyClip("idle", window.__view.idx);
      window.__SF.advanceTime(0.6, 1 / 60);
    });
    await pair(key);
    // And a detail crop, because sub-facet grain is a thing you have
    // to be close enough to see before you can argue about it.
    await pair(`${key}-detail`, 0.38, 34);

    await page.evaluate(() => window.__surf.damage(1));
    await redrawOnly();
    await shot(`${key}-damaged`);
    await page.evaluate(() => window.__surf.damage(0));

    /* The range test, taken along the SAME bearing as the close shot
       so it is the same subject and the same light - just further.
       A hand-placed far camera was tried and photographed the inside
       of the crater wall. If the fwidth fade and the distance fade
       are doing their job these two frames are nearly identical,
       which is the pass condition, not a disappointment. */
    const farScale = 200 / setup.dist;
    await pair(`${key}-far`, farScale, 6);
    const far = 200;
    console.log(`  far framing at ${far.toFixed(0)}m`);
  }

  const diag = await page.evaluate(() => window.__surf.mats().map((m) => ({
    name: m.name,
    family: m.userData.sfSurface.family,
    key: m.customProgramCacheKey(),
    compiled: !!m.userData.sfShader,
  })));
  await writeFile(path.join(OUT, "_diag.json"),
    JSON.stringify({ rows, materials: diag }, null, 2));
  console.log(JSON.stringify(diag, null, 2));
  console.log("page errors:", errors.slice(0, 12));
  await browser.close();
} finally {
  server.kill();
}
