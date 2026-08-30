#!/usr/bin/env node
/* ============================================================
   SAINTFALL - dying, checked and photographed

   Two things this covers, both of which are invisible to every other
   harness because both are about where a body ENDS UP:

     1. A corpse must come to rest ON the sand. Death clips in this
        bestiary only rotate bones, so a creature that dies on tall
        legs folds them and stays exactly where they were holding it -
        a Gleaner was left hanging a metre in the air.

     2. The trooper must fall over. Player death was a full stop: the
        figure stood upright and rigid for the whole respawn timer.

   Usage:  node scripts/saintfall-death-shots.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/death");
const PORT = 49963;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const findings = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) findings.push(label);
};

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
  const ours = (t) => !/fonts\.gstatic|fonts\.googleapis|jsdelivr|unpkg/.test(t);
  page.on("pageerror", (e) => { if (ours(e.message)) errors.push(e.message); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text().slice(0, 200);
    if (!ours(text) || /Failed to load resource/.test(text)) return;
    errors.push(text);
  });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await mkdir(OUT, { recursive: true });
  await page.evaluate(() => {
    window.__SF.maximize();
    window.__SF.hideHud(true);
    window.__SF.invulnerable(true);
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
    console.log(`  wrote ${file}`);
  };

  /* ---------------- corpses ---------------- */
  console.log("\n=== WHERE A CORPSE COMES TO REST ===");
  const rest = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const out = {};
    for (const key of ["thresher", "gleaner", "harrow", "matriarch"]) {
      T.clearEnemies();
      const site = T.findFlatSite(18);
      T.spawnEnemy(key, site[0], site[1], { yaw: 0 });
      T.player.spawn(site[0], site[1] + 60, Math.PI);
      T.hidePlayer(true);
      T.advanceTime(1.2, 1 / 60);
      const inst = T.ctx.enemies.live[0];
      let mesh = null;
      inst.root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
      const ground = T.groundHeightAt(inst.x, inst.z);
      /* The BODY, not the lowest claw. A corpse is judged by where its
         mass sits: a quarter of the mesh below the sand is a body that
         has fallen into it, and a body whose lowest quarter is all
         above the sand is a body hanging in the air. */
      const profile = () => {
        inst.root.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        const n = mesh.geometry.attributes.position.count;
        const ys = new Float64Array(n);
        for (let i = 0; i < n; i += 1) {
          mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
          ys[i] = v.y - ground;
        }
        ys.sort();
        const at = (p) => +ys[Math.min(n - 1, Math.floor(n * p))].toFixed(3);
        return { min: at(0), p05: at(0.05), p25: at(0.25), median: at(0.5) };
      };
      const alive = profile();
      T.ctx.combat.damageEnemy(inst, 1e7, { source: "probe" });
      T.advanceTime(5, 1 / 60);
      out[key] = {
        alive, dead: profile(), site,
        settle: +(inst.deathSettle || 0).toFixed(3),
        clip: +(inst.deathSeconds || 0).toFixed(2),
      };
    }
    return out;
  });
  for (const [key, r] of Object.entries(rest)) {
    console.log(`  ${key.padEnd(10)} settle ${String(r.settle).padStart(7)}m over `
      + `${r.clip}s · dead body: p05 ${r.dead.p05} p25 ${r.dead.p25} `
      + `median ${r.dead.median}`);
    check(r.dead.p05 <= 0.12,
      `a dead ${key} is not hanging in the air`,
      `its lowest 5% sits at ${r.dead.p05}m above the sand`);
    check(r.dead.median > -0.35,
      `a dead ${key} is not buried in the sand`,
      `half of it is below ${r.dead.median}m`);
  }

  /* One picture per species, from low down where a float is obvious. */
  for (const [key, r] of Object.entries(rest)) {
    await page.evaluate(([k, site]) => {
      const T = window.__SF;
      T.clearEnemies();
      T.spawnEnemy(k, site[0], site[1], { yaw: 0 });
      T.player.spawn(site[0], site[1] + 60, Math.PI);
      T.hidePlayer(true);
      T.advanceTime(1.0, 1 / 60);
      T.ctx.combat.damageEnemy(T.ctx.enemies.live[0], 1e7, { source: "probe" });
      T.advanceTime(5, 1 / 60);
      const inst = T.ctx.enemies.live[0];
      const reach = k === "matriarch" ? 17 : k === "gleaner" ? 9 : 7;
      const ground = T.groundHeightAt(inst.x, inst.z);
      T.lookAt([inst.x + reach, ground + 1.35, inst.z + reach],
        [inst.x, ground + 0.5, inst.z], 46);
    }, [key, r.site]);
    await grab(`corpse-${key}.png`);
  }

  /* ---------------- the trooper ---------------- */
  console.log("\n=== THE TROOPER'S OWN DEATH ===");
  const fall = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.releaseCamera();
    /* The corpse passes above leave debris state behind: their
       subjects get a live second to fight back (which can kill the
       probe - and death no longer clears itself, m101) and the last
       screenshot leaves the free camera on. A dead-or-freecam start
       made hurtPlayer a no-op here and every fall check measured a
       statue: pre-existing on the old tree too, where auto-respawn
       happened to hide it on some runs. Start from a living trooper. */
    if (T.ctx.combat.player.dead) T.ctx.combat.respawn();
    const site = T.findFlatSite(20);
    T.player.spawn(site[0], site[1], Math.PI);
    T.autoPlayer();
    T.hidePlayer(false);
    T.advanceTime(0.6, 1 / 60);
    const head = () => {
      const f = T.figureNodes();
      const node = f.head || f.chest || f.root;
      node.updateWorldMatrix(true, false);
      const p = new T.THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
      return { y: +(p.y - T.groundHeightAt(p.x, p.z)).toFixed(3),
        away: +Math.hypot(p.x - T.playerState().x, p.z - T.playerState().z).toFixed(3) };
    };
    const standing = head();
    T.invulnerable(false);
    T.ctx.combat.hurtPlayer(9999, { source: "probe" });
    const frames = [];
    for (let i = 0; i < 20; i += 1) {
      T.advanceTime(0.1, 1 / 60);
      frames.push({ t: +((i + 1) * 0.1).toFixed(1), ...head(),
        dead: T.ctx.combat.player.dead, action: T.ctx.player.state.deathPose });
    }
    const fallen = head();
    /* No auto-respawn any more (m101): running well past the old 3.4s
       timer must leave the body down and the death screen up. Reviving
       is the save system's job, so that is what this probe does - the
       same combat.respawn primitive a loaded record ends in. */
    T.advanceTime(2.2, 1 / 60);
    const held = { ...head(), dead: T.ctx.combat.player.dead,
      deathScreen: !document.querySelector("[data-death]")?.hidden };
    T.ctx.combat.respawn();
    T.player.spawn(site[0], site[1], Math.PI);
    T.advanceTime(0.6, 1 / 60);
    const respawned = { ...head(), dead: T.ctx.combat.player.dead,
      deathScreen: !document.querySelector("[data-death]")?.hidden };
    T.invulnerable(true);
    return { site, standing, frames, fallen, held, respawned };
  });
  console.log(`  head height: standing ${fall.standing.y}m -> fallen `
    + `${fall.fallen.y}m -> respawned ${fall.respawned.y}m`);
  console.log(`  head travel from the feet: ${fall.standing.away}m -> ${fall.fallen.away}m`);
  check(fall.fallen.y < fall.standing.y * 0.55,
    "the trooper goes down when killed",
    `head at ${fall.fallen.y}m against ${fall.standing.y}m standing`);
  check(fall.fallen.away > fall.standing.away + 0.4,
    "and topples rather than sinking straight down",
    `head ends ${fall.fallen.away}m from the feet`);
  check(fall.frames.some((f) => f.y < fall.standing.y - 0.15
    && f.y > fall.fallen.y + 0.15),
    "the fall is animated rather than a snap to the ground");
  check(fall.held.dead === true,
    "death HOLDS - there is no automatic respawn",
    `still dead ${fall.held.dead} at ${fall.held.y}m after the old timer`);
  check(fall.held.deathScreen === true && fall.respawned.deathScreen === false,
    "the death screen stands while dead and clears itself on revival",
    `shown ${fall.held.deathScreen} -> ${fall.respawned.deathScreen}`);
  check(!fall.respawned.dead
    && Math.abs(fall.respawned.y - fall.standing.y) < 0.25,
    "and the pose is cleared when a revival path runs",
    `head back at ${fall.respawned.y}m`);

  {
    const [px, pz] = fall.site;
    await page.evaluate(([x, z]) => {
      const T = window.__SF;
      T.player.spawn(x, z, Math.PI);
      T.advanceTime(0.5, 1 / 60);
      T.invulnerable(false);
      T.ctx.combat.hurtPlayer(9999, { source: "probe" });
      T.advanceTime(0.35, 1 / 60);
    }, [px, pz]);
    await page.evaluate(([x, z]) => {
      const T = window.__SF;
      const g = T.groundHeightAt(x, z);
      T.lookAt([x + 4.6, g + 2.1, z + 4.6], [x, g + 0.8, z], 50);
    }, [px, pz]);
    await grab("player-falling.png");
    await page.evaluate(() => window.__SF.advanceTime(1.1, 1 / 60));
    await grab("player-fallen.png");
    await page.evaluate(() => {
      const T = window.__SF;
      T.releaseCamera();
      T.advanceTime(0.1, 1 / 60);
      T.invulnerable(true);
    });
    await grab("player-fallen-chase.png");
    // Leave the probe alive: nothing revives automatically now.
    await page.evaluate(() => {
      const T = window.__SF;
      T.ctx.combat.respawn();
      T.advanceTime(0.3, 1 / 60);
    });
  }

  check(errors.length === 0, "no page or console errors", errors.slice(0, 3).join(" | "));
  console.log(findings.length
    ? `\n${findings.length} FAILED: ${findings.join(", ")}`
    : "\ndying behaves");
  await browser.close();
  process.exitCode = findings.length ? 1 : 0;
} finally {
  server.kill("SIGTERM");
}
