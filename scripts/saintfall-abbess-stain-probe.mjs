#!/usr/bin/env node
/* ============================================================
   SAINTFALL - does the Abbess's ichor actually land?

   `stainGround` in abbess.js guards on `ctx.vfx?.scorchFx` and then
   draws through the shared ordnance scorch pool. For a long while
   vfx.js never EXPORTED `scorchFx`, so the guard took the early return
   and every ichor stain in the fight - egg bursts, sac hits, the death
   rupture - was a silent no-op with no error anywhere. This probe
   exists so that class of bug is caught by a check rather than by
   someone noticing the floor is clean.

   It drives the three production paths and asks, for each:
     - did a scorch slot go live near the event;
     - is its colour the brood tint and not the pool's soot default;
     - does hiding that one mesh change the pixels under it, i.e. does
       it DRAW, rather than merely exist.
   ...and it calls the primitive directly with a hex string and with a
   THREE.Color, since the pool's own callers use one and abbess.js the
   other.

   Usage:
     node scripts/saintfall-abbess-stain-probe.mjs [--out output/path]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((part) => part.trim().split(/\s+/)).map(([key, value]) => [key, value ?? true])
);
const outDir = path.resolve(root, args.out || "output/saintfall/abbess-stain-probe");
const port = 51900 + (process.pid % 6000);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

/* Mean absolute per-channel difference between two PNG buffers, the
   count of pixels that moved by more than a JND, and - when asked - a
   heat map of WHERE they moved, so a pass can be looked at. */
async function diffPng(a, b, heatPath = null) {
  const A = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = Math.min(A.data.length, B.data.length);
  const heat = heatPath ? Buffer.alloc(n) : null;
  let sum = 0;
  let moved = 0;
  for (let i = 0; i < n; i += 3) {
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1])
      + Math.abs(A.data[i + 2] - B.data[i + 2]);
    sum += d;
    if (d > 12) moved += 1;
    if (heat) {
      const v = Math.min(255, d * 4);
      heat[i] = v; heat[i + 1] = v >> 2; heat[i + 2] = v >> 1;
    }
  }
  if (heat) {
    await sharp(heat, { raw: { width: A.info.width, height: A.info.height, channels: 3 } })
      .png().toFile(heatPath);
  }
  return { mean: sum / (n || 1), moved, pixels: n / 3 };
}

try {
  await mkdir(outDir, { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
    window.__SF.hideHud(true);
    /* Every scorch slot in the shared pool, by its material name. The
       slot records themselves are private to vfx.js; the mesh is what
       we can see, and the mesh is what the player sees. */
    window.__stainProbe = {
      scorchMeshes() {
        const out = [];
        window.__SF.vfx.group.traverse((o) => {
          if (o.isMesh && o.material?.name === "sf-scorch") out.push(o);
        });
        return out;
      },
      live() {
        return this.scorchMeshes().filter((m) => m.visible).map((m) => {
          /* The disc's reach, read back off the vertices scorchFx laid,
             so a 14m rupture and a 2m weep can be told apart. */
          const p = m.geometry.attributes.position.array;
          let ext = 0;
          for (let i = 0; i < p.length; i += 3) {
            ext = Math.max(ext, Math.abs(p[i]), Math.abs(p[i + 2]));
          }
          return {
            x: Number(m.position.x.toFixed(2)),
            y: Number(m.position.y.toFixed(2)),
            z: Number(m.position.z.toFixed(2)),
            ext: Number(ext.toFixed(2)),
            opacity: Number(m.material.opacity.toFixed(3)),
            colour: [m.material.color.r, m.material.color.g, m.material.color.b]
              .map((c) => Number(c.toFixed(4))),
          };
        });
      },
      nearest(x, z) {
        let best = null;
        for (const s of this.live()) {
          const d = Math.hypot(s.x - x, s.z - z);
          if (!best || d < best.d) best = { ...s, d: Number(d.toFixed(2)) };
        }
        return best;
      },
    };
  });

  /* ---- THE EXPORT ------------------------------------------------------ */
  const api = await page.evaluate(() => {
    const T = window.__SF;
    const c = T.abbess.config;
    return {
      exported: typeof T.vfx.scorchFx === "function",
      arity: T.vfx.scorchFx?.length ?? -1,
      pool: window.__stainProbe.scorchMeshes().length,
      /* `stainGround` puts the mark at `terrain.heightAt`; the Abbess
         seats herself at `collide.groundHeight`. If those disagree at
         her lair the stain is buried or floating regardless of the
         export. */
      terrainY: Number(T.terrain.heightAt(c.lairX, c.lairZ).toFixed(3)),
      collideY: Number((T.collide?.groundHeight?.(c.lairX, c.lairZ) ?? NaN).toFixed(3)),
      defaultColour: (() => {
        const m = window.__stainProbe.scorchMeshes()[0];
        return [m.material.color.r, m.material.color.g, m.material.color.b]
          .map((v) => Number(v.toFixed(4)));
      })(),
    };
  });
  check("vfx exports scorchFx", api.exported, `arity ${api.arity}, pool of ${api.pool}`);
  check("the lair floor is the terrain the scorch conforms to",
    Number.isFinite(api.collideY) && Math.abs(api.terrainY - api.collideY) < 0.25,
    `terrain ${api.terrainY} vs collide ${api.collideY}`);

  /* ---- THE COLOUR ARGUMENT --------------------------------------------- */
  const colour = await page.evaluate(() => {
    const T = window.__SF;
    const c = T.abbess.config;
    const probe = window.__stainProbe;
    /* Well away from the lair, so the fight checks below never find
       these two by mistake. */
    const x = c.lairX + 60;
    const z = c.lairZ + 60;
    const byHex = T.vfx.scorchFx(x, z, 3, 4, "#2b1a12", 0.62);
    const hexColour = [byHex.mesh.material.color.r, byHex.mesh.material.color.g,
      byHex.mesh.material.color.b].map((v) => Number(v.toFixed(4)));
    /* A real THREE.Color, built the way abbess.js builds one - a
       working-space triple, not a style string. */
    const wine = probe.scorchMeshes()[0].material.color.clone()
      .setRGB(0.30, 0.0416, 0.084);
    const byColour = T.vfx.scorchFx(x + 8, z, 3, 4, wine, 0.5);
    const objColour = [byColour.mesh.material.color.r, byColour.mesh.material.color.g,
      byColour.mesh.material.color.b].map((v) => Number(v.toFixed(4)));
    const distinctSlots = byHex !== byColour;
    // Retire both so they cannot pollute the pool for the fight below.
    byHex.life = 0; byHex.mesh.visible = false;
    byColour.life = 0; byColour.mesh.visible = false;
    return { hexColour, objColour, distinctSlots, isColor: !!wine.isColor };
  });
  /* "#2b1a12" is sRGB (0.169, 0.102, 0.071); Color.set on a string
     linearises it, so the material must hold ~(0.024, 0.010, 0.006). */
  check("a hex string is read as sRGB and linearised",
    Math.abs(colour.hexColour[0] - 0.0242) < 0.004
      && Math.abs(colour.hexColour[1] - 0.0103) < 0.003
      && Math.abs(colour.hexColour[2] - 0.0060) < 0.003,
    `got ${colour.hexColour.join(", ")}`);
  check("a THREE.Color is copied as-is",
    colour.isColor
      && Math.abs(colour.objColour[0] - 0.30) < 1e-3
      && Math.abs(colour.objColour[1] - 0.0416) < 1e-3
      && Math.abs(colour.objColour[2] - 0.084) < 1e-3,
    `got ${colour.objColour.join(", ")}`);
  check("two calls take two slots", colour.distinctSlots);

  /* ---- EGG BURST ------------------------------------------------------- */
  const egg = await page.evaluate(() => {
    const T = window.__SF;
    const probe = window.__stainProbe;
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 20);
    T.forceAbbessClutch();
    T.advanceTime(1.0, 1 / 60);
    const aimed = T.abbessEggs()[0];
    if (!aimed) return { laid: false };
    const liveBefore = probe.live().length;
    const ps = T.player.state;
    T._teleportRaw(aimed.x - 16, aimed.z, 0);
    T.advanceTime(1 / 60, 1 / 60);
    const o = { x: ps.x, y: ps.y + 1.5, z: ps.z };
    const t = { x: aimed.x, y: aimed.y + 1.4, z: aimed.z };
    const d = Math.hypot(t.x - o.x, t.y - o.y, t.z - o.z);
    const eggsBefore = T.abbessEggs();
    T.combat.fire(o, { x: (t.x - o.x) / d, y: (t.y - o.y) / d, z: (t.z - o.z) / d },
      { damage: 60, range: 200 });
    /* THE ONE THAT DIED, not the one that was aimed at: a clutch is
       spread over several metres and the ray takes the first egg it
       crosses, which need not be `aimed`. */
    const eggsAfter = T.abbessEggs();
    const dead = eggsBefore.filter((b) => !eggsAfter.some((a) => a.x === b.x && a.z === b.z));
    const e = dead[0] || aimed;
    // One frame so updateOrdnance writes the opacity from `strength`.
    T.advanceTime(0.10, 1 / 60);
    const stain = probe.nearest(e.x, e.z);
    return {
      laid: true, killed: dead.length, liveBefore, liveAfter: probe.live().length,
      egg: { x: e.x, y: e.y, z: e.z }, stain,
      abbess: T.abbessState(),
    };
  });
  check("an egg was laid and shot", egg.laid && egg.killed >= 1, `${egg.killed} killed`);
  check("...and its burst put a scorch on the pool",
    egg.stain && egg.stain.d < 0.5 && egg.liveAfter > egg.liveBefore,
    egg.stain ? `${egg.stain.d}m from the egg, opacity ${egg.stain.opacity}` : "no live scorch");
  check("...tinted to the brood, not the pool's soot default",
    egg.stain && egg.stain.colour[0] > 0.2 && egg.stain.colour[0] > egg.stain.colour[1] * 3
      && Math.abs(egg.stain.colour[0] - api.defaultColour[0]) > 0.1,
    egg.stain ? `rgb ${egg.stain.colour.join(", ")} vs default ${api.defaultColour.join(", ")}` : "");
  check("...at the egg's own floor height",
    egg.stain && Math.abs(egg.stain.y - egg.egg.y) < 0.6,
    egg.stain ? `stain y ${egg.stain.y}, egg y ${egg.egg.y}` : "");

  /* Does it DRAW? Frame the burst site from above, let the blast motes
     settle, and compare the same still with the one mesh on and off. */
  /* Does it DRAW? The same still with the one mesh on and off, with the
     production loop HELD between the two shots - it ticks at about a
     frame a second in headless, and a mote drifting or the autosave
     toast fading between "on" and "off" would be counted as the stain.
     `advanceTime`/`renderStill` step through `api.step`, which is
     below the pause gate, so time here is entirely ours. */
  async function stainDraws(name, stain, settle, cam, fov, threshold) {
    await page.evaluate(([s, wait, c, f]) => {
      const T = window.__SF;
      /* Her chamber is a sunken pit and at golden hour it is nearly
         black; the stain is judged at noon, where the floor it sits on
         can actually be seen. The pass/fail is the on/off pixel diff,
         which does not care about the hour. */
      T.setTime("noon");
      T.advanceTime(wait, 1 / 60);
      T.ctx.runtime.paused = true;
      document.querySelectorAll("[data-autosave-toast]").forEach((el) => {
        el.style.visibility = "hidden";
      });
      T.lookAt([s.x + c[0], s.y + c[1], s.z + c[2]], [s.x, s.y, s.z], f);
      T.renderStill();
    }, [stain, settle, cam, fov]);
    const on = await page.screenshot({ path: path.join(outDir, `${name}-on.png`) });
    await page.evaluate((s) => {
      const T = window.__SF;
      for (const m of window.__stainProbe.scorchMeshes()) {
        if (Math.hypot(m.position.x - s.x, m.position.z - s.z) < 0.5) m.visible = false;
      }
      T.renderStill();
    }, stain);
    const off = await page.screenshot({ path: path.join(outDir, `${name}-off.png`) });
    await page.evaluate((s) => {
      const T = window.__SF;
      for (const m of window.__stainProbe.scorchMeshes()) {
        if (Math.hypot(m.position.x - s.x, m.position.z - s.z) < 0.5) m.visible = true;
      }
      T.ctx.runtime.paused = false;
      T.setTime("goldenhour");
    }, stain);
    const d = await diffPng(on, off, path.join(outDir, `${name}-diff.png`));
    return { ...d, ok: d.moved > d.pixels * threshold,
      detail: `${d.moved} px moved (${(100 * d.moved / d.pixels).toFixed(2)}%), mean ${d.mean.toFixed(3)}` };
  }

  if (egg.stain) {
    // Straight down from nine metres: the one angle at which a mark on
    // a cluttered pit floor is not behind a root.
    const d = await stainDraws("01-egg-stain", egg.stain, 3.5, [0.5, 9, 0.5], 50, 0.004);
    check("the egg stain changes pixels on the floor", d.ok, d.detail);
  }

  /* ---- SAC HIT --------------------------------------------------------- */
  const sac = await page.evaluate(() => {
    const T = window.__SF;
    const probe = window.__stainProbe;
    T.resetAbbess();
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 20);
    // Clear the ichor gate so the first shot is not swallowed by it.
    T.advanceTime(1.0, 1 / 60);
    const inst = T.enemies.live.find((e) => e.key === "abbess");
    const spine = inst.sacSpine;
    const mid = spine[Math.floor(spine.length / 2)];
    const o = { x: mid.x - 9, y: mid.y + 2, z: mid.z };
    const d = Math.hypot(mid.x - o.x, mid.y - o.y, mid.z - o.z);
    const liveBefore = probe.live().length;
    const hit = T.combat.fire(o,
      { x: (mid.x - o.x) / d, y: (mid.y - o.y) / d, z: (mid.z - o.z) / d },
      { damage: 40, range: 90 });
    T.advanceTime(0.10, 1 / 60);
    const stain = probe.nearest(mid.x, mid.z);
    /* The pool is five slots recycled stalest-first, and a magazine at
       ten rounds a second must NOT flood it: the gate is 0.85s. */
    const liveMid = probe.live().length;
    for (let i = 0; i < 12; i += 1) {
      T.combat.fire(o,
        { x: (mid.x - o.x) / d, y: (mid.y - o.y) / d, z: (mid.z - o.z) / d },
        { damage: 40, range: 90 });
      T.advanceTime(0.05, 1 / 60);
    }
    return {
      hit: !!hit, liveBefore, liveMid, liveAfterBurst: probe.live().length,
      mid: { x: mid.x, z: mid.z }, stain,
    };
  });
  check("a shot into the sac connects", sac.hit);
  check("...and weeps a scorch under the ring it struck",
    sac.stain && sac.stain.d < 3.0 && sac.liveMid > sac.liveBefore,
    sac.stain ? `${sac.stain.d}m from the ring, opacity ${sac.stain.opacity}` : "no live scorch");
  check("twelve rounds in 0.6s add at most one more stain (rate limit holds)",
    sac.liveAfterBurst - sac.liveMid <= 1,
    `${sac.liveMid} -> ${sac.liveAfterBurst} live`);

  /* ---- DEATH RUPTURE --------------------------------------------------- */
  const death = await page.evaluate(() => {
    const T = window.__SF;
    const probe = window.__stainProbe;
    T.resetAbbess();
    T.teleportToAbbess(40);
    T.advanceToAbbessPhase("seated", 20);
    const inst = T.enemies.live.find((e) => e.key === "abbess");
    const c = T.abbess.config;
    T.combat.damageEnemy(inst, 999999, { source: "qa" });
    T.advanceTime(0.10, 1 / 60);
    const s = T.abbessState();
    /* The death stain sits under the MIDDLE of the sac, not on the lair
       origin: `stainGround` puts it 0.45 of the abdomen back along the
       sac's own yaw, which is state and not the seat's config yaw.
       Looking it up by nearest-to-lair finds the sac-hit weep from the
       section above instead, still alive and 1.5m away - so it is
       identified as the one 14m disc in the pool, and its distance
       from the lair is what is checked. */
    const big = probe.live().filter((m) => m.ext > 12)
      .map((m) => ({ ...m, d: Number(Math.hypot(m.x - c.lairX, m.z - c.lairZ).toFixed(2)) }));
    const stain = big[0] || null;
    return {
      phase: s?.phase, stain, bigCount: big.length,
      wantD: Number((c.abdomenLength * 0.45).toFixed(2)),
    };
  });
  check("lethal damage kills her", death.phase === "dead", `phase ${death.phase}`);
  check("...and the rupture leaves ONE 14m stain, under the middle of the sac",
    death.stain && death.bigCount === 1 && Math.abs(death.stain.d - death.wantD) < 1.0
      && death.stain.opacity > 0,
    death.stain
      ? `${death.bigCount} big disc(s); ${death.stain.d}m from the lair (want ${death.wantD}), reach ${death.stain.ext}m, opacity ${death.stain.opacity}`
      : "no live scorch");
  /* `stainGround` reads `broodColour()` at the moment it is called, so
     the rupture is tinted with the light she DIED with - rolled off the
     red toward the sick ochre - not the one she woke with. */
  check("...tinted with the sick brood light, not the healthy one",
    death.stain && egg.stain && death.stain.colour[1] > egg.stain.colour[1] * 2
      && death.stain.colour[0] < egg.stain.colour[0],
    death.stain ? `rgb ${death.stain.colour.join(", ")} vs healthy ${egg.stain?.colour.join(", ")}` : "");

  if (death.stain) {
    const d = await stainDraws("02-death-stain", death.stain, 4.0, [14, 16, 14], 55, 0.01);
    check("the death stain changes pixels on the chamber floor", d.ok, d.detail);

    /* And the frame a player would see: from behind the trooper's
       shoulder height, at the hour the level is composed for, with the
       whole animal in view. Not a check - a picture, for the question
       "does it read as a stain or as glowing paint" that no number
       here answers. */
    await page.evaluate((s) => {
      const T = window.__SF;
      T.setTime("goldenhour");
      T.lookAt([s.x + 22, s.y + 9, s.z + 4], [s.x, s.y + 1, s.z], 58);
      T.renderStill();
    }, death.stain);
    await page.screenshot({ path: path.join(outDir, "03-death-stain-goldenhour.png") });
  }

  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  await writeFile(path.join(outDir, "results.json"),
    JSON.stringify({ results, api, colour, egg, sac, death }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} passed. Shots: ${outDir}`);
  await browser.close();
  process.exitCode = failed ? 1 : 0;
} finally {
  server.kill();
}
