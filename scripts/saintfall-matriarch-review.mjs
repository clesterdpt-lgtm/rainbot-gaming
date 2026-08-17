#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Matriarch review

   The boss, on FLAT ground, framed deliberately, and standing next
   to the things it has to be read against.

   Why this exists rather than `saintfall-bestiary-shots`: that
   harness frames one creature at a distance derived from its own
   bounding box, on whatever ground the review stage sits on. For a
   1.19m Thresher that is fine. For a ten-metre animal on a dune
   slope it puts half the creature behind the hill it is standing on
   and sizes the camera off a box that is mostly empty air, and the
   first three rounds of this build were argued about from pictures
   where the legs were occluded by sand.

   Two things it adds that matter for a boss specifically:

     A SCALE LINE. The Matriarch, a Harrow, a Gleaner and the trooper
     stood in a row at the same camera. A boss is only big relative
     to something, and "does it read as a boss" is not a question
     that can be answered from a picture of it alone.

     THE WEAK POINT, DRAWN. The gaster sphere from combat.js's
     HITBOX, rendered where the code actually puts it. A weak point
     that is not on the lit part of the model is a bug the player
     experiences as the boss being immune, and it is invisible in
     every ordinary render.

   Usage:
     node scripts/saintfall-matriarch-review.mjs
     node scripts/saintfall-matriarch-review.mjs --clip alert
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/matriarch");
const PORT = 49931;
const BASE = `http://127.0.0.1:${PORT}`;

const args = process.argv.slice(2);
const clipArg = args.includes("--clip") ? args[args.indexOf("--clip") + 1] : null;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE}/games/saintfall.html`); if (r.ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await mkdir(OUT, { recursive: true });

  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    T.hideHud(true);
    T.invulnerable(true);
    /* NOT `studio(true)`. It hides `enemies.group` - it exists to
       photograph the player alone - so the first pass of this script
       rendered five careful angles of empty desert and the model was
       blamed for it. */
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  // Flat ground, or the procedural legs splay downhill and every
  // measurement taken off the picture is measuring the dune.
  // Returns [x, z, relief] - an array, not an object.
  const [fx, fz, relief] = await page.evaluate(() => window.__SF.findFlatSite(14));
  const site = { x: fx, z: fz };
  console.log(`flat stage at ${fx.toFixed(1)}, ${fz.toFixed(1)} (relief ${relief}m)`);

  const grab = async (name) => {
    const url = await page.evaluate(() => window.__SF.captureDataURL());
    await writeFile(path.join(OUT, `${name}.png`),
      Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  };

  /* ---------------- the boss alone ---------------- */
  const info = await page.evaluate((s) => {
    const T = window.__SF;
    T.clearEnemies();
    T.hidePlayer(true);
    const inst = T.spawnEnemy("matriarch", s.x, s.z, { yaw: Math.PI * 0.5 });
    T.advanceTime(1.6, 1 / 60);
    return inst;
  }, site);
  console.log("spawned:", JSON.stringify(info));

  /* CAMERA DIRECTIONS ARE IN THE ANIMAL'S OWN FRAME, and the rotation
     below is the whole reason this comment exists. They used to be
     world vectors read against a boss spawned at yaw = PI/2, so every
     label in this harness was ninety degrees out: the picture called
     "front" was the animal's left flank and the one called "side" was
     its face. Three revisions of the raptorial fold were argued from
     that set, and the one view that would have shown the fold was the
     one nobody thought they were looking at.

     `yaw` stays PI/2 rather than being zeroed, because the sun is a
     world direction: turning the animal to suit the labels would have
     relit every picture and made this pass incomparable with the ones
     before it. Turning the CAMERAS costs nothing. */
  const views = [
    { id: "front", dir: [0, 0.12, 1], dist: 17, fov: 34, aim: 3.0 },
    { id: "threequarter", dir: [0.62, 0.16, 0.88], dist: 21, fov: 34, aim: 2.8 },
    { id: "side", dir: [1, 0.10, 0], dist: 22, fov: 34, aim: 2.6 },
    { id: "rear", dir: [0, 0.18, -1], dist: 19, fov: 34, aim: 2.4 },
    { id: "player-eye", dir: [0.55, 0.02, 0.84], dist: 11, fov: 62, aim: 1.7 },
    /* THE FOLD, close and low. Everything the forelimbs are for lives
       in a two-metre box in front of the chest, and at 21m with the
       whole eleven-metre animal in frame that box is ninety pixels
       wide. */
    { id: "fold", dir: [0.74, -0.05, 0.67], dist: 8.5, fov: 40, aim: 3.1 },
  ];

  const clips = clipArg ? [clipArg]
    : ["idle", "alert", "strike", "brood", "flinch", "death"];

  for (const clip of clips) {
    await page.evaluate((c) => window.__SF.playEnemyClip(c, 0), clip);
    // Far enough into the clip to be at its held pose, not its ramp.
    await page.evaluate(() => window.__SF.advanceTime(0.85, 1 / 60));
    for (const v of views) {
      if (clip !== "idle" && !["threequarter", "front", "fold"].includes(v.id)) continue;
      await page.evaluate(([s, spec]) => {
        const T = window.__SF;
        const g = T.groundHeightAt(s.x, s.z);
        const inst = T.ctx.enemies.live[0];
        const yaw = inst ? inst.yaw : 0;
        // Into the animal's frame: +z is the direction it faces.
        const sy = Math.sin(yaw);
        const cy = Math.cos(yaw);
        const d = [spec.dir[2] * sy + spec.dir[0] * cy, spec.dir[1],
          spec.dir[2] * cy - spec.dir[0] * sy];
        const n = Math.hypot(d[0], d[1], d[2]);
        T.lookAt(
          [s.x + (d[0] / n) * spec.dist, g + spec.aim + (d[1] / n) * spec.dist,
            s.z + (d[2] / n) * spec.dist],
          [s.x, g + spec.aim, s.z], spec.fov);
        for (let i = 0; i < 5; i += 1) T.renderStill();
      }, [site, v]);
      await grab(`${clip}-${v.id}`);
    }
    console.log(`  clip ${clip}`);
  }

  /* The fold, as numbers, next to the pictures of it. Written by
     `scripts/blender/saintfall-matriarch.py`; see `measure_fold` there
     for why a raptorial limb is a bad thing to review from renders
     alone. */
  try {
    const fold = JSON.parse(
      await readFile(path.join(root, "output/saintfall/models/matriarch.json"), "utf8"),
    ).fold;
    if (fold) {
      console.log("\n  the fold, per clip (authoring metres, Y-up):");
      for (const [name, f] of Object.entries(fold)) {
        console.log(`    ${name.padEnd(13)} hinge ${String(f.foldDeg).padStart(6)}deg`
          + ` · claw [${f.claw.join(", ")}]`
          + ` · ${f.clawAheadOfHead}m past the face · ${f.widestX}m outboard`);
      }
    }
  } catch (_) { /* the model report is optional */ }

  /* ---------------- the weak point, drawn ---------------- */
  const weak = await page.evaluate((s) => {
    const T = window.__SF;
    const THREE = T.THREE;
    const live = T.ctx.enemies.live[0];
    const box = T.ctx.combat.hitbox ? T.ctx.combat.hitbox.matriarch : null;
    if (!box || !box.weak || !live) return null;
    const sy = Math.sin(live.yaw);
    const cy = Math.cos(live.yaw);
    const p = new THREE.Vector3(live.x + sy * box.weak.z, live.y + box.weak.y,
      live.z + cy * box.weak.z);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(box.weak.r, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xff2fd0, wireframe: true,
        depthTest: false, toneMapped: false }));
    mesh.position.copy(p);
    mesh.renderOrder = 999;
    mesh.name = "weakpoint-debug";
    T.ctx.scene.add(mesh);
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), r: box.weak.r };
  }, site);
  if (weak) {
    console.log("weak point sphere at", JSON.stringify(weak));
    await page.evaluate((s) => window.__SF.playEnemyClip("alert", 0), site);
    await page.evaluate(() => window.__SF.advanceTime(0.9, 1 / 60));
    for (const v of [{ id: "weak-side", dir: [1, 0.12, 0], dist: 22, aim: 2.6 },
      { id: "weak-rear", dir: [0.35, 0.22, -1], dist: 17, aim: 2.2 }]) {
      await page.evaluate(([s, spec]) => {
        const T = window.__SF;
        const g = T.groundHeightAt(s.x, s.z);
        const d = spec.dir;
        const n = Math.hypot(d[0], d[1], d[2]);
        T.lookAt([s.x + (d[0] / n) * spec.dist, g + spec.aim + (d[1] / n) * spec.dist,
          s.z + (d[2] / n) * spec.dist], [s.x, g + spec.aim, s.z], 34);
        for (let i = 0; i < 5; i += 1) T.renderStill();
      }, [site, v]);
      await grab(v.id);
    }
    await page.evaluate(() => {
      const T = window.__SF;
      const m = T.ctx.scene.getObjectByName("weakpoint-debug");
      if (m) T.ctx.scene.remove(m);
    });
  } else {
    console.log("weak point: NOT DRAWN (no hitbox surfaced to QA)");
  }

  /* ---------------- the scale line ---------------- */
  await page.evaluate((s) => {
    const T = window.__SF;
    T.clearEnemies();
    // Spaced by their own widths so nothing overlaps, biggest first.
    T.spawnEnemy("matriarch", s.x - 9, s.z, { yaw: Math.PI * 0.5 });
    T.spawnEnemy("harrow", s.x + 4, s.z, { yaw: Math.PI * 0.5 });
    T.spawnEnemy("gleaner", s.x + 9, s.z, { yaw: Math.PI * 0.5 });
    T.spawnEnemy("thresher", s.x + 13, s.z, { yaw: Math.PI * 0.5 });
    T.hidePlayer(false);
    T.player.spawn(s.x + 16.5, s.z, Math.PI * 0.5);
    T.player.state.figureOverride = true;
    T.advanceTime(1.4, 1 / 60);
  }, site);
  await page.evaluate((s) => {
    const T = window.__SF;
    const g = T.groundHeightAt(s.x, s.z);
    T.lookAt([s.x + 3, g + 3.4, s.z + 42], [s.x + 3, g + 2.4, s.z], 40);
    for (let i = 0; i < 5; i += 1) T.renderStill();
  }, site);
  await grab("scale-line");

  const stats = await page.evaluate(() => window.__SF.report());
  console.log(`\nfps ${stats.fps} · frame ${stats.frameMs}ms · `
    + `enemies ${JSON.stringify(stats.enemies)}`);
  if (errors.length) console.error("page errors:", errors.slice(0, 4));
  console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
