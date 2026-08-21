#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Coulter, photographed

   Four questions this answers that no assertion can:

     1. does the ANIMAL read - as a burrower, as a relative of the
        brood, and as something with a front and a back;
     2. does the arch it makes when it rears read as one body, or as a
        row of chunks that happen to be adjacent;
     3. does the wake read as something arriving, from a player's own
        eye height rather than from a review camera;
     4. is the venom the only green in the frame.

   Usage:  node scripts/saintfall-coulter-shots.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/coulter-shots");
const PORT = 49943;
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
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
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
      for (let i = 0; i < 4; i += 1) window.__SF.renderStill();
      return window.__SF.captureDataURL();
    });
    await writeFile(path.join(OUT, file),
      Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    console.log(`  wrote ${file}`);
  };

  /* ---- the animal, laid out straight and fully above the sand ----
     Not a pose it is ever in during play, and that is the point: this
     is the sheet that shows whether the geometry itself is right,
     before the solver has had a chance to be blamed for it. */
  console.log("\nlaid out straight");
  const straight = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.clearVenom?.();
    const site = T.findFlatSite(30);
    T.spawnEnemy("coulter", site[0], site[1], { yaw: 0 });
    const inst = T.ctx.enemies.live[0];
    /* Lifted clear of the HIGHEST sand under its whole length, not just
       under its mouth: a flat site is flat where it was measured, and a
       twenty-five metre animal laid along a level line from one runs
       most of itself into the next dune. */
    let ground = T.groundHeightAt(site[0], site[1]);
    for (let d = 0; d <= inst.spineLength + 2; d += 1.5) {
      ground = Math.max(ground, T.groundHeightAt(site[0], site[1] - d));
    }
    // Then parked, or it starts hunting and dives out of the frame.
    T.parkCoulter(true);
    T.ctx.enemies.seedBody(inst, site[0], ground + 1.7, site[1], 0);
    T.advanceTime(0.05, 1 / 60);
    return { site, ground, span: inst.spineLength };
  });
  const look = async (dx, dy, dz, tx, ty, tz, fov = 40) => {
    await page.evaluate(([a, b, f]) => window.__SF.lookAt(a, b, f),
      [[dx, dy, dz], [tx, ty, tz], fov]);
  };
  const [sx, sz] = straight.site;
  const gy = straight.ground;
  // The animal runs from (sx, sz) forward along -Z, so its middle is
  // about twelve metres back.
  await look(sx + 34, gy + 9, sz - 11, sx, gy + 1.4, sz - 11, 42);
  await grab("01-broadside.png");
  await look(sx + 0.6, gy + 1.9, sz + 11, sx, gy + 1.6, sz + 0.4, 36);
  await grab("02-head-on.png");
  await look(sx + 13, gy + 6.5, sz + 9, sx - 1, gy + 1.2, sz - 5, 40);
  await grab("03-three-quarter.png");
  await look(sx + 6, gy + 4.0, sz - 20, sx, gy + 1.2, sz - 9, 40);
  await grab("04-tail.png");

  /* ---- the mouth open ---- */
  console.log("\nthe maw");
  await page.evaluate(() => {
    const T = window.__SF;
    // Held at the launch frame, which is the frame the weak point is
    // live on and therefore the one the player has to recognise.
    T.freezeEnemyClip("spew", 0.30, 0);
    for (let i = 0; i < 3; i += 1) T.renderStill();
  });
  await look(sx + 1.4, gy + 2.4, sz + 7.5, sx, gy + 1.5, sz + 0.6, 34);
  await grab("05-maw-open.png");
  await look(sx + 5.5, gy + 3.4, sz + 6.5, sx - 0.5, gy + 1.4, sz - 1.5, 40);
  await grab("05b-maw-quarter.png");

  /* ---- reared, in the real fight ---- */
  console.log("\nthe crest");
  const crest = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const site = T.findFlatSite(26);
    T.spawnEnemy("coulter", site[0], site[1] - 40, { yaw: 0 });
    T.player.spawn(site[0], site[1], Math.PI);
    T.autoPlayer();
    T.hidePlayer(true);
    const waited = T.advanceToCoulterPhase("crest", 60);
    T.advanceTime(0.9, 1 / 60);
    const b = T.coulterBodies()[0];
    return { waited, b, site, ground: T.groundHeightAt(b.head[0], b.head[2]) };
  });
  const hx = crest.b.head[0];
  const hy = crest.b.head[1];
  const hz = crest.b.head[2];
  // Close, and low enough to see the arch against the sky rather than
  // against the dune it came out of.
  await look(hx + 20, crest.ground + 4.5, hz + 15, hx - 2, hy - 3.5, hz - 6, 46);
  await grab("06-crest.png");
  await look(hx + 3, crest.ground + 1.62, hz + 13, hx, hy - 1.5, hz, 58);
  await grab("07-crest-eyeline.png");
  await look(hx + 42, crest.ground + 16, hz + 30, hx - 4, hy - 6, hz - 10, 40);
  await grab("07b-crest-wide.png");

  /* ---- the wake, from the ground ----

     THE DEPTH IS PINNED AND THE CAMERA IS PLACED OFF THE HEAD, and
     both of those are corrections to plates that were quietly worth
     nothing for two milestones.

     Letting the animal hunt to reach `burrow` puts it wherever the
     terrain takes it: these plates were shot at seventy-four metres of
     depth - twice the depth the ridge is even allowed to draw at - so
     all three were photographs of empty sand and nobody noticed. And
     a camera parked on a fixed mark cannot hold a subject crossing
     thirteen metres of ground a second, so even at the right depth it
     photographed the sand before the animal arrived. */
  console.log("\nthe wake");
  const wake = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const site = T.findFlatSite(30);
    const startZ = site[1] + 42;
    T.spawnEnemy("coulter", site[0], startZ, { yaw: 0 });
    const inst = T.ctx.enemies.live[0];
    T.ctx.enemies.seedBody(inst, site[0],
      T.groundHeightAt(site[0], startZ) - 16, startZ, Math.PI);
    inst.body.phase = "burrow";
    // Parked well above zero so it cannot decide to erupt mid-take.
    inst.body.timer = 999;
    T.player.spawn(site[0], site[1] - 200, Math.PI);
    T.hidePlayer(true);
    // Long enough for the furrow's ring buffer to fill: a wake with no
    // history behind it is not the wake anyone ever sees.
    T.advanceTime(3.1, 1 / 60);
    inst.body.timer = 999;
    const b = T.coulterBodies()[0];
    return { b, depth: +(T.groundHeightAt(b.head[0], b.head[2]) - b.head[1]).toFixed(2),
      visible: (T.ctx.coulter.group.children || [])
        .filter((c) => c.name?.startsWith("sf-wake") && c.visible).length };
  });
  console.log(`  hunting at ${wake.depth}m depth · ${wake.visible} ridge drawn`);
  if (!wake.visible) errors.push("the wake is not drawing at hunting depth");
  {
    const [hx, , hz] = wake.b.head;
    const yaw = wake.b.heading;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const gy = await page.evaluate(([x, z]) => window.__SF.groundHeightAt(x, z), [hx, hz]);
    /* Offsets in the ANIMAL's frame - right, up, behind - so each
       plate frames the same thing whichever way it happens to be
       pointing when the take starts. */
    const from = async (right, up, behind, aim, fov) => {
      const cx = hx + rx * right - fx * behind;
      const cz = hz + rz * right - fz * behind;
      const cy = await page.evaluate(([x, z]) => window.__SF.groundHeightAt(x, z), [cx, cz]);
      await look(cx, Math.max(gy, cy) + up, cz,
        hx + fx * aim, gy + 0.9, hz + fz * aim, fov);
    };
    // Across the line of sight, which is how a player meets one: a
    // ridge coming at you, not one running away from you.
    await from(30, 4.5, 0, 0, 46);
    await grab("08-wake-eyeline.png");
    await from(15, 11, 6, -10, 52);
    await grab("09-wake-above.png");
    await from(16, 2.2, 70, 10, 40);
    await grab("09b-wake-far.png");
  }

  /* ---- venom ---- */
  console.log("\nvenom");
  const venom = await page.evaluate(() => {
    const T = window.__SF;
    const ps = T.playerState();
    T.clearVenom();
    for (let i = 0; i < 4; i += 1) {
      T.spillVenom(ps.x - 6 + i * 4.5, ps.z - 9 - i * 3.2);
    }
    T.advanceTime(1.2, 1 / 60);
    return { ps: [ps.x, ps.y, ps.z], pools: T.venomPools() };
  });
  {
    const [px, py, pz] = venom.ps;
    // Looking DOWN on the ground the venom denies, which is the read
    // that matters: the player has to see where they cannot stand.
    await look(px + 4, py + 9, pz + 12, px + 1, py, pz - 8, 52);
    await grab("10-venom.png");
    await look(px + 1, py + 1.62, pz + 4, px + 1, py + 0.2, pz - 9, 58);
    await grab("10b-venom-eyeline.png");
  }

  console.log(errors.length ? `\nERRORS: ${errors.slice(0, 4).join(" | ")}`
    : "\nno console errors");
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
} finally {
  server.kill("SIGTERM");
}
