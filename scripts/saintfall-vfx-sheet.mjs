#!/usr/bin/env node
/* ============================================================
   SAINTFALL - VFX contact sheet

   Fires every player-facing effect in the game through the REAL
   systems (weapons, combat, boost, jetpack, slam, shield, ordnance)
   and captures a timed strip of each, so the whole effects
   vocabulary can be reviewed as pictures on one page. Frames are
   stepped deterministically with `renderOnce`, so the sheet is
   reproducible and immune to the headless rAF throttle.

   Usage:
     node scripts/saintfall-vfx-sheet.mjs [--out output/path] [--only slam]
     node scripts/saintfall-vfx-sheet.mjs --tag before
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
const tag = typeof args.tag === "string" ? args.tag : "current";
const outDir = path.resolve(root, args.out || `output/saintfall/vfx-sheet-${tag}`);
const only = typeof args.only === "string" ? args.only.split(",") : null;
const port = 52000 + (process.pid % 8000);
const base = `http://127.0.0.1:${port}`;

const SHOT_W = 640;
const SHOT_H = 400;

/* Every scene runs INSIDE the page. It returns an array of
   { label, dataUrl } tiles. All scenes share the helpers installed by
   `prelude`. */
const SCENES = {
  /* Autogun: muzzle, tracer, hit spark on a Thresher 14m out. */
  fire: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset(); T.equipWeapon("autogun");
    const e = H.enemyAhead("thresher", 12);
    T.setCam(0, -0.08, 5.6); H.settle(30);
    T.aimAt(e.x, e.y + 0.7, e.z, 16);
    const tiles = [];
    // Fire down the chase axis, then photograph from the side so the
    // beam is not foreshortened into the muzzle flash.
    T.fireWeapon(1); H.sideCam(1.35, 7.5, 1.6, 1.1, 38, 4.5);
    tiles.push(H.tile("shot +1f", 0));
    tiles.push(H.tile("+3f", 2));
    T.releaseCamera(); T.aimAt(e.x, e.y + 0.7, e.z, 8);
    T.fireWeapon(1); H.sideCam(-1.1, 6.0, 1.4, 1.2, 36, 3.5);
    tiles.push(H.tile("2nd shot +1f", 0));
    tiles.push(H.tile("+6f", 6));
    tiles.push(H.tile("+18f", 12));
    T.releaseCamera();
    return tiles;
  }`,
  /* Reliquary Glaive: three-hit combo on a Thresher in reach. */
  melee: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset(); T.equipWeapon("glaive");
    // The chase camera, swung round to the flank: a free camera
    // freezes the figure, and the swing is the subject.
    T.setCam(0.95, -0.10, 5.2); H.settle(30);
    const ps = T.player.state;
    T.spawnEnemy("thresher", ps.x + Math.sin(ps.yaw) * 2.3, ps.z + Math.cos(ps.yaw) * 2.3, { yaw: ps.yaw + Math.PI });
    H.settle(6);
    const tiles = [];
    T.pressMelee(); H.settle(30);
    T.pressMelee(); tiles.push(H.tile("swing +6f", 6));
    tiles.push(H.tile("+10f", 4));
    tiles.push(H.tile("+14f", 4));
    tiles.push(H.tile("+18f", 4));
    tiles.push(H.tile("+24f", 6));
    T.pressMelee(); tiles.push(H.tile("next +12f", 12));
    return tiles;
  }`,
  /* Ground boost held into a glide. */
  boost: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    T.setCam(Math.PI + 0.7, -0.06, 6.0); H.settle(30);
    T.player.input.keys.add("KeyW");
    T.triggerBoost(0, -1); T.setBoostHold(true);
    const tiles = [];
    tiles.push(H.tile("boost +4f", 4));
    tiles.push(H.tile("+12f", 8));
    tiles.push(H.tile("+24f", 12));
    tiles.push(H.tile("+40f", 16));
    T.setBoostHold(false); T.player.input.keys.delete("KeyW");
    tiles.push(H.tile("released +12f", 12));
    return tiles;
  }`,
  /* Jetpack flight from a standing start. */
  jet: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
    // From behind the shoulder, where the pack is.
    T.setCam(Math.PI + 0.55, 0.10, 5.6); H.settle(30);
    T.setJetInput(true);
    const tiles = [];
    tiles.push(H.tile("ignite +3f", 3));
    tiles.push(H.tile("+12f", 9));
    tiles.push(H.tile("+30f", 18));
    T.player.input.keys.add("KeyW");
    tiles.push(H.tile("forward +30f", 30));
    T.setJetInput(false); T.player.input.keys.delete("KeyW");
    tiles.push(H.tile("cut +10f", 10));
    return tiles;
  }`,
  /* Penitent's Fall: climb on the pack, then slam. */
  slam: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
    for (let i = 0; i < 4; i += 1) H.enemyAt("thresher", 2.4 + i * 0.7, i * 1.7);
    T.setCam(0.5, 0.02, 7.5); H.settle(30);
    T.setJetInput(true);
    for (let i = 0; i < 95; i += 1) T.renderOnce(1 / 60);
    T.setJetInput(false);
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
    const r = T.triggerSlam();
    const tiles = [];
    tiles.push(H.tile("charge +4f " + (r.triggered ? "" : "(refused)"), 4));
    tiles.push(H.tile("+14f", 10));
    // Step until landfall or a cap.
    let landed = false;
    for (let i = 0; i < 160; i += 1) {
      T.renderOnce(1 / 60);
      const s = T.slamState();
      if (s && (s.phase === "impact" || s.phase === "landed" || s.phase === "recover"
        || (s.lastImpact && s.lastImpact.at !== undefined && !s.active))) { landed = true; break; }
      if (s && s.active === false && i > 20) { landed = true; break; }
    }
    tiles.push(H.tile("impact +1f", 1));
    tiles.push(H.tile("+8f", 7));
    tiles.push(H.tile("+22f", 14));
    tiles.push(H.tile("+50f", 28));
    return tiles;
  }`,
  /* Aegis plate raised, then struck. */
  shield: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    T.setCam(0.65, -0.05, 4.6); H.settle(30);
    T.setShieldInput(true);
    const tiles = [];
    tiles.push(H.tile("raise +3f", 3));
    tiles.push(H.tile("+12f", 9));
    tiles.push(H.tile("held +40f", 28));
    const ps = T.player.state;
    T.shield.tryBlock(30, { x: ps.x + Math.sin(ps.yaw) * 6, y: ps.y + 1, z: ps.z + Math.cos(ps.yaw) * 6, source: "attack" });
    tiles.push(H.tile("block +1f", 1));
    tiles.push(H.tile("+6f", 5));
    T.setShieldInput(false);
    tiles.push(H.tile("drop +6f", 6));
    return tiles;
  }`,
  /* Seraph Aegis dome (capstone), unfolded by a perfect guard. */
  dome: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    H.grantOrder("halo");
    T.setCam(0.5, 0.0, 7.6); H.settle(30);
    T.setShieldInput(true);
    const tiles = [];
    tiles.push(H.tile("raise +1f", 1));
    const ps = T.player.state;
    T.shield.tryBlock(40, { x: ps.x + Math.sin(ps.yaw + 1.2) * 6, y: ps.y + 1, z: ps.z + Math.cos(ps.yaw + 1.2) * 6, source: "attack" });
    tiles.push(H.tile("unfold +2f", 2));
    tiles.push(H.tile("+10f", 8));
    tiles.push(H.tile("+30f", 20));
    tiles.push(H.tile("+60f", 30));
    T.setShieldInput(false);
    tiles.push(H.tile("release +8f", 8));
    return tiles;
  }`,
  /* Orbital lance, watched from 30m. */
  lance: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    const t = H.ahead(26);
    for (let i = 0; i < 5; i += 1) H.enemyAt("thresher", 26 + Math.cos(i * 1.3) * 5, Math.sin(i * 1.3) * 5);
    H.watch(t, 34, 0.14, 1.9);
    T.vfx.orbitalLance(t.x, t.y, t.z, 26);
    const tiles = [];
    tiles.push(H.tile("strike +2f", 2));
    tiles.push(H.tile("+8f", 6));
    tiles.push(H.tile("+18f", 10));
    tiles.push(H.tile("+40f", 22));
    tiles.push(H.tile("+90f", 50));
    tiles.push(H.tile("+200f", 110));
    T.releaseCamera();
    return tiles;
  }`,
  salvo: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    const t = H.ahead(22);
    for (let i = 0; i < 5; i += 1) H.enemyAt("thresher", 22 + Math.cos(i * 1.3) * 5, Math.sin(i * 1.3) * 5);
    H.watch(t, 30, 0.16, 1.9);
    T.vfx.clusterSalvo(t.x, t.y, t.z, 17);
    const tiles = [];
    tiles.push(H.tile("burst +3f", 3));
    tiles.push(H.tile("+18f", 15));
    tiles.push(H.tile("+34f", 16));
    tiles.push(H.tile("+55f", 21));
    tiles.push(H.tile("+90f", 35));
    tiles.push(H.tile("+180f", 90));
    T.releaseCamera();
    return tiles;
  }`,
  consecration: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    const t = H.ahead(9);
    H.watch(t, 16, 0.10, 1.4);
    T.vfx.consecration(t.x, t.y, t.z, 7, 20);
    const tiles = [];
    tiles.push(H.tile("call +3f", 3));
    tiles.push(H.tile("+12f", 9));
    tiles.push(H.tile("+30f", 18));
    tiles.push(H.tile("+70f", 40));
    tiles.push(H.tile("+160f", 90));
    T.releaseCamera();
    return tiles;
  }`,
  /* The blessing on the body while gilded. */
  gild: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    T.grantBoonForQA(20, 1.4, 0);
    T.setCam(0.5, -0.06, 4.8); H.settle(30);
    const tiles = [];
    tiles.push(H.tile("gilded +10f", 10));
    tiles.push(H.tile("+40f", 30));
    tiles.push(H.tile("+80f", 40));
    T.player.input.keys.add("KeyW");
    tiles.push(H.tile("walking +30f", 30));
    T.player.input.keys.delete("KeyW");
    return tiles;
  }`,
  /* Enemy death: shoot a Thresher until it dies. */
  death: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset(); T.equipWeapon("autogun");
    const e = H.enemyAhead("thresher", 8);
    T.setCam(0.3, -0.10, 6.0); H.settle(30);
    const inst = H.nearest();
    const tiles = [];
    tiles.push(H.tile("alive", 1));
    T.combat.damageEnemy(inst, 9999, { source: "qa", x: inst.x, y: inst.y + 0.6, z: inst.z });
    tiles.push(H.tile("killed +1f", 1));
    tiles.push(H.tile("+5f", 4));
    tiles.push(H.tile("+12f", 7));
    tiles.push(H.tile("+30f", 18));
    tiles.push(H.tile("+70f", 40));
    return tiles;
  }`,
  /* Heavy enemy death (Harrow) at range. */
  deathHeavy: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    const e = H.enemyAhead("harrow", 12);
    T.setCam(0.3, -0.06, 7.0); H.settle(30);
    const inst = H.nearest();
    const tiles = [];
    tiles.push(H.tile("alive", 1));
    T.combat.damageEnemy(inst, 99999, { source: "qa", x: inst.x, y: inst.y + 1.2, z: inst.z });
    tiles.push(H.tile("killed +1f", 1));
    tiles.push(H.tile("+6f", 5));
    tiles.push(H.tile("+16f", 10));
    tiles.push(H.tile("+40f", 24));
    tiles.push(H.tile("+90f", 50));
    return tiles;
  }`,
  /* A breach: something surfacing through the sand. */
  breach: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    const t = H.ahead(9);
    H.watch(t, 14, 0.12, 1.2);
    T.vfx.breach(t.x, t.y, t.z, 3.2, 1.2);
    const tiles = [];
    tiles.push(H.tile("breach +2f", 2));
    tiles.push(H.tile("+8f", 6));
    tiles.push(H.tile("+20f", 12));
    tiles.push(H.tile("+45f", 25));
    T.releaseCamera();
    return tiles;
  }`,
  /* The knight falling. */
  fall: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    T.setCam(0.6, -0.08, 6.4); H.settle(30);
    T.invulnerable(false);
    const ps = T.player.state;
    T.combat.hurtPlayer(9999, { source: "qa", x: ps.x + 3, z: ps.z + 3 });
    const tiles = [];
    tiles.push(H.tile("fall +4f", 4));
    tiles.push(H.tile("+20f", 16));
    tiles.push(H.tile("+50f", 30));
    tiles.push(H.tile("+110f", 60));
    T.invulnerable(true);
    return tiles;
  }`,
  /* The lance overheating and bleeding while locked out. */
  overheat: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset(); T.equipWeapon("autogun");
    T.setCam(Math.PI + 0.9, -0.05, 3.6); H.settle(30);
    T.weapons.setHeat(1, { reason: "qa", overheated: true });
    const tiles = [];
    tiles.push(H.tile("overheat +6f", 6));
    tiles.push(H.tile("+30f", 24));
    tiles.push(H.tile("+60f", 30));
    T.weapons.setHeat(0, { reason: "qa", clearOverheat: true });
    return tiles;
  }`,
  /* Doctrine capstones, one per Order, as a spot check against the
     dedicated doctrine sheet. */
  rites: `async () => {
    const T = window.__SF; const H = window.__VFXH;
    H.reset();
    T.setCam(0.4, -0.10, 8.2); H.settle(30);
    const ps = T.player.state;
    const tiles = [];
    for (const [order, cue] of [["censer", "martyr"], ["procession", "litany"], ["wing", "circuit"], ["halo", "seraph"], ["edict", "fusion"]]) {
      for (let i = 0; i < 100; i += 1) T.renderOnce(1 / 60);
      T.vfx.doctrineCue({ order, cue, x: ps.x, y: ps.y, z: ps.z, yaw: ps.yaw, intensity: 1, capstone: true, stage: cue === "circuit" ? "complete" : (cue === "litany" ? "proc" : undefined) });
      tiles.push(H.tile(order + " +12f", 12));
    }
    return tiles;
  }`,
};

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const label = async (text, width, height = 22) => sharp({
  create: {
    width, height, channels: 4,
    background: { r: 8, g: 8, b: 10, alpha: 1 },
  },
}).composite([{
  input: Buffer.from(
    `<svg width="${width}" height="${height}">
       <text x="8" y="15" font-family="monospace" font-size="13"
             fill="#e8e2d6">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>
     </svg>`
  ),
  top: 0, left: 0,
}]).png().toBuffer();

try {
  await mkdir(outDir, { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: SHOT_W, height: SHOT_H } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console: ${msg.text()}`);
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&intro=skip`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  /* Shared helpers, installed once. */
  const spot = await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.hideHud(true);
    T.invulnerable(true);
    T.clearEnemies();
    T.setBreachAuto?.(false);
    const terr = T.terrain;
    // The flattest patch in a search box off the Pilgrim's Road, so the
    // sheet photographs effects and not a dune face.
    let best = null;
    for (let sx = -90; sx <= 90; sx += 6) {
      for (let sz = 760; sz <= 900; sz += 6) {
        const h = terr.heightAt(sx, sz);
        let worst = 0;
        for (let a = 0; a < 12; a += 1) {
          const ang = (a / 12) * Math.PI * 2;
          for (const rr of [6, 14, 26]) {
            worst = Math.max(worst, Math.abs(
              terr.heightAt(sx + Math.cos(ang) * rr, sz + Math.sin(ang) * rr) - h) / (rr / 6));
          }
        }
        if (!best || worst < best.relief) best = { x: sx, z: sz, relief: worst };
      }
    }
    const H = {
      site: best,
      reset() {
        T.clearEnemies();
        T.releaseCamera();
        T.setShieldInput(false);
        T.setJetInput(false);
        T.setBoostHold(false);
        T.player.input.keys.delete("KeyW");
        T.setFiring(false);
        T.resetSlam?.(true);
        T.resetBoost?.(true);
        T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
        // A free camera hides the figure by default; this sheet is
        // ABOUT the figure and what comes off it.
        T.hidePlayer(false);
        T.vfx.reset?.();
        T._teleportRaw(best.x, best.z, 0);
        T.setBodyHeading(0);
        T.setCam(0, -0.10, 6.4);
        // Let every pool drain from the previous scene.
        for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
      },
      settle(n) { for (let i = 0; i < n; i += 1) T.renderOnce(1 / 60); },
      ahead(d, side = 0) {
        const ps = T.player.state;
        const x = ps.x + Math.sin(ps.yaw) * d + Math.cos(ps.yaw) * side;
        const z = ps.z + Math.cos(ps.yaw) * d - Math.sin(ps.yaw) * side;
        return { x, y: terr.heightAt(x, z), z };
      },
      enemyAt(kind, d, side = 0) {
        const p = H.ahead(d, side);
        const ps = T.player.state;
        T.spawnEnemy(kind, p.x, p.z, { yaw: ps.yaw + Math.PI });
        return p;
      },
      enemyAhead(kind, d) { return H.enemyAt(kind, d, 0); },
      /* The live list also holds every dormant BOSS on the map; the
         first pass killed the Matriarch two kilometres away and
         photographed nothing. */
      nearest() {
        const ps = T.player.state;
        let best = null; let bd = Infinity;
        for (const e of T.enemies.live) {
          if (e.state === "death") continue;
          const d = Math.hypot(e.x - ps.x, e.z - ps.z);
          if (d < bd) { bd = d; best = e; }
        }
        return best;
      },
      watch(target, dist, elev, fovScale) {
        const ps = T.player.state;
        // From behind the player's shoulder, looking at the target.
        const dx = target.x - ps.x; const dz = target.z - ps.z;
        const L = Math.hypot(dx, dz) || 1;
        const px = target.x - (dx / L) * dist + (dz / L) * dist * 0.35;
        const pz = target.z - (dz / L) * dist - (dx / L) * dist * 0.35;
        const py = terr.heightAt(px, pz) + 2.2 + dist * elev;
        T.lookAt([px, py, pz], [target.x, target.y + 1.5, target.z], 42 * fovScale);
        for (let i = 0; i < 4; i += 1) T.renderOnce(1 / 60);
      },
      /* A free camera placed off the player's shoulder, at a bearing
         relative to the body heading, so a shot fired down the chase
         axis is seen from the side rather than end on. */
      sideCam(bearing, dist, height = 1.6, lookY = 1.0, fov = 40, lookAhead = 0) {
        const ps = T.player.state;
        const a = ps.yaw + bearing;
        const px = ps.x + Math.sin(a) * dist;
        const pz = ps.z + Math.cos(a) * dist;
        const py = Math.max(terr.heightAt(px, pz) + 0.6, ps.y + height);
        const tx = ps.x + Math.sin(ps.yaw) * lookAhead;
        const tz = ps.z + Math.cos(ps.yaw) * lookAhead;
        T.lookAt([px, py, pz], [tx, ps.y + lookY, tz], fov);
      },
      grantOrder(order) {
        const defs = T.progressionDefinitions();
        const orders = (defs?.doctrine?.orders || defs?.orders || []);
        const o = orders.find((x) => x.id === order);
        if (!o) return false;
        T.resetProgressionForQA?.();
        T.grantProgressionXpForQA(500000, "qa:vfx-sheet");
        const talents = [...(o.talents || [])].sort((a, b) => (a.tier || 1) - (b.tier || 1));
        for (const t of talents) {
          for (let r = 0; r < (t.maxRank || 1); r += 1) T.spendTalentForQA(t.id);
        }
        if (o.capstone) T.equipCapstoneForQA(o.capstone.id, 0);
        return true;
      },
      tile(label, frames) {
        for (let i = 0; i < frames; i += 1) T.renderOnce(1 / 60);
        return { label, dataUrl: T.captureDataURL() };
      },
    };
    window.__VFXH = H;
    return best;
  });
  console.log(`site ${spot.x},${spot.z} (relief ${spot.relief.toFixed(2)})`);

  const rows = [];
  for (const [name, fn] of Object.entries(SCENES)) {
    if (only && !only.includes(name)) continue;
    let tiles;
    try {
      tiles = await page.evaluate(`(${fn})()`);
    } catch (error) {
      console.log(`FAILED   ${name}: ${error.message}`);
      pageErrors.push(`${name}: ${error.message}`);
      continue;
    }
    const bufs = tiles.map((t) => Buffer.from(t.dataUrl.split(",")[1], "base64"));
    const labelled = [];
    for (let i = 0; i < bufs.length; i += 1) {
      const head = await label(`${name} — ${tiles[i].label}`, SHOT_W);
      labelled.push(await sharp({
        create: { width: SHOT_W, height: SHOT_H + 22, channels: 4,
          background: { r: 8, g: 8, b: 10, alpha: 1 } },
      }).composite([{ input: head, top: 0, left: 0 }, { input: bufs[i], top: 22, left: 0 }])
        .png().toBuffer());
    }
    const strip = await sharp({
      create: { width: SHOT_W * labelled.length, height: SHOT_H + 22, channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).composite(labelled.map((input, i) => ({ input, left: SHOT_W * i, top: 0 })))
      .png().toBuffer();
    await writeFile(path.join(outDir, `${name}.png`), strip);
    rows.push({ name, strip, n: labelled.length });
    console.log(`captured ${name} (${labelled.length} tiles)`);
  }

  if (rows.length) {
    const maxN = Math.max(...rows.map((r) => r.n));
    const sheet = await sharp({
      create: { width: SHOT_W * maxN, height: (SHOT_H + 22) * rows.length, channels: 4,
        background: { r: 8, g: 8, b: 10, alpha: 1 } },
    }).composite(rows.map((r, i) => ({ input: r.strip, top: (SHOT_H + 22) * i, left: 0 })))
      .png().toBuffer();
    await writeFile(path.join(outDir, `sheet.png`), sheet);
  }

  if (pageErrors.length) console.log(`\nPAGE ERRORS:\n${pageErrors.join("\n")}`);
  console.log(`\nwrote ${outDir}`);
  await browser.close();
} finally {
  server.kill();
}
