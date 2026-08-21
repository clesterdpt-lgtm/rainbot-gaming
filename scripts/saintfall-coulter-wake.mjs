#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Coulter's wake, photographed while it MOVES

   The existing coulter sheet (saintfall-coulter-shots.mjs) reaches
   the burrow phase by letting the animal hunt, and the animal hunts
   under dunes: its "wake" plates were shot at seventy-four metres of
   depth, which is well past the depth the ridge is allowed to draw
   at, so all three of them are photographs of empty sand. Nothing
   about the wake has ever actually been reviewed.

   This one PINS the depth. The burrower is put on flat ground, held
   in `burrow` with a timer it cannot run out of, and walked across
   the frame while the camera holds still - so the sheet is a strip of
   consecutive frames rather than one pose, because the complaint
   being answered ("the sand moving is not convincing", "the dust
   looks like sparks") is about MOTION and a single still cannot show
   it.

   Usage:  node scripts/saintfall-coulter-wake.mjs [--tag before]
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const tagArg = process.argv.indexOf("--tag");
const TAG = tagArg > 0 ? process.argv[tagArg + 1] : "now";
const OUT = path.join(root, "output/saintfall/coulter-wake", TAG);
const PORT = 49947;
const BASE = `http://127.0.0.1:${PORT}`;

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
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await mkdir(OUT, { recursive: true });
  await page.evaluate(() => {
    window.__SF.maximize();
    window.__SF.hideHud(true);
    window.__SF.invulnerable(true);
    window.__SF.hidePlayer(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  const grab = async (file) => {
    const url = await page.evaluate(() => {
      for (let i = 0; i < 3; i += 1) window.__SF.renderStill();
      return window.__SF.captureDataURL();
    });
    await writeFile(path.join(OUT, file),
      Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  };

  /* ---- set the animal running along a straight, flat line ----
     Seeded pointing at -Z from a flat site, then held in `burrow`
     with its timer parked well above zero every frame so it never
     decides to erupt out of the middle of the take. */
  const setup = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.clearVenom?.();
    const site = T.findFlatSite(30);
    // Start it well behind the camera's mark so it arrives, rather
    // than being already on top of it at frame one.
    const startZ = site[1] + 46;
    T.spawnEnemy("coulter", site[0], startZ, { yaw: 0 });
    const inst = T.ctx.enemies.live[0];
    const ground = T.groundHeightAt(site[0], startZ);
    T.ctx.enemies.seedBody(inst, site[0], ground - 16, startZ, Math.PI);
    inst.body.phase = "burrow";
    inst.body.timer = 999;
    // Aim it at a point far along -Z so `headTarget` walks it straight
    // through the frame instead of circling whatever it woke up near.
    T.player.spawn(site[0], site[1] - 120, Math.PI);
    T.hidePlayer(true);
    return { site, startZ, ground };
  });
  const [cx] = setup.site;
  const cz = setup.site[1];
  const gy = setup.ground;

  /* Two seconds of run-up so the trail, the furrow decals and the
     particle pool are all in the state a player would ever see them
     in - a wake photographed on its first frame has no history behind
     it and reads better than the real thing. */
  const settle = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live[0];
    inst.body.timer = 999;
    T.advanceTime(2.5, 1 / 60);
    inst.body.timer = 999;
    const b = T.coulterBodies()[0];
    return { head: b.head, phase: b.phase,
      depth: +(T.groundHeightAt(b.head[0], b.head[2]) - b.head[1]).toFixed(2) };
  });
  console.log(`  hunting at ${settle.depth}m depth, head z=${settle.head[2].toFixed(1)}`);

  /* ---- the strip ----
     The camera is placed off the HEAD each frame rather than parked
     on a mark. A fixed camera was tried first and it is a trap: the
     animal covers thirteen metres a second, so any framing that holds
     still either photographs it before it arrives or after it has
     gone - which is how the original sheet ended up with three plates
     of empty sand. Offsets are in the animal's own frame (right, up,
     behind) so "eyeline" means eyeline no matter which way it is
     pointing. */
  const shots = [
    { id: "eye", name: "eyeline", off: [9, 1.62, 26], at: [0, 0.9, 2], fov: 55 },
    { id: "high", name: "above", off: [16, 14, 20], at: [0, 0, 0], fov: 50 },
    { id: "top", name: "overhead", off: [1, 46, 8], at: [0, 0, -6], fov: 44 },
    { id: "far", name: "far", off: [16, 1.62, 62], at: [0, 1.2, 8], fov: 42 },
    { id: "back", name: "from ahead", off: [4, 3.2, -30], at: [0, 0.6, 4], fov: 50 },
  ];
  for (const shot of shots) {
    console.log(`\n${shot.name}`);
    await page.evaluate(([sx, sz]) => {
      const T = window.__SF;
      const inst = T.ctx.enemies.live[0];
      const ground = T.groundHeightAt(sx, sz);
      T.ctx.enemies.seedBody(inst, sx, ground - 16, sz, Math.PI);
      inst.body.phase = "burrow";
      inst.body.timer = 999;
      // Long enough for the furrow's ring buffer to fill: a wake with
      // no history behind it is not the wake anyone ever sees.
      T.advanceTime(5.0, 1 / 60);
      inst.body.timer = 999;
    }, [cx, setup.startZ]);
    for (let f = 0; f < 6; f += 1) {
      const at = await page.evaluate(([off, aim, fov]) => {
        const T = window.__SF;
        const inst = T.ctx.enemies.live[0];
        inst.body.timer = 999;
        T.advanceTime(0.18, 1 / 60);
        const b = T.coulterBodies()[0];
        const [hx, , hz] = b.head;
        const g = T.groundHeightAt(hx, hz);
        // The animal's own axes: forward is (sin, cos) of heading.
        const fx = Math.sin(b.heading);
        const fz = Math.cos(b.heading);
        const rx = Math.cos(b.heading);
        const rz = -Math.sin(b.heading);
        /* Camera height is measured off the ground UNDER THE CAMERA,
           not under the animal. Taken off the animal's ground it puts
           an eyeline shot inside whatever dune happens to be twenty
           metres behind the subject, which is a photograph of the
           inside of a heightfield. */
        const camX = hx + rx * off[0] - fx * off[2];
        const camZ = hz + rz * off[0] - fz * off[2];
        const cam = [camX, Math.max(g, T.groundHeightAt(camX, camZ)) + off[1], camZ];
        const tgt = [hx + rx * aim[0] + fx * aim[2], g + aim[1], hz + rz * aim[0] + fz * aim[2]];
        T.lookAt(cam, tgt, fov);
        return { z: +hz.toFixed(1), depth: +(g - b.head[1]).toFixed(1) };
      }, [shot.off, shot.at, shot.fov]);
      await grab(`${shot.id}-${f}.png`);
      if (f === 0) console.log(`  head z=${at.z} depth=${at.depth}m`);
    }
    console.log(`  wrote ${shot.id}-0..5.png`);
  }

  /* ---- the eruption, which is the other half of the complaint ----
     `beginRise` only fires when the animal is inside `riseRange` of
     its target, so the player has to be moved in front of it or the
     take is six frames of a burrower politely continuing to burrow. */
  console.log("\nbreach");
  await page.evaluate(([sx, sz]) => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live[0];
    const ground = T.groundHeightAt(sx, sz);
    T.ctx.enemies.seedBody(inst, sx, ground - 16, sz, Math.PI);
    inst.body.phase = "burrow";
    inst.body.timer = 999;
    T.player.spawn(sx, sz - 34, Math.PI);
    T.hidePlayer(true);
    T.advanceTime(1.4, 1 / 60);
    inst.body.timer = 0;
  }, [cx, cz + 20]);
  for (let f = 0; f < 8; f += 1) {
    const at = await page.evaluate(() => {
      const T = window.__SF;
      T.advanceTime(0.14, 1 / 60);
      const b = T.coulterBodies()[0];
      const [hx, , hz] = b.head;
      const g = T.groundHeightAt(hx, hz);
      const fx = Math.sin(b.heading);
      const fz = Math.cos(b.heading);
      const rx = Math.cos(b.heading);
      const rz = -Math.sin(b.heading);
      const camX = hx + rx * 30 - fx * 14;
      const camZ = hz + rz * 30 - fz * 14;
      T.lookAt([camX, Math.max(g, T.groundHeightAt(camX, camZ)) + 6, camZ],
        [hx, g + 6, hz], 52);
      return b.phase;
    });
    await grab(`breach-${f}.png`);
    if (f === 0) console.log(`  phase ${at}`);
  }
  console.log("  wrote breach-0..7.png");

  /* ---- does the ridge change any pixels ----

     The same frame with the furrow mesh drawn and not drawn. This
     exists because reading a screenshot and deciding "the wake looks
     invisible" was wrong three times during m104 - twice the subject
     was behind a dune and once it was off frame entirely - and
     because the plates it replaced were literally empty sand that
     four eyes had signed off on. Anything the eye can find has to
     change pixels first, and the number says so without an opinion. */
  console.log("\nthe ridge, measured");
  await page.evaluate(([sx, sz]) => {
    const T = window.__SF;
    const inst = T.ctx.enemies.live[0];
    T.ctx.enemies.seedBody(inst, sx, T.groundHeightAt(sx, sz) - 16, sz, Math.PI);
    inst.body.phase = "burrow";
    inst.body.timer = 999;
    T.player.spawn(sx, sz - 200, Math.PI);
    T.hidePlayer(true);
    // Arrives ON the flat site rather than running past it.
    T.advanceTime(3.1, 1 / 60);
    inst.body.timer = 999;
  }, [cx, cz + 42]);

  const plates = [
    { id: "d-side", off: [30, 4.5, 0], at: [0, 0.9, 0], fov: 46 },
    { id: "d-q34", off: [26, 9, 22], at: [0, 0.4, -6], fov: 48 },
    { id: "d-near", off: [15, 11, 6], at: [0, 0.4, -10], fov: 52 },
  ];
  for (const plate of plates) {
    const shoot = (hide) => page.evaluate(([off, aim, fov, h]) => {
      const T = window.__SF;
      const b = T.coulterBodies()[0];
      const [hx, , hz] = b.head;
      const g = T.groundHeightAt(hx, hz);
      const fx = Math.sin(b.heading);
      const fz = Math.cos(b.heading);
      const rx = Math.cos(b.heading);
      const rz = -Math.sin(b.heading);
      const camX = hx + rx * off[0] - fx * off[2];
      const camZ = hz + rz * off[0] - fz * off[2];
      T.lookAt([camX, Math.max(g, T.groundHeightAt(camX, camZ)) + off[1], camZ],
        [hx + rx * aim[0] + fx * aim[2], g + aim[1], hz + rz * aim[0] + fz * aim[2]], fov);
      const wake = (T.ctx.coulter.group.children || [])
        .filter((c) => c.name?.startsWith("sf-wake"));
      for (const m of wake) m.visible = !h;
      for (let i = 0; i < 3; i += 1) T.renderStill();
      const url = T.captureDataURL();
      for (const m of wake) m.visible = true;
      return url;
    }, [plate.off, plate.at, plate.fov, hide]);
    const on = await shoot(false);
    const off = await shoot(true);
    await writeFile(path.join(OUT, `${plate.id}-on.png`),
      Buffer.from(on.slice(on.indexOf(",") + 1), "base64"));
    await writeFile(path.join(OUT, `${plate.id}-off.png`),
      Buffer.from(off.slice(off.indexOf(",") + 1), "base64"));
    const stat = await page.evaluate(([a, b]) => new Promise((res) => {
      const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
      Promise.all([load(a), load(b)]).then(([ia, ib]) => {
        const c = document.createElement("canvas");
        c.width = ia.width; c.height = ia.height;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.drawImage(ia, 0, 0);
        const A = x.getImageData(0, 0, c.width, c.height).data;
        x.clearRect(0, 0, c.width, c.height);
        x.drawImage(ib, 0, 0);
        const B = x.getImageData(0, 0, c.width, c.height).data;
        let n = 0; let sum = 0;
        for (let i = 0; i < A.length; i += 4) {
          const d = (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1])
            + Math.abs(A[i + 2] - B[i + 2])) / 3;
          if (d > 2) { n += 1; sum += d; }
        }
        res({ pct: +(100 * n / (A.length / 4)).toFixed(1),
          mean: +(sum / Math.max(1, n)).toFixed(1) });
      });
    }), [on, off]);
    console.log(`  ${plate.id.padEnd(7)} changes ${String(stat.pct).padStart(5)}% of the frame `
      + `· mean |delta| ${stat.mean}`);
    if (stat.pct < 8) errors.push(`${plate.id}: the ridge barely changes the frame`);
  }

  console.log(errors.length ? `\nERRORS: ${errors.slice(0, 4).join(" | ")}`
    : "\nno console errors");
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
} finally {
  server.kill("SIGTERM");
}
