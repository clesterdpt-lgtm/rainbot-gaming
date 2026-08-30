#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Stylite's reveal, photographed frame by frame

   The gallery harness photographs six framings of a boss doing what
   it does for most of a fight. That is the right tool for comparing
   eight animals and the wrong one for THIS boss's opening, because
   the opening is over in a second and the gallery never shoots it:
   every one of its framings arms the encounter and waits for
   `perched`, by which time the stone crust is on the ground.

   So this photographs the shed itself, on a fixed clock, from a lens
   that does what the art-direction doc asks for and the gallery
   cannot - it sits BELOW the animal and looks up, with the crown
   against open sky.

   Five frames:

     00-dormant   the last frame before anything moves. If this does
                  not read as a lump of rock on a needle, the whole
                  camouflage premise is a claim rather than a fact.
     01-crack     the tremble, and the first shards lifting.
     02-shed      mid-shed, stone in the air, belly lit.
     03-clear     the animal, revealed, still on the crown.
     04-crashed   what the fall leaves on the ground: the crater
                  marks, the drag scar, and a spent animal in it.

   Nothing here is timed against wall-clock. Headless chromium
   throttles rAF to about one frame a second, so every step is driven
   explicitly through `advanceTime` and every still is drawn at dt 0.

   Usage:  node scripts/saintfall-stylite-reveal.mjs
           node scripts/saintfall-stylite-reveal.mjs --out <dir>
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const OUT = path.join(root,
  outArg >= 0 && argv[outArg + 1] ? argv[outArg + 1] : "output/saintfall/stylite-reveal");
/* Pid-derived, like every other harness in this tree: eight agents
   running shots at once on one checkout must not fight for a port. */
const PORT = 46700 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 300; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&time=goldenhour&cycle=0&intro=0`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
    document.querySelectorAll(".sf-hud, #sf-hud").forEach((el) => {
      el.style.visibility = "hidden";
    });
    /* THE LIVE LOOP IS STOPPED, and this harness does not work without
       it. `main.js` keeps its own rAF running and hands it whatever
       wall-clock elapsed, clamped to 0.1s - so every screenshot, which
       costs the better part of a second of real time, quietly pushed
       the simulation forward. The first run of this file asked for a
       frame 0.30s into a 1.05s shed and photographed one at 0.95s: all
       eleven shards already gone, and the report said so while the
       picture looked plausible enough to believe.

       The gallery harness never hits this because every one of its
       poses is POLLED rather than timed. This one is measuring a
       schedule, so the clock has to be ours alone. `advanceTime`
       deliberately bypasses the pause flag; the rAF loop does not. */
    window.__SF.ctx.runtime.paused = true;
  });

  /**
   * Place the lens relative to wherever the animal actually is, and
   * shoot. `up` is metres above the animal - negative looks UP at it,
   * which is the point of this harness.
   */
  const shoot = async (name, dist, up, lookY, fov) => {
    const view = await page.evaluate(([d, u, ly, f]) => {
      const T = window.__SF;
      const s = T.styliteState();
      const spires = T.stylitePerches();
      /* Same bearing search the per-boss harness uses: half of every
         circle around this animal is solid needle, and a lens buried
         in one photographs a wall. Its own crown is skipped, because
         a perched Stylite is inside that radius by definition. */
      let best = null;
      for (let i = 0; i < 48; i += 1) {
        const a = (i / 48) * Math.PI * 2;
        const cx = s.x + Math.cos(a) * d;
        const cz = s.z + Math.sin(a) * d;
        let clear = Infinity;
        for (const n of spires) {
          if (Math.hypot(n.x - s.x, n.z - s.z) < n.rad + 3 && s.y > n.y - 6) continue;
          for (let t = 0.12; t <= 1.0001; t += 0.08) {
            const px = s.x + (cx - s.x) * t;
            const pz = s.z + (cz - s.z) * t;
            clear = Math.min(clear, Math.hypot(n.x - px, n.z - pz) - n.rad);
          }
        }
        if (!best || clear > best.clear) best = { cx, cz, clear };
      }
      return { cx: best.cx, cz: best.cz, eye: s.y + u,
        tx: s.x, ty: s.y + ly, tz: s.z, fov: f, clear: best.clear,
        phase: s.phase, crust: s.crust, shards: s.shards };
    }, [dist, up, lookY, fov]);
    await page.evaluate((v) => {
      const T = window.__SF;
      T.lookAt([v.cx, v.eye, v.cz], [v.tx, v.ty, v.tz], v.fov);
      for (let i = 0; i < 3; i += 1) T.renderOnce(0);
    }, view);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`shot  ${name}  phase=${view.phase} crust=${view.crust} `
      + `shards=${view.shards} clearance=${view.clear.toFixed(0)}m`);
  };

  /* Arm it the way the game does: put the shell back on, walk the
     player into the aggro radius, and let proximity fire the rouse.
     Forcing the phase by hand would skip `beginRouse` and with it the
     encounter camera, which is half of what is being judged here. */
  await page.evaluate(() => {
    const T = window.__SF;
    T.resetStylite();
    T.teleportToStylite(54);
    T.advanceTime(1 / 60, 1 / 60);
  });
  await shoot("00-dormant", 26, -9, 1.0, 40);

  const stepTo = (seconds) => page.evaluate((s) => {
    window.__SF.advanceTime(s, 1 / 120);
  }, seconds);

  /* The rouse runs 3.4s and the shed is the first 1.05s of it. The
     three frames below sit at roughly a quarter, a half and past the
     end of that window. */
  await stepTo(0.30);
  await shoot("01-crack", 24, -8, 1.0, 42);
  await stepTo(0.42);
  await shoot("02-shed", 24, -8, 1.0, 42);
  await stepTo(0.70);
  await shoot("03-clear", 22, -7, 0.5, 42);

  /* And the ground. Break the grip, ride the fall down, and photograph
     what a ninety-metre landing leaves behind. */
  await page.evaluate(() => {
    const T = window.__SF;
    T.advanceToStylitePhase("perched", 20);
    T.forceStyliteFall();
    for (let i = 0; i < 600; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      if (T.styliteState()?.grounded) break;
    }
    T.advanceTime(0.5, 1 / 60);
  });
  await shoot("04-crashed", 15, 3.5, -1.5, 50);

  console.log(`\nFrames: ${OUT}`);
  await browser.close();
} finally {
  server.kill();
}
