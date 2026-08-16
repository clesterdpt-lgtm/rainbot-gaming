#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Stylite, photographed

   Five questions no assertion can answer:

     1. does it read as something that BELONGS on a needle crown -
        gripping, folded, at rest eighty metres up - or as a model
        parked in the air above one;
     2. does the leap read as a leap? A coil, a launch, an arc that
        clears the gap between two spires, a landing that absorbs.
        If those four are not legible from a distance the fight is a
        boss teleporting around the district;
     3. does the volley read as coming from UP THERE - can you tell,
        from the ground, where you are being shot from;
     4. does the fall read as a fall - eighty metres of animal losing
        its grip - or as a spawn at ground level;
     5. and once down, does it read as HURT, which is the only reason
        a player would walk into melee range of it.

   Usage:  node scripts/saintfall-stylite-shots.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/stylite-shots");
const PORT = 49987;
const BASE = `http://127.0.0.1:${PORT}`;

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
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
    document.querySelectorAll(".sf-hud, #sf-hud").forEach((el) => {
      el.style.visibility = "hidden";
    });
  });

  /* Unlike every other boss in this game the Stylite MOVES between
     shots, and the move is the point - so nothing here can be framed
     from a fixed lair coordinate the way the Abbess is. Each shot runs
     its setup, reads where the animal actually ended up, and places
     the lens relative to THAT.

     The azimuth is CHOSEN rather than given. A fixed offset kept
     putting the camera inside a needle - the district is a forest of
     eighty-metre spires and the boss deliberately sits among them, so
     roughly half of every circle around it is solid rock. The helper
     samples the ring and keeps the bearing that stays furthest from
     every other crown, which is the same thing a photographer walking
     around the subject would do. */
  const frame = async (name, setup, shot) => {
    if (setup) await page.evaluate(`(${setup.toString()})(window.__SF)`);
    /* Settle BEFORE the camera is placed, and hold still after.

       The paint frames are not free: `renderOnce(1/60)` steps the
       simulation, and mid-leap this animal covers several metres per
       frame - so a lens aimed at where it was four frames ago put the
       subject of the leap shot in the bottom corner. Everything that
       needs a frame to catch up happens first; the shot itself is then
       taken at dt 0, with nothing left to drift. */
    await page.evaluate(() => {
      for (let i = 0; i < 4; i += 1) window.__SF.renderOnce(1 / 60);
    });
    const view = await page.evaluate(([dist, up, lookY, fov, fromGround]) => {
      const T = window.__SF;
      const s = T.styliteState();
      const spires = T.stylitePerches();
      const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
      const eyeGuess = (fromGround
        ? T.ctx.collide.groundHeight(s.x, s.z) : s.y) + up;
      let best = null;
      for (let i = 0; i < 48; i += 1) {
        const a = (i / 48) * Math.PI * 2;
        const cx = s.x + Math.cos(a) * dist;
        const cz = s.z + Math.sin(a) * dist;
        /* Clearance is measured at the closest approach of the LINE of
           sight, not at the camera, because a spire halfway between
           lens and subject blocks the shot just as well as one the
           lens is buried in. */
        let clear = Infinity;
        for (const n of spires) {
          /* Skip the crown it is STANDING ON. A perched Stylite is
             inside its own needle's radius by definition, so counting
             that one scores every bearing on the circle as blocked and
             the chooser degenerates to "whichever it tried first".
             Only while it is UP there, though - a fallen one is lying
             at the foot of that same needle with the whole cone
             between it and half the district. */
          const own = Math.hypot(n.x - s.x, n.z - s.z) < n.rad + 3
            && s.y > n.y - 6;
          if (own) continue;
          /* Radius interpolated to the height the shot is taken at.
             `rad` is the crown, `baseRad` the footprint, and a needle
             is mostly the taper between them - measuring a ground-level
             sightline against the crown's width says a spire twenty
             metres wide at the sand is four metres wide. */
          const t01 = clamp01((Math.min(s.y, eyeGuess) - n.baseY)
            / Math.max(1, n.y - n.baseY));
          const r = n.baseRad + (n.rad - n.baseRad) * Math.pow(t01, 2.3);
          for (let t = 0.12; t <= 1.0001; t += 0.08) {
            const px = s.x + (cx - s.x) * t;
            const pz = s.z + (cz - s.z) * t;
            clear = Math.min(clear, Math.hypot(n.x - px, n.z - pz) - r);
          }
        }
        if (!best || clear > best.clear) best = { cx, cz, clear };
      }
      const g = T.ctx.collide.groundHeight(best.cx, best.cz);
      const eye = (fromGround ? g : s.y) + up;
      return { cx: best.cx, cz: best.cz, eye, tx: s.x, ty: s.y + lookY, tz: s.z,
        fov, clear: best.clear, x: s.x, y: s.y, z: s.z };
    }, shot);
    /* Report where the subject actually landed ON SCREEN. A shot can
       be perfectly composed on paper and photograph an empty sky, and
       a printed NDC is the difference between noticing that and
       shipping a gallery of scenery. */
    const shown = await page.evaluate((v) => {
      const T = window.__SF;
      T.lookAt([v.cx, v.eye, v.cz], [v.tx, v.ty, v.tz], v.fov);
      for (let i = 0; i < 3; i += 1) T.renderOnce(0);
      let mesh = null;
      T.ctx.scene.traverse((o) => { if (o.name === "sf-stylite-body") mesh = o; });
      if (!mesh) return null;
      const wp = new T.THREE.Vector3();
      mesh.getWorldPosition(wp);
      const cam = T.ctx.render?.camera || T.ctx.camera;
      const n = wp.project(cam);
      let chainVisible = true;
      for (let o = mesh; o; o = o.parent) if (!o.visible) chainVisible = false;
      return { u: Number(n.x.toFixed(2)), v: Number(n.y.toFixed(2)),
        depth: Number(n.z.toFixed(3)), visible: chainVisible,
        cam: [Math.round(cam.position.x), Math.round(cam.position.y),
          Math.round(cam.position.z)],
        want: [Math.round(v.cx), Math.round(v.eye), Math.round(v.cz)] };
    }, view);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const onScreen = shown && shown.visible && Math.abs(shown.u) < 1
      && Math.abs(shown.v) < 1 && shown.depth < 1;
    console.log(`shot  ${name}  at ${view.x.toFixed(0)},${view.y.toFixed(0)},`
      + `${view.z.toFixed(0)}  clearance ${view.clear.toFixed(0)}m`
      + `  frame ${shown ? `${shown.u},${shown.v}` : "?"}`
      + `  cam ${shown ? shown.cam.join("/") : "?"} want `
      + `${shown ? shown.want.join("/") : "?"}`
      + `${onScreen ? "" : "   <-- OFF FRAME"}`);
  };

  // Wake it and let it settle onto a crown.
  await frame("01-perched", (T) => {
    T.teleportToStylite(52);
    T.advanceToStylitePhase("perched", 20);
    T.advanceTime(1.2, 1 / 60);
  }, [34, 5, 0, 40, false]);

  // The design read: close enough to see the grip claws and the folded
  // launch legs, from slightly below, which is the only angle a player
  // ever gets on this animal while it is healthy.
  await frame("02-crown", null, [16, -2, 0.6, 46, false]);

  // THE SCALE SHOT: a human eyeline at the foot of the needle. This is
  // the one that decides whether eighty metres reads as eighty metres.
  await frame("03-from-below", null, [46, 1.7, -18, 58, true]);

  /* Mid-arc, between two spires, at the top of the jump. Stopped at
     the measured apex rather than at a fixed time: the flight is
     longer for a longer jump, and which crown it picks is seeded, so
     any hard-coded duration photographs a different part of the arc
     every time the world changes.

     The lens sits well ABOVE the apex rather than level with it. The
     clearance chooser only knows about the seven crowns, and the
     district is full of mesas it has never heard of - a level shot at
     forty metres photographed a dune with the boss hidden behind it,
     while the projection reported centre-frame the whole time,
     because being inside the frustum and being visible are different
     questions. Looking down from above the tallest thing around is
     the one bearing no amount of azimuth search can get wrong. */
  await frame("04-leap", (T) => {
    T.forceStyliteLeap();
    let peak = -Infinity;
    for (let i = 0; i < 400; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      const s = T.styliteState();
      if (s.phase !== "leap") continue;
      if (s.y < peak) break;
      peak = s.y;
    }
  }, [46, 34, 0, 52, false]);

  // ...and the landing, absorbed on the next crown.
  await frame("05-land", (T) => {
    T.advanceTime(0.85, 1 / 60);
  }, [20, 3, 0, 50, false]);

  /* The stoop, caught on the way down - polled rather than timed, for
     the same reason the leap is, and shot from above for the same
     reason too. */
  await frame("06-stoop", (T) => {
    T.advanceToStylitePhase("perched", 12);
    T.forceStyliteStoop();
    const top = T.styliteState().y;
    for (let i = 0; i < 400; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      const s = T.styliteState();
      if (s.phase !== "stoop") break;
      if (s.y < top - 26) break;
    }
  }, [30, 22, 0, 56, false]);

  // Losing its grip: caught partway down the drop.
  await frame("07-falling", (T) => {
    T.resetStylite();
    T.teleportToStylite(48);
    T.advanceToStylitePhase("perched", 18);
    T.forceStyliteFall();
    T.advanceTime(0.62, 1 / 60);
  }, [26, 7, -8, 52, false]);

  // Down, stunned, in its own crater - the melee window.
  await frame("08-grounded", (T) => {
    T.advanceTime(1.9, 1 / 60);
  }, [18, 6, 0.5, 52, false]);

  // The same moment at a standing eyeline with a polearm out, which is
  // what the player is actually looking at when they cash the window in.
  await frame("09-window", (T) => {
    T.equipWeapon("glaive");
    T.advanceTime(0.3, 1 / 60);
  }, [7, 1.8, 0.4, 66, true]);

  console.log(`\nShots: ${OUT}`);
  await browser.close();
} finally {
  server.kill();
}
